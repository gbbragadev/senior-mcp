import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { KnowledgeRepository } from '../repositories/knowledge-repo';
import { KnowledgeChunkRecord, KnowledgeReindexStats } from '../types';
import { VoyageEmbeddingService } from './embeddings';
import { collapseWhitespace, sha1 } from './indexer-utils';

interface ParsedDocLine {
  chunk_id: string;
  source_url?: string;
  source_root?: string;
  context?: string;
  product?: string;
  version?: string;
  title?: string;
  heading_path?: string;
  text: string;
  content_hash?: string;
  last_modified?: string | null;
  crawl_strategy?: string | null;
}

interface DocsIndexerOptions {
  docsChunksFiles?: string[];
}

export class DocsIndexerService {
  private readonly repository: KnowledgeRepository;
  private readonly embeddingService: VoyageEmbeddingService;
  private readonly docsChunksPaths: string[];
  private readonly batchSize: number;
  private readonly minChunkChars: number;

  constructor(
    repository?: KnowledgeRepository,
    embeddingService?: VoyageEmbeddingService,
    options?: DocsIndexerOptions
  ) {
    this.repository = repository || new KnowledgeRepository();
    this.embeddingService = embeddingService || new VoyageEmbeddingService();
    this.docsChunksPaths = this.resolveDocsChunksPaths(options?.docsChunksFiles);
    this.batchSize = Math.max(1, Number(process.env.KNOWLEDGE_EMBEDDING_BATCH_SIZE || 32));
    this.minChunkChars = Math.max(20, Number(process.env.KNOWLEDGE_MIN_CHARS_PER_CHUNK || 50));
  }

  async reindex(fullRebuild = false): Promise<KnowledgeReindexStats> {
    const startedAt = Date.now();
    const stats: KnowledgeReindexStats = {
      domain: 'docs',
      scanned: 0,
      indexed: 0,
      skipped: 0,
      errors: 0,
      durationMs: 0,
    };

    const missingPaths = this.docsChunksPaths.filter((filePath) => !fs.existsSync(filePath));
    if (missingPaths.length > 0) {
      throw new Error(`Docs chunks file(s) not found: ${missingPaths.join(', ')}`);
    }

    const batch: KnowledgeChunkRecord[] = [];
    const seenHashes = new Set<string>();

    for (const docsChunksPath of this.docsChunksPaths) {
      const stream = fs.createReadStream(docsChunksPath, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      for await (const rawLine of rl) {
        const line = String(rawLine || '').trim();
        if (!line) continue;
        stats.scanned += 1;

        try {
          const parsed = JSON.parse(line) as ParsedDocLine;
          const text = collapseWhitespace(parsed.text || '');
          if (!text || text.length < this.minChunkChars) {
            stats.skipped += 1;
            continue;
          }

          const contentHash = parsed.content_hash || sha1(text);
          seenHashes.add(contentHash);

          const chunkId = parsed.chunk_id || sha1(`${parsed.source_url || ''}::${contentHash}`);
          const metadata = {
            title: parsed.title || '',
            source_root: parsed.source_root || '',
            source_url: parsed.source_url || '',
            context: parsed.context || '',
            product: parsed.product || '',
            version: parsed.version || '',
            heading_path: parsed.heading_path || '',
            last_modified: parsed.last_modified || null,
            crawl_strategy: parsed.crawl_strategy || null,
          };

          batch.push({
            domain: 'docs',
            chunkId,
            contentHash,
            text,
            metadata,
            context: parsed.context || null,
            product: parsed.product || null,
            version: parsed.version || null,
            sourceUrl: parsed.source_url || null,
            headingPath: parsed.heading_path || null,
            lastModified: parsed.last_modified || null,
            crawlStrategy: parsed.crawl_strategy || null,
          });

          if (batch.length >= this.batchSize) {
            await this.flushBatch(batch, stats);
          }
        } catch {
          stats.errors += 1;
        }
      }
    }

    if (batch.length > 0) {
      await this.flushBatch(batch, stats);
    }

    if (fullRebuild) {
      await this.repository.markDomainMissingAsDeleted('docs', Array.from(seenHashes));
    }

    stats.durationMs = Date.now() - startedAt;
    return stats;
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

  private resolveDocsChunksPaths(overrideFiles?: string[]): string[] {
    const fromOptions = this.normalizePathList(overrideFiles);
    if (fromOptions.length > 0) {
      return this.toAbsoluteUniquePaths(fromOptions);
    }

    const fromEnvMulti = this.normalizePathList(process.env.SENIOR_DOCS_CHUNKS_FILES || '');
    if (fromEnvMulti.length > 0) {
      return this.toAbsoluteUniquePaths(fromEnvMulti);
    }

    const fromEnvSingle = this.normalizePathList(process.env.SENIOR_DOCS_CHUNKS_FILE || '');
    if (fromEnvSingle.length > 0) {
      return this.toAbsoluteUniquePaths(fromEnvSingle);
    }

    return [path.resolve(process.cwd(), 'output/senior-docs/chunks/chunks.jsonl')];
  }

  private normalizePathList(value: string[] | string | undefined): string[] {
    const rawValues = Array.isArray(value) ? value : [value || ''];
    return rawValues
      .flatMap((item) => String(item || '').split(/[,;\n]/))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private toAbsoluteUniquePaths(values: string[]): string[] {
    const unique = new Set<string>();
    for (const item of values) {
      const resolved = path.isAbsolute(item) ? item : path.resolve(process.cwd(), item);
      unique.add(path.normalize(resolved));
    }
    return Array.from(unique);
  }

  private buildEmbeddingInput(record: KnowledgeChunkRecord): string {
    const metadata = record.metadata || {};
    const fields = [
      'domain: docs',
      record.context ? `context: ${record.context}` : '',
      record.product ? `product: ${record.product}` : '',
      record.version ? `version: ${record.version}` : '',
      metadata.title ? `title: ${String(metadata.title)}` : '',
      record.headingPath ? `heading: ${record.headingPath}` : '',
      record.sourceUrl ? `source_url: ${record.sourceUrl}` : '',
    ].filter(Boolean);

    fields.push(`content:\n${record.text}`);
    return fields.join('\n');
  }
}
