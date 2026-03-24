#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

const rootDir = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(rootDir, '.env') });

function parseArgs(argv) {
  const args = {
    output: path.join(rootDir, 'scripts', 'knowledge', 'eval', 'golden-queries.generated.jsonl'),
    docs: 25,
    lsp: 25,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') {
      args.output = path.resolve(rootDir, String(argv[i + 1] || ''));
      i += 1;
      continue;
    }
    if (arg === '--docs') {
      args.docs = Number(argv[i + 1] || 25);
      i += 1;
      continue;
    }
    if (arg === '--lsp') {
      args.lsp = Number(argv[i + 1] || 25);
      i += 1;
      continue;
    }
  }

  if (!Number.isFinite(args.docs) || args.docs < 1) {
    throw new Error('--docs must be >= 1');
  }
  if (!Number.isFinite(args.lsp) || args.lsp < 1) {
    throw new Error('--lsp must be >= 1');
  }

  args.docs = Math.min(200, Math.floor(args.docs));
  args.lsp = Math.min(200, Math.floor(args.lsp));
  return args;
}

function sanitizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_./-]+/g, ' ')
    .trim();
}

function tokenize(text) {
  const stop = new Set([
    'de', 'da', 'do', 'das', 'dos', 'e', 'ou', 'em', 'para', 'com',
    'no', 'na', 'nos', 'nas', 'a', 'o', 'as', 'os', 'um', 'uma',
    'como', 'que', 'por', 'ao', 'se', 'sobre', 'manual', 'pagina',
    'home', 'index',
  ]);
  return sanitizeToken(text)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !stop.has(item));
}

function pickSignals(parts, max = 3) {
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    for (const token of tokenize(part)) {
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function lastHeadingSegment(headingPath, title) {
  const heading = String(headingPath || '').trim();
  if (heading.includes('>')) {
    const pieces = heading.split('>').map((item) => item.trim()).filter(Boolean);
    if (pieces.length > 0) return pieces[pieces.length - 1];
  }
  if (heading) return heading;
  return String(title || '').trim();
}

function toFileStem(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const base = normalized.split('/').pop() || normalized;
  return base.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function fetchDocsRows(client) {
  const sql = `
    SELECT
      chunk_id,
      source_url,
      COALESCE(metadata->>'title', '') AS title,
      heading_path,
      context,
      product,
      version,
      text
    FROM knowledge_chunks
    WHERE domain = 'docs'
      AND source_url IS NOT NULL
      AND source_url <> ''
      AND COALESCE(metadata->>'title', '') <> ''
      AND LENGTH(text) >= 220
    ORDER BY context NULLS LAST, product NULLS LAST, source_url, LENGTH(text) DESC;
  `;
  const result = await client.query(sql);
  return result.rows || [];
}

async function fetchLspRows(client) {
  const sql = `
    SELECT
      chunk_id,
      file_path,
      module,
      routine_name,
      context,
      product,
      version,
      text
    FROM knowledge_chunks
    WHERE domain = 'lsp'
      AND file_path IS NOT NULL
      AND file_path <> ''
      AND LENGTH(text) >= 180
    ORDER BY module NULLS LAST, file_path, LENGTH(text) DESC;
  `;
  const result = await client.query(sql);
  return result.rows || [];
}

function selectDocsQueries(rows, targetCount) {
  const byContext = new Map();
  for (const row of rows) {
    const key = String(row.context || 'geral').trim() || 'geral';
    if (!byContext.has(key)) byContext.set(key, []);
    byContext.get(key).push(row);
  }

  const contexts = Array.from(byContext.keys()).sort();
  const usedSource = new Set();
  const output = [];
  let cursor = 0;

  while (output.length < targetCount) {
    if (contexts.length === 0) break;
    const context = contexts[cursor % contexts.length];
    const list = byContext.get(context) || [];
    while (list.length > 0 && usedSource.has(String(list[0].source_url || ''))) {
      list.shift();
    }
    if (list.length === 0) {
      contexts.splice(cursor % contexts.length, 1);
      continue;
    }

    const row = list.shift();
    const sourceUrl = String(row.source_url || '');
    usedSource.add(sourceUrl);

    const topic = lastHeadingSegment(row.heading_path, row.title);
    const product = String(row.product || '').trim();
    const query = product
      ? `Como configurar ${topic} no ${product}?`
      : `Como configurar ${topic}?`;

    const signals = pickSignals([topic, row.title, row.text], 3);
    const priority = output.length < Math.max(5, Math.floor(targetCount * 0.25)) ? 'high' : 'normal';

    output.push({
      id: `docs-auto-${String(output.length + 1).padStart(3, '0')}`,
      domain: 'docs',
      query,
      priority,
      expected_source_urls: [sourceUrl],
      expected_signals_any: signals,
    });

    cursor += 1;
  }

  return output;
}

function selectLspQueries(rows, targetCount) {
  const byModule = new Map();
  for (const row of rows) {
    const key = String(row.module || 'root').trim() || 'root';
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(row);
  }

  const modules = Array.from(byModule.keys()).sort();
  const usedPath = new Set();
  const output = [];
  let cursor = 0;

  while (output.length < targetCount) {
    if (modules.length === 0) break;
    const moduleName = modules[cursor % modules.length];
    const list = byModule.get(moduleName) || [];
    while (list.length > 0 && usedPath.has(String(list[0].file_path || ''))) {
      list.shift();
    }
    if (list.length === 0) {
      modules.splice(cursor % modules.length, 1);
      continue;
    }

    const row = list.shift();
    const filePath = String(row.file_path || '');
    usedPath.add(filePath);

    const routine = String(row.routine_name || '').trim();
    const stem = toFileStem(filePath);
    const topic = routine || stem;
    const query = moduleName && moduleName !== 'root'
      ? `No LSP, o que faz ${topic} no modulo ${moduleName}?`
      : `No LSP, o que faz ${topic}?`;

    const signals = pickSignals([topic, moduleName, row.text], 3);
    const priority = output.length < Math.max(5, Math.floor(targetCount * 0.25)) ? 'high' : 'normal';

    output.push({
      id: `lsp-auto-${String(output.length + 1).padStart(3, '0')}`,
      domain: 'lsp',
      query,
      priority,
      expected_file_paths: [filePath],
      expected_signals_any: signals,
    });

    cursor += 1;
  }

  return output;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'maxun',
  });

  await client.connect();
  try {
    const docsRows = await fetchDocsRows(client);
    const lspRows = await fetchLspRows(client);

    const docsQueries = selectDocsQueries(docsRows, args.docs);
    const lspQueries = selectLspQueries(lspRows, args.lsp);
    const allQueries = [...docsQueries, ...lspQueries];

    ensureParentDir(args.output);
    fs.writeFileSync(
      args.output,
      `${allQueries.map((item) => JSON.stringify(item)).join('\n')}\n`,
      'utf8'
    );

    console.log(
      JSON.stringify(
        {
          output: args.output,
          docsRequested: args.docs,
          lspRequested: args.lsp,
          docsGenerated: docsQueries.length,
          lspGenerated: lspQueries.length,
          totalGenerated: allQueries.length,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
