#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(rootDir, '.env') });

require('ts-node').register({
  transpileOnly: true,
  project: path.join(rootDir, 'tsconfig.json'),
});

const { DocsIndexerService } = require(path.join(
  rootDir,
  'src',
  'mcp',
  'services',
  'docs-indexer'
));
const { LspIndexerService } = require(path.join(
  rootDir,
  'src',
  'mcp',
  'services',
  'lsp-indexer'
));

function parseList(value) {
  return String(value || '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = {
    domain: 'all',
    fullRebuild: false,
    docsChunksFiles: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--domain') {
      args.domain = String(argv[i + 1] || '').trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--full' || arg === '--full-rebuild') {
      args.fullRebuild = true;
      continue;
    }
    if (arg === '--docs-chunks-file' || arg === '--docs-chunks-files') {
      args.docsChunksFiles.push(...parseList(argv[i + 1]));
      i += 1;
      continue;
    }
  }

  if (!['docs', 'lsp', 'all'].includes(args.domain)) {
    throw new Error(`Invalid --domain value: "${args.domain}". Use docs | lsp | all.`);
  }

  return args;
}

async function runReindex(domain, fullRebuild, docsChunksFiles) {
  const runs = [];
  const errors = [];

  if (domain === 'docs' || domain === 'all') {
    try {
      const docsIndexer = new DocsIndexerService(undefined, undefined, {
        docsChunksFiles,
      });
      runs.push(await docsIndexer.reindex(fullRebuild));
    } catch (error) {
      errors.push({
        domain: 'docs',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (domain === 'lsp' || domain === 'all') {
    try {
      const lspIndexer = new LspIndexerService();
      runs.push(await lspIndexer.reindex(fullRebuild));
    } catch (error) {
      errors.push({
        domain: 'lsp',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { runs, errors };
}

async function main() {
  const { domain, fullRebuild, docsChunksFiles } = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  const { runs, errors } = await runReindex(domain, fullRebuild, docsChunksFiles);
  const durationMs = Date.now() - startedAt;

  const output = {
    domain,
    fullRebuild,
    docsChunksFiles,
    durationMs,
    runs,
    errors,
  };

  console.log(JSON.stringify(output, null, 2));
  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
