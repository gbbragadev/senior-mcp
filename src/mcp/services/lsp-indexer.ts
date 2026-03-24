import fs from 'fs';
import path from 'path';
import { KnowledgeRepository } from '../repositories/knowledge-repo';
import { KnowledgeChunkRecord, KnowledgeReindexStats } from '../types';
import { VoyageEmbeddingService } from './embeddings';
import { collapseWhitespace, sha1, splitWithOverlap, tryDecodeUtf8 } from './indexer-utils';

interface LspChunkCandidate {
  text: string;
  startLine: number;
  endLine: number;
  routineName: string | null;
  routineSignature: string | null;
}

interface LspSourceFile {
  filePath: string;
  sourceBaseDir: string;
}

interface LspTagRule {
  match: string;
  module?: string;
  routineName?: string;
  context?: string;
  product?: string;
  version?: string;
  headingPath?: string;
}

interface LspResolvedTags {
  moduleName: string;
  routineName: string;
  context: string | null;
  product: string | null;
  version: string | null;
  headingPath: string | null;
}

export class LspIndexerService {
  private readonly repository: KnowledgeRepository;
  private readonly embeddingService: VoyageEmbeddingService;
  private readonly rootDir: string;
  private readonly extraPaths: string[];
  private readonly chunkSize: number;
  private readonly chunkOverlap: number;
  private readonly batchSize: number;
  private readonly minChunkChars: number;
  private readonly allowedExtensions: Set<string>;
  private readonly ignoredTerms: string[];
  private readonly ignoredPathPatterns: string[];
  private readonly tagRules: LspTagRule[];

