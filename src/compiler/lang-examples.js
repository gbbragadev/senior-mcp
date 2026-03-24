// lang-examples.js — Example index and search module for Senior HCM rule language
// Reads decoded .senior example files and provides search/lookup functionality.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { join, basename } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXAMPLES_DIR = process.env.SENIOR_EXAMPLES_DIR || resolve(__dirname, '../../data/decoded-rules');

const MODULE_DESCRIPTIONS = {
  FPRG: 'Folha de Pagamento (Payroll)',
  CSRG: 'Cargos e Salários (Job & Salary)',
  RSRG: 'Recrutamento e Seleção (Recruitment)',
  SMRG: 'Saúde e Medicina (Health & Safety)',
  TRRG: 'Treinamento (Training)',
  QLRG: 'Qualidade de Vida (Quality of Life)',
};

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function detectPatterns(source) {
  const patterns = [];
  const s = source; // keep original case for regex; lowercase for simple checks
  const lower = source.toLowerCase();

  if (lower.includes('.sql') && lower.includes('abrircursor'))
    patterns.push('cursor_loop');
  if (lower.includes('sql_criar') || lower.includes('sql_definircomando'))
    patterns.push('sql_api');
  if (lower.includes('wcheckval'))
    patterns.push('web_validation');
  if (lower.includes('abrir(') && lower.includes('gravarnl('))
    patterns.push('file_io');
  if (lower.includes('getaccesstoken') || lower.includes('carregarcsvplataforma'))
    patterns.push('platform_api');
  if (lower.includes('mensagem('))
    patterns.push('message_dialog');
  if (/funcao\s+\w+/i.test(s))
    patterns.push('function_def');
  if (/R\d{3}\w+\.\w+\s*=/.test(s))
    patterns.push('table_write');
  if (lower.includes('enviaemail'))
    patterns.push('email');
  if (lower.includes('fluxobasico_'))
    patterns.push('flow_chart');
  if (lower.includes('gersolexa_'))
    patterns.push('exam_generation');
  if (lower.includes('cancel(2)'))
    patterns.push('calculation');
  if (lower.includes('cancel(0)') || lower.includes('cancel(1)'))
    patterns.push('validation');

  return patterns;
}

// ─────────────────────────────────────────────────────────────────────────────
// TITLE EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

