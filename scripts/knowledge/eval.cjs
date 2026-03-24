#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(rootDir, '.env') });

require('ts-node').register({
  transpileOnly: true,
  project: path.join(rootDir, 'tsconfig.json'),
});

const { KnowledgeSearchService } = require(path.join(
  rootDir,
  'src',
  'mcp',
  'services',
  'knowledge-search'
));

function parseArgs(argv) {
  const args = {
    dataset: path.join(rootDir, 'scripts', 'knowledge', 'eval', 'golden-queries.jsonl'),
    topK: 10,
    outputJson: '',
    outputMd: '',
    domain: 'all',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dataset') {
      args.dataset = path.resolve(rootDir, String(argv[i + 1] || ''));
      i += 1;
      continue;
    }
    if (arg === '--top-k') {
      args.topK = Number(argv[i + 1] || 10);
      i += 1;
      continue;
    }
    if (arg === '--output-json') {
      args.outputJson = path.resolve(rootDir, String(argv[i + 1] || ''));
      i += 1;
      continue;
    }
    if (arg === '--output-md') {
      args.outputMd = path.resolve(rootDir, String(argv[i + 1] || ''));
      i += 1;
      continue;
    }
    if (arg === '--domain') {
      args.domain = String(argv[i + 1] || 'all').toLowerCase();
      i += 1;
      continue;
    }
  }

  if (!Number.isFinite(args.topK) || args.topK < 1 || args.topK > 30) {
    throw new Error('--top-k must be an integer between 1 and 30.');
  }

  if (!['docs', 'lsp', 'all'].includes(args.domain)) {
    throw new Error('--domain must be docs | lsp | all.');
  }

  return args;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readDataset(filePath, domainFilter) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Dataset file not found: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const tests = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '').trim();
    if (!line || line.startsWith('#')) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON at ${filePath}:${i + 1}`);
    }

    const query = String(parsed.query || '').trim();
    const domain = String(parsed.domain || 'docs').toLowerCase();
    if (!query) continue;
    if (!['docs', 'lsp'].includes(domain)) continue;
    if (domainFilter !== 'all' && domain !== domainFilter) continue;

    const filters = parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {};
    tests.push({
      id: String(parsed.id || `q${tests.length + 1}`),
      query,
      domain,
      topK: Math.min(30, Math.max(1, Number(parsed.top_k || 10))),
      priority: String(parsed.priority || 'normal').toLowerCase(),
      filters: {
        context: filters.context ? String(filters.context) : undefined,
        product: filters.product ? String(filters.product) : undefined,
        version: filters.version ? String(filters.version) : undefined,
        module: filters.module ? String(filters.module) : undefined,
        routineName: filters.routine_name ? String(filters.routine_name) : undefined,
      },
      expectedSignalsAll: toList(parsed.expected_signals_all || parsed.expected_signals),
      expectedSignalsAny: toList(parsed.expected_signals_any),
      expectedChunkIds: toList(parsed.expected_chunk_ids),
      expectedSourceUrls: toList(parsed.expected_source_urls),
      expectedFilePaths: toList(parsed.expected_file_paths),
    });
  }

  return tests;
}

function toList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function includesCaseInsensitive(target, text) {
  return String(target || '').toLowerCase().includes(String(text || '').toLowerCase());
}

function buildResultHaystack(result) {
  return [
    result.chunkId,
    result.sourceUrl,
    result.filePath,
    result.module,
    result.routineName,
    result.headingPath,
    result.context,
    result.product,
    result.version,
    result.text,
    JSON.stringify(result.metadata || {}),
  ]
    .map((item) => String(item || ''))
    .join('\n')
    .toLowerCase();
}

function matchesExpectation(result, test) {
  const checks = [];
  const haystack = buildResultHaystack(result);

  if (test.expectedChunkIds.length > 0) {
    checks.push(test.expectedChunkIds.some((value) => String(result.chunkId || '') === value));
  }

  if (test.expectedSourceUrls.length > 0) {
    checks.push(
      test.expectedSourceUrls.some((value) =>
        includesCaseInsensitive(String(result.sourceUrl || ''), value)
      )
    );
  }

  if (test.expectedFilePaths.length > 0) {
    checks.push(
      test.expectedFilePaths.some((value) =>
        includesCaseInsensitive(String(result.filePath || ''), value)
      )
    );
  }

  if (test.expectedSignalsAll.length > 0 || test.expectedSignalsAny.length > 0) {
    const allOk = test.expectedSignalsAll.every((signal) => haystack.includes(signal.toLowerCase()));
    const anyOk =
      test.expectedSignalsAny.length === 0 ||
      test.expectedSignalsAny.some((signal) => haystack.includes(signal.toLowerCase()));
    checks.push(allOk && anyOk);
  }

  if (checks.length === 0) return false;
  return checks.some(Boolean);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[index];
}

function formatRatio(value) {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : 0;
}

function createDomainAccumulator() {
  return {
    docs: {
      totalQueries: 0,
      evaluated: 0,
      hitsAt3: 0,
      hitsAt5: 0,
      mrrAt10Sum: 0,
      latencies: [],
    },
    lsp: {
      totalQueries: 0,
      evaluated: 0,
      hitsAt3: 0,
      hitsAt5: 0,
      mrrAt10Sum: 0,
      latencies: [],
    },
  };
}

function finalizeDomainMetrics(acc) {
  const output = {};
  for (const domain of ['docs', 'lsp']) {
    const item = acc[domain];
    output[domain] = {
      totalQueries: item.totalQueries,
      queriesWithExpectations: item.evaluated,
      recallAt3: item.evaluated === 0 ? 0 : item.hitsAt3 / item.evaluated,
      recallAt5: item.evaluated === 0 ? 0 : item.hitsAt5 / item.evaluated,
      mrrAt10: item.evaluated === 0 ? 0 : item.mrrAt10Sum / item.evaluated,
      latencyMs: {
        p50: percentile(item.latencies, 50),
        p95: percentile(item.latencies, 95),
      },
    };
  }
  return output;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# Knowledge Eval Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Dataset: ${report.dataset}`);
  lines.push(`- Domain filter: ${report.domain}`);
  lines.push(`- Queries: ${report.summary.totalQueries}`);
  lines.push(`- Queries with expectations: ${report.summary.queriesWithExpectations}`);
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push(`- Recall@3: ${formatRatio(report.metrics.recallAt3)}%`);
  lines.push(`- Recall@5: ${formatRatio(report.metrics.recallAt5)}%`);
  lines.push(`- MRR@10: ${formatRatio(report.metrics.mrrAt10)}%`);
  lines.push(`- Latency p50: ${report.metrics.latencyMs.p50} ms`);
  lines.push(`- Latency p95: ${report.metrics.latencyMs.p95} ms`);
  lines.push('');
  lines.push('## Metrics by Domain');
  lines.push('');

  for (const domain of ['docs', 'lsp']) {
    const metric = report.metricsByDomain[domain];
    lines.push(`### ${domain.toUpperCase()}`);
    lines.push(`- Queries: ${metric.totalQueries}`);
    lines.push(`- Queries with expectations: ${metric.queriesWithExpectations}`);
    lines.push(`- Recall@3: ${formatRatio(metric.recallAt3)}%`);
    lines.push(`- Recall@5: ${formatRatio(metric.recallAt5)}%`);
    lines.push(`- MRR@10: ${formatRatio(metric.mrrAt10)}%`);
    lines.push(`- Latency p50: ${metric.latencyMs.p50} ms`);
    lines.push(`- Latency p95: ${metric.latencyMs.p95} ms`);
    lines.push('');
  }

  lines.push('## Misses');
  lines.push('');

  const misses = report.results.filter((item) => !item.hitAt5);
  if (misses.length === 0) {
    lines.push('- None');
  } else {
    for (const miss of misses) {
      lines.push(`- [${miss.id}] (${miss.domain}) ${miss.query}`);
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const tests = readDataset(args.dataset, args.domain);
  if (tests.length === 0) {
    throw new Error('No valid queries found in dataset.');
  }

  const service = new KnowledgeSearchService();
  const statsBefore = await service.stats();
  const latencies = [];
  const results = [];
  let evaluated = 0;
  let hitsAt3 = 0;
  let hitsAt5 = 0;
  let mrrAt10Sum = 0;
  const domainAccumulator = createDomainAccumulator();

  for (const test of tests) {
    const hasExpectation =
      test.expectedSignalsAll.length > 0 ||
      test.expectedSignalsAny.length > 0 ||
      test.expectedChunkIds.length > 0 ||
      test.expectedSourceUrls.length > 0 ||
      test.expectedFilePaths.length > 0;

    const startedAt = Date.now();
    const rows = await service.search(
      test.query,
      {
        domain: test.domain,
        context: test.filters.context,
        product: test.filters.product,
        version: test.filters.version,
        module: test.filters.module,
        routineName: test.filters.routineName,
      },
      Math.min(args.topK, test.topK)
    );
    const latencyMs = Date.now() - startedAt;
    latencies.push(latencyMs);
    domainAccumulator[test.domain].totalQueries += 1;
    domainAccumulator[test.domain].latencies.push(latencyMs);

    let firstHitRank = -1;
    if (hasExpectation) {
      for (let i = 0; i < rows.length && i < 10; i += 1) {
        if (matchesExpectation(rows[i], test)) {
          firstHitRank = i + 1;
          break;
        }
      }
      evaluated += 1;
      domainAccumulator[test.domain].evaluated += 1;
      if (firstHitRank > 0 && firstHitRank <= 3) hitsAt3 += 1;
      if (firstHitRank > 0 && firstHitRank <= 3) domainAccumulator[test.domain].hitsAt3 += 1;
      if (firstHitRank > 0 && firstHitRank <= 5) hitsAt5 += 1;
      if (firstHitRank > 0 && firstHitRank <= 5) domainAccumulator[test.domain].hitsAt5 += 1;
      if (firstHitRank > 0) mrrAt10Sum += 1 / firstHitRank;
      if (firstHitRank > 0) domainAccumulator[test.domain].mrrAt10Sum += 1 / firstHitRank;
    }

    results.push({
      id: test.id,
      query: test.query,
      domain: test.domain,
      priority: test.priority,
      latencyMs,
      resultCount: rows.length,
      hasExpectation,
      firstHitRank,
      hitAt3: firstHitRank > 0 && firstHitRank <= 3,
      hitAt5: firstHitRank > 0 && firstHitRank <= 5,
      topResults: rows.slice(0, Math.min(5, rows.length)).map((row, index) => ({
        rank: index + 1,
        chunkId: row.chunkId,
        score: row.score,
        vectorScore: row.vectorScore,
        textScore: row.textScore,
        sourceUrl: row.sourceUrl,
        filePath: row.filePath,
        headingPath: row.headingPath,
      })),
    });
  }

  const report = {
    generatedAt,
    dataset: args.dataset,
    domain: args.domain,
    summary: {
      totalQueries: tests.length,
      queriesWithExpectations: evaluated,
    },
    metrics: {
      recallAt3: evaluated === 0 ? 0 : hitsAt3 / evaluated,
      recallAt5: evaluated === 0 ? 0 : hitsAt5 / evaluated,
      mrrAt10: evaluated === 0 ? 0 : mrrAt10Sum / evaluated,
      latencyMs: {
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
      },
    },
    metricsByDomain: finalizeDomainMetrics(domainAccumulator),
    statsSnapshot: statsBefore,
    results,
  };

  const defaultOutputDir = path.join(rootDir, 'output', 'knowledge-eval');
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const outputJson = args.outputJson || path.join(defaultOutputDir, `report-${stamp}.json`);
  const outputMd = args.outputMd || path.join(defaultOutputDir, `report-${stamp}.md`);
  ensureDir(outputJson);
  ensureDir(outputMd);
  fs.writeFileSync(outputJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outputMd, buildMarkdown(report), 'utf8');

  console.log(
    JSON.stringify(
      {
        outputJson,
        outputMd,
        metrics: report.metrics,
        summary: report.summary,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