  constructor(repository?: KnowledgeRepository, embeddingService?: VoyageEmbeddingService) {
    this.repository = repository || new KnowledgeRepository();
    this.embeddingService = embeddingService || new VoyageEmbeddingService();
    this.rootDir = process.env.SENIOR_LSP_ROOT || '';
    this.extraPaths = String(process.env.SENIOR_LSP_EXTRA_PATHS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    this.chunkSize = Math.max(300, Number(process.env.KNOWLEDGE_MAX_CHARS_PER_CHUNK || 1400));
    this.chunkOverlap = Math.max(0, Number(process.env.KNOWLEDGE_CHUNK_OVERLAP || 220));
    this.batchSize = Math.max(1, Number(process.env.KNOWLEDGE_EMBEDDING_BATCH_SIZE || 32));
    this.minChunkChars = Math.max(20, Number(process.env.KNOWLEDGE_MIN_CHARS_PER_CHUNK || 50));
    this.allowedExtensions = new Set(
      String(process.env.SENIOR_LSP_EXTENSIONS || '.lsp,.prg,.src,.txt,.sql,.xml')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );
    this.ignoredTerms = String(process.env.SENIOR_LSP_IGNORE_TERMS || '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    this.ignoredPathPatterns = String(process.env.SENIOR_LSP_IGNORE_PATH_PATTERNS || '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    this.tagRules = this.parseTagRules(process.env.SENIOR_LSP_TAG_RULES_JSON || '');
  }

  async reindex(fullRebuild = false): Promise<KnowledgeReindexStats> {
    const startedAt = Date.now();
    const stats: KnowledgeReindexStats = {
      domain: 'lsp',
      scanned: 0,
      indexed: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
    };

    if (!this.rootDir && this.extraPaths.length === 0) {
      throw new Error('SENIOR_LSP_ROOT or SENIOR_LSP_EXTRA_PATHS is required to index LSP sources');
    }

    const files = await this.resolveSourceFiles();
    if (files.length === 0) {
      throw new Error('No LSP source files found from SENIOR_LSP_ROOT / SENIOR_LSP_EXTRA_PATHS');
    }
    const seenHashes = new Set<string>();
    const batch: KnowledgeChunkRecord[] = [];

    for (const source of files) {
      stats.scanned += 1;
      try {
        const relativePath = this.toRelativePath(source.filePath, source.sourceBaseDir);
        const sourceKey = this.toSourceKey(source.filePath, relativePath);
        const filePath = source.filePath;
        if (this.shouldIgnorePath(filePath, relativePath)) {
          stats.skipped += 1;
          continue;
        }
        const fileExt = path.extname(filePath).toLowerCase();
        if (!this.allowedExtensions.has(fileExt)) {
          stats.skipped += 1;
          continue;
        }

        const rawBuffer = await fs.promises.readFile(filePath);
        const content = this.filterIgnoredLines(tryDecodeUtf8(rawBuffer));
        if (!content) {
          stats.skipped += 1;
          continue;
        }

        const chunks = this.extractChunks(content);
        if (chunks.length === 0) {
          stats.skipped += 1;
          continue;
        }

        const moduleName = this.resolveModuleName(relativePath);
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index];
          const normalizedText = collapseWhitespace(chunk.text);
          if (!normalizedText || normalizedText.length < this.minChunkChars) continue;
          const tags = this.resolveTags(filePath, relativePath, moduleName, chunk.routineName);
          const contentHash = sha1(`${sourceKey}:${chunk.startLine}:${chunk.endLine}:${normalizedText}`);
          seenHashes.add(contentHash);
          const chunkId = sha1(`lsp::${sourceKey}::${index}::${contentHash}`).slice(0, 32);

          batch.push({
            domain: 'lsp',
            chunkId,
            contentHash,
            text: normalizedText,
            metadata: {
              file_path: relativePath,
              source_path: this.normalizePath(filePath),
              module: tags.moduleName,
              routine_name: tags.routineName,
              context: tags.context,
              product: tags.product,
              version: tags.version,
              line_start: chunk.startLine,
              line_end: chunk.endLine,
              routine_signature: chunk.routineSignature,
            },
            filePath: relativePath,
            context: tags.context,
            product: tags.product,
            version: tags.version,
            module: tags.moduleName,
            routineName: tags.routineName,
            headingPath: tags.headingPath,
          });

          if (batch.length >= this.batchSize) {
            await this.flushBatch(batch, stats);
          }
        }
      } catch {
        stats.errors += 1;
      }
    }

    if (batch.length > 0) {
      await this.flushBatch(batch, stats);
    }

    if (fullRebuild) {
      await this.repository.markDomainMissingAsDeleted('lsp', Array.from(seenHashes));
    }

    stats.durationMs = Date.now() - startedAt;
    return stats;
  }