function extractTitle(source, filename) {
  // Try @...@ comment at the start of the file (first 3 lines only)
  const firstLines = source.split('\n').slice(0, 3).join('\n');
  const atMatch = firstLines.match(/@\s*(.+?)\s*@/);
  if (atMatch) return atMatch[1].trim();

  // Try /*...*/ block comment — scan lines inside for first meaningful text
  const blockMatch = source.match(/\/\*([\s\S]*?)\*\//);
  if (blockMatch) {
    const commentLines = blockMatch[1].split('\n');
    for (const line of commentLines) {
      // Strip leading/trailing comment decorations: *, /, -, |, spaces
      const cleaned = line
        .replace(/^[\s*/|=-]+/, '')
        .replace(/[\s*/|=-]+$/, '')
        .trim();
      // Skip empty lines, pure decoration, and very short fragments
      if (cleaned.length >= 5 && !/^[*\/\-=|]+$/.test(cleaned)) {
        return cleaned;
      }
    }
  }

  // Fallback to filename
  return filename.replace('.senior', '');
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEX BUILD (runs at import time)
// ─────────────────────────────────────────────────────────────────────────────

let INDEX = [];
let INDEX_ERROR = null;

try {
  if (!existsSync(EXAMPLES_DIR)) {
    INDEX_ERROR = `Examples directory not found: ${EXAMPLES_DIR}`;
  } else {
    const files = readdirSync(EXAMPLES_DIR)
      .filter(f => f.endsWith('.senior'))
      .sort();

    for (const file of files) {
      const filePath = join(EXAMPLES_DIR, file);
      const source = readFileSync(filePath, 'utf-8');
      const module = file.replace(/\d+\.senior$/, '');
      const lines = source.split('\n');

      INDEX.push({
        file,
        module,
        moduleDesc: MODULE_DESCRIPTIONS[module] || module,
        title: extractTitle(source, file),
        patterns: detectPatterns(source),
        source,
        lineCount: lines.length,
      });
    }
  }
} catch (err) {
  INDEX_ERROR = `Failed to build example index: ${err.message}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

function extractContext(source, searchTerm, maxLocations = 3) {
  const lines = source.split('\n');
  const lowerTerm = searchTerm.toLowerCase();
  const matchLineNos = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(lowerTerm)) {
      matchLineNos.push(i);
    }
  }

  if (matchLineNos.length === 0) return { context: '', matchCount: 0 };

  // Take up to maxLocations match positions
  const selected = matchLineNos.slice(0, maxLocations);
  const snippets = [];
  const usedLines = new Set();

  for (const lineNo of selected) {
    const start = Math.max(0, lineNo - 5);
    const end = Math.min(lines.length - 1, lineNo + 5);

    // Skip if this range significantly overlaps with already-used lines
    let overlapCount = 0;
    for (let i = start; i <= end; i++) {
      if (usedLines.has(i)) overlapCount++;
    }
    if (overlapCount > 5) continue;

    const snippet = [];
    for (let i = start; i <= end; i++) {
      usedLines.add(i);
      const marker = i === lineNo ? '>>>' : '   ';
      snippet.push(`${marker} ${String(i + 1).padStart(4)}: ${lines[i]}`);
    }
    snippets.push(snippet.join('\n'));
  }

  return {
    context: snippets.join('\n\n    ...\n\n'),
    matchCount: matchLineNos.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTED FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search examples by free text, pattern tag, and/or module prefix.
 * @param {string} search - Free-text search term (required)
 * @param {string} [pattern] - Filter by pattern tag (e.g., "cursor_loop")
 * @param {string} [module] - Filter by module prefix (e.g., "FPRG")
 * @returns {Array} Matching examples with context
 */
export function searchExamples(search, pattern, module) {
  if (INDEX_ERROR) {
    return [{ error: INDEX_ERROR }];
  }
  if (!search || typeof search !== 'string') {
    return [{ error: 'search parameter is required and must be a non-empty string' }];
  }

  let candidates = [...INDEX];

  // Filter by module
  if (module) {
    const modUpper = module.toUpperCase();
    candidates = candidates.filter(e => e.module.toUpperCase() === modUpper);
  }

  // Filter by pattern
  if (pattern) {
    const patLower = pattern.toLowerCase();
    candidates = candidates.filter(e => e.patterns.includes(patLower));
  }

  // Free-text search across multiple fields
  const searchLower = search.toLowerCase();
  const results = [];

  for (const entry of candidates) {
    const searchable = [
      entry.source,
      entry.title,
      entry.module,
      entry.moduleDesc,
      ...entry.patterns,
    ].join('\n').toLowerCase();

    if (!searchable.includes(searchLower)) continue;

    const { context, matchCount } = extractContext(entry.source, search);

    results.push({
      file: entry.file,
      module: entry.module,
      moduleDesc: entry.moduleDesc,
      title: entry.title,
      patterns: entry.patterns,
      lineCount: entry.lineCount,
      matchCount,
      context: '',
      fullSource: false,
    });

    // Store context/source — will decide after counting total results
    results[results.length - 1]._context = context;
    results[results.length - 1]._source = entry.source;
  }

  // Decide: full source for 1-2 matches, context snippets for 3+
  const showFull = results.length <= 2;

  for (const r of results) {
    if (showFull) {
      r.context = r._source;
      r.fullSource = true;
    } else {
      r.context = r._context;
      r.fullSource = false;
    }
    delete r._context;
    delete r._source;
  }

  return results;
}

/**
 * List all indexed examples (summary only, no source code).
 * @returns {Array} Summary of all examples
 */
export function listExamples() {
  if (INDEX_ERROR) {
    return [{ error: INDEX_ERROR }];
  }

  return INDEX.map(e => ({
    file: e.file,
    module: e.module,
    moduleDesc: e.moduleDesc,
    title: e.title,
    patterns: e.patterns,
    lineCount: e.lineCount,
  }));
}

/**
 * Get the full source code for a specific example file.
 * @param {string} filename - Exact filename (e.g., "FPRG800.senior")
 * @returns {string|object} Source code string, or error object
 */
export function getExample(filename) {
  if (INDEX_ERROR) {
    return { error: INDEX_ERROR };
  }
  if (!filename) {
    return { error: 'filename parameter is required' };
  }

  const entry = INDEX.find(
    e => e.file.toLowerCase() === filename.toLowerCase()
  );

  if (!entry) {
    const available = INDEX.map(e => e.file).join(', ');
    return {
      error: `Example "${filename}" not found. Available: ${available}`,
    };
  }

  return entry.source;
}