  private parseTagRules(raw: string): LspTagRule[] {
    const text = String(raw || '').trim();
    if (!text) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        'Invalid SENIOR_LSP_TAG_RULES_JSON (must be a JSON array of rules with "match").'
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error('Invalid SENIOR_LSP_TAG_RULES_JSON (must be an array).');
    }

    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const obj = item as Record<string, unknown>;
        const rule: LspTagRule = {
          match: String(obj.match || '').trim(),
          module: String(obj.module || '').trim() || undefined,
          routineName: String(obj.routineName || '').trim() || undefined,
          context: String(obj.context || '').trim() || undefined,
          product: String(obj.product || '').trim() || undefined,
          version: String(obj.version || '').trim() || undefined,
          headingPath: String(obj.headingPath || '').trim() || undefined,
        };
        return rule.match ? rule : null;
      })
      .filter((rule): rule is LspTagRule => Boolean(rule));
  }

  private async flushBatch(batch: KnowledgeChunkRecord[], stats: KnowledgeReindexStats) {
    const toIndex = batch.splice(0, batch.length);
    if (toIndex.length === 0) return;

    const embeddings = await this.embeddingService.embedDocuments(
      toIndex.map((item) => this.buildEmbeddingInput(item))
    );
    for (let i = 0; i < toIndex.length; i += 1) {
      const item = toIndex[i];
      try {
        await this.repository.upsertChunk(item, embeddings[i]);
        stats.indexed += 1;
      } catch {
        stats.errors += 1;
      }
    }
  }

  private async resolveSourceFiles(): Promise<LspSourceFile[]> {
    const output: LspSourceFile[] = [];
    const seen = new Set<string>();
    const sourceInputs = [this.rootDir, ...this.extraPaths].filter(Boolean);

    for (const input of sourceInputs) {
      const absoluteInput = path.resolve(input);
      if (!fs.existsSync(absoluteInput)) continue;

      const stat = await fs.promises.stat(absoluteInput);
      if (stat.isFile()) {
        this.pushUniqueSource(output, seen, absoluteInput, path.dirname(absoluteInput));
        continue;
      }

      if (stat.isDirectory()) {
        const files = await this.walk(absoluteInput);
        for (const filePath of files) {
          this.pushUniqueSource(output, seen, filePath, absoluteInput);
        }
      }
    }

    return output;
  }

  private pushUniqueSource(
    output: LspSourceFile[],
    seen: Set<string>,
    filePath: string,
    sourceBaseDir: string
  ) {
    const normalized = this.normalizePath(filePath).toLowerCase();
    if (seen.has(normalized)) return;
    seen.add(normalized);
    output.push({ filePath, sourceBaseDir });
  }

  private toRelativePath(filePath: string, sourceBaseDir: string): string {
    const normalizedBase = this.normalizePath(path.resolve(sourceBaseDir));
    const normalizedRoot = this.normalizePath(path.resolve(this.rootDir || sourceBaseDir));
    const relative = path.relative(sourceBaseDir, filePath).split(path.sep).join('/');
    const safeRelative =
      !relative || relative.startsWith('..') ? path.basename(filePath) : relative;

    if (normalizedBase === normalizedRoot) {
      return safeRelative;
    }

    const prefix = path.basename(sourceBaseDir).trim();
    return prefix ? `${prefix}/${safeRelative}` : safeRelative;
  }

  private toSourceKey(filePath: string, relativePath: string): string {
    return `${relativePath}::${this.normalizePath(filePath)}`;
  }

  private normalizePath(value: string): string {
    return String(value || '').replace(/\\/g, '/');
  }

  private shouldIgnorePath(filePath: string, relativePath: string): boolean {
    if (this.ignoredPathPatterns.length === 0) return false;
    const normalizedFile = this.normalizePath(filePath).toUpperCase();
    const normalizedRelative = String(relativePath || '').toUpperCase();
    return this.ignoredPathPatterns.some(
      (pattern) => normalizedFile.includes(pattern) || normalizedRelative.includes(pattern)
    );
  }

  private resolveTags(
    filePath: string,
    relativePath: string,
    defaultModule: string,
    detectedRoutineName: string | null
  ): LspResolvedTags {
    let moduleName = defaultModule;
    let routineName = detectedRoutineName || this.guessRoutineFromFilename(relativePath);
    let headingPath: string | null = routineName;
    let context: string | null = null;
    let product: string | null = null;
    let version: string | null = null;

    const fileUpper = this.normalizePath(filePath).toUpperCase();
    const relativeUpper = relativePath.toUpperCase();

    for (const rule of this.tagRules) {
      const matcher = rule.match.toUpperCase();
      if (!matcher) continue;
      if (!fileUpper.includes(matcher) && !relativeUpper.includes(matcher)) continue;

      if (rule.module) moduleName = rule.module;
      if (rule.routineName) routineName = rule.routineName;
      if (rule.headingPath) headingPath = rule.headingPath;
      if (rule.context) context = rule.context;
      if (rule.product) product = rule.product;
      if (rule.version) version = rule.version;
    }

    if (!headingPath) headingPath = routineName;

    return {
      moduleName,
      routineName,
      context,
      product,
      version,
      headingPath,
    };
  }

  private async walk(root: string): Promise<string[]> {
    const output: string[] = [];
    const stack: string[] = [root];
    const ignoredDirNames = new Set(['.git', 'node_modules', 'dist', 'build', 'output', '.next', '.cache']);

    while (stack.length > 0) {
      const current = stack.pop() as string;
      const entries = await fs.promises.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredDirNames.has(entry.name.toLowerCase())) {
            stack.push(absolute);
          }
          continue;
        }
        output.push(absolute);
      }
    }

    return output;
  }

  private filterIgnoredLines(content: string | null): string {
    if (!content) return '';
    if (this.ignoredTerms.length === 0) return content;

    return content
      .split(/\r?\n/)
      .filter((line) => {
        const normalized = String(line || '').toUpperCase();
        return !this.ignoredTerms.some((term) => normalized.includes(term));
      })
      .join('\n')
      .trim();
  }

  private resolveModuleName(relativePath: string): string {
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length <= 1) return 'root';
    return segments[0];
  }

  private guessRoutineFromFilename(relativePath: string): string {
    const filename = path.basename(relativePath, path.extname(relativePath));
    return filename || 'routine';
  }

  private extractChunks(content: string): LspChunkCandidate[] {
    const lines = content.split(/\r?\n/);
    const chunks: LspChunkCandidate[] = [];
    const routineRegex =
      /^\s*(?:function|procedure|sub|rotina|regra|programa)\s+([a-zA-Z0-9_.$-]+)/i;

    const routineStarts: Array<{ index: number; name: string }> = [];
    for (let i = 0; i < lines.length; i += 1) {
      const match = lines[i].match(routineRegex);
      if (match?.[1]) {
        routineStarts.push({ index: i, name: match[1] });
      }
    }

    if (routineStarts.length > 0) {
      for (let i = 0; i < routineStarts.length; i += 1) {
        const current = routineStarts[i];
        const next = routineStarts[i + 1];
        const start = current.index;
        const end = next ? next.index - 1 : lines.length - 1;
        const blockText = lines.slice(start, end + 1).join('\n');
        const routineSignature = collapseWhitespace(lines[start] || '') || current.name;
        const pieces = splitWithOverlap(blockText, this.chunkSize, this.chunkOverlap);
        let lineStart = start + 1;
        for (const piece of pieces) {
          const hasSignature = piece.toLowerCase().includes(routineSignature.toLowerCase());
          const finalPiece = hasSignature ? piece : `${routineSignature}\n${piece}`;
          const pieceLineCount = piece.split(/\n/).length;
          const lineEnd = Math.min(end + 1, lineStart + pieceLineCount - 1);
          chunks.push({
            text: finalPiece,
            startLine: lineStart,
            endLine: lineEnd,
            routineName: current.name,
            routineSignature,
          });
          lineStart = Math.max(lineEnd - 6, lineStart + 1);
        }
      }
      return chunks;
    }

    const fixedBlockLines = 80;
    const fixedOverlapLines = 12;
    for (let start = 0; start < lines.length; start += fixedBlockLines - fixedOverlapLines) {
      const end = Math.min(lines.length, start + fixedBlockLines);
      const text = lines.slice(start, end).join('\n').trim();
      if (!text) continue;
      chunks.push({
        text,
        startLine: start + 1,
        endLine: end,
        routineName: null,
        routineSignature: null,
      });
      if (end >= lines.length) break;
    }
    return chunks;
  }

  private buildEmbeddingInput(record: KnowledgeChunkRecord): string {
    const metadata = record.metadata || {};
    const fields = [
      'domain: lsp',
      record.module ? `module: ${record.module}` : '',
      record.routineName ? `routine: ${record.routineName}` : '',
      record.filePath ? `file_path: ${record.filePath}` : '',
      metadata.line_start ? `line_start: ${String(metadata.line_start)}` : '',
      metadata.line_end ? `line_end: ${String(metadata.line_end)}` : '',
      metadata.routine_signature ? `routine_signature: ${String(metadata.routine_signature)}` : '',
      record.context ? `context: ${record.context}` : '',
      record.product ? `product: ${record.product}` : '',
      record.version ? `version: ${record.version}` : '',
    ].filter(Boolean);

    fields.push(`content:\n${record.text}`);
    return fields.join('\n');
  }
}
