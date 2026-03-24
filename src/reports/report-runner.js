/**
 * Senior HCM Report Runner
 * Execute reports via SOAP API or direct SQL queries using predefined templates.
 *
 * Usage:
 *   node report-runner.js --list-queries              List all SQL query templates
 *   node report-runner.js --query employee-roster      Run a predefined query template
 *   node report-runner.js --query employee-roster --param numEmp=2
 *   node report-runner.js --sql "SELECT TOP 5 * FROM r034fun" --db vetorh
 *   node report-runner.js --module sapiens --report "ReportName" --format PDF
 *   node report-runner.js --list-reports               List report model files on disk
 *   node report-runner.js --list-models                List models registered in r910mdg
 *   node report-runner.js --list-models --sysmod FP    Filter by sysmod (FP=rubi, BS=bs)
 *   node report-runner.js --module rubi --report "FPRE001.COL" --async   Async mode
 *   node report-runner.js --module rubi --report "FPRE001.COL" --skip-validation
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SENIOR_ROOT = process.env.SENIOR_ROOT || 'C:/Senior';

// ── Configuration ──────────────────────────────────────────────────────────────

const CONFIG = {
  host: 'localhost',
  port: 8080,
  user: 'senior',
  password: 'senior',
  outputDir: path.resolve(__dirname, '..', 'discovery', 'reports'),
  sqlTemplatesPath: path.resolve(__dirname, '..', 'discovery', 'reports', 'sql-templates.json'),
  soapTemplatesPath: path.resolve(__dirname, '..', 'discovery', 'reports', 'soap-templates.json'),
};

const DB_CONFIG = {
  vetorh: { server: 'localhost\\sqlexpress,60156', user: 'vetorh', password: 'vetorh', database: 'vetorh' },
  sapiens: { server: 'localhost\\sqlexpress,60156', user: 'sapiens', password: 'sapiens', database: 'sapiens' },
};

// ── Module code → sysmod mapping (from r910mdg investigation) ─────────────────
// r910mdg.sysmod values: 'FP' (payroll/rubi, 486 models), 'BS' (benefits, 14 models)
// The sysmod field in the DB uses uppercase abbreviations, not the SOAP endpoint prefix.
const SYSMOD_TO_MODULE = {
  FP: 'rubi',
  BS: 'bs',
};

// ── SOAP Services ──────────────────────────────────────────────────────────────

const REPORT_SERVICES = {
  sapiens: {
    path: '/g5-senior-services/sapiens_Synccom_senior_g5_co_ger_relatorio',
    namespace: 'com.senior.g5.co.ger.relatorio',
    operation: 'Executar',
  },
  rubi: {
    path: '/g5-senior-services/rubi_Synccom_senior_g5_rh_fp_relatorios',
    namespace: 'com.senior.g5.rh.fp.relatorios',
    operation: 'Relatorios',
  },
  bs: {
    path: '/g5-senior-services/bs_Synccom_senior_g5_rh_bs_relatorios',
    namespace: 'com.senior.g5.rh.bs.relatorios',
    operation: 'Relatorios',
  },
  rs: {
    path: '/g5-senior-services/rs_Synccom_senior_g5_rh_rs_relatorios',
    namespace: 'com.senior.g5.rh.rs.relatorios',
    operation: 'Relatorios',
  },
  cs: {
    path: '/g5-senior-services/cs_Synccom_senior_g5_rh_cs_relatorios',
    namespace: 'com.senior.g5.rh.cs.relatorios',
    operation: 'Relatorios',
  },
  sm: {
    path: '/g5-senior-services/sm_Synccom_senior_g5_rh_sm_relatorios',
    namespace: 'com.senior.g5.rh.sm.relatorios',
    operation: 'Relatorios',
  },
  tr: {
    path: '/g5-senior-services/tr_Synccom_senior_g5_rh_tr_relatorios',
    namespace: 'com.senior.g5.rh.tr.relatorios',
    operation: 'Relatorios',
  },
};

// ── Template Loading ───────────────────────────────────────────────────────────

function loadSqlTemplates() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG.sqlTemplatesPath, 'utf-8'));
    const map = {};
    for (const t of data.templates) {
      map[t.id] = t;
    }
    return map;
  } catch (err) {
    console.error(`Warning: Could not load SQL templates from ${CONFIG.sqlTemplatesPath}: ${err.message}`);
    return {};
  }
}

function resolveTemplateParams(sql, paramDefs, userParams) {
  let resolved = sql;
  for (const pdef of (paramDefs || [])) {
    const value = userParams[pdef.name] !== undefined ? userParams[pdef.name] : pdef.default;
    if (value === undefined) {
      console.error(`Missing required parameter: ${pdef.name} (${pdef.description})`);
      process.exit(1);
    }
    // Replace $(paramName) with value - use global replace
    const regex = new RegExp('\\$\\(' + pdef.name + '\\)', 'g');
    resolved = resolved.replace(regex, String(value));
  }
  return resolved;
}

// ── SOAP ───────────────────────────────────────────────────────────────────────

function buildSoapEnvelope(operation, params, authParams = {}) {
  const paramXml = Object.entries(params)
    .map(([k, v]) => `        <${k}>${escapeXml(String(v))}</${k}>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ser="http://services.senior.com.br">
  <soapenv:Header/>
  <soapenv:Body>
    <ser:${operation}>
      <user>${escapeXml(authParams.user || CONFIG.user)}</user>
      <password>${escapeXml(authParams.password || CONFIG.password)}</password>
      <encryption>0</encryption>
      <parameters>
${paramXml}
      </parameters>
    </ser:${operation}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function soapCall(servicePath, operation, params, authParams = {}) {
  return new Promise((resolve, reject) => {
    const body = buildSoapEnvelope(operation, params, authParams);
    const req = http.request({
      hostname: CONFIG.host,
      port: CONFIG.port,
      path: servicePath,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': `"${operation}"`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 60000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── SQL Execution ──────────────────────────────────────────────────────────────

function sqlQuery(database, query) {
  const db = DB_CONFIG[database];
  if (!db) {
    return `Error: Unknown database '${database}'. Available: ${Object.keys(DB_CONFIG).join(', ')}`;
  }

  // Security: only allow SELECT statements
  const trimmed = query.replace(/\s+/g, ' ').trim();
  const firstWord = trimmed.split(/\s/)[0].toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    return `Error: Only SELECT and WITH (CTE) queries are allowed. Got: ${firstWord}`;
  }

  try {
    return execSync(
      `sqlcmd -S "${db.server}" -U ${db.user} -P ${db.password} -d ${db.database} -W -s "|" -Q "${trimmed.replace(/"/g, '\\"')}"`,
      { encoding: 'utf-8', timeout: 60000 }
    );
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

function formatAsMarkdownTable(rawOutput) {
  const lines = rawOutput.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return rawOutput;

  // First line is headers, second is dashes separator
  const headers = lines[0].split('|').map(h => h.trim());
  const separator = headers.map(h => '-'.repeat(Math.max(h.length, 3)));

  const dataLines = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip summary lines like "(N rows affected)"
    if (line.startsWith('(') && line.endsWith(')')) continue;
    if (line === '') continue;
    dataLines.push(line.split('|').map(c => c.trim()));
  }

  if (dataLines.length === 0) return '(no data)\n';

  // Calculate column widths
  const widths = headers.map((h, i) => {
    let max = h.length;
    for (const row of dataLines) {
      if (row[i] && row[i].length > max) max = row[i].length;
    }
    return max;
  });

  // Build markdown table
  const pad = (s, w) => (s || '').padEnd(w);
  let result = '| ' + headers.map((h, i) => pad(h, widths[i])).join(' | ') + ' |\n';
  result += '| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |\n';
  for (const row of dataLines) {
    result += '| ' + headers.map((_, i) => pad(row[i], widths[i])).join(' | ') + ' |\n';
  }
  result += `\n(${dataLines.length} rows)\n`;

  return result;
}

// ── SOAP Report Execution ──────────────────────────────────────────────────────

async function executeReport(module, reportName, format = 'PDF', entrada = '', skipValidation = false) {
  const svc = REPORT_SERVICES[module];
  if (!svc) {
    console.error(`Unknown module: ${module}. Available: ${Object.keys(REPORT_SERVICES).join(', ')}`);
    return null;
  }

  // Validate model against r910mdg registry before calling SOAP
  if (!skipValidation) {
    const check = validateModelInRegistry(reportName);
    if (!check.valid) {
      console.error(`\nValidation error: ${check.message}\n`);
      console.error(`Use --list-models to see all registered models.`);
      return null;
    }
    // Warn if caller specified a module that doesn't match the registry sysmod
    if (check.mappedModule && check.mappedModule !== module) {
      console.warn(`Warning: r910mdg maps "${check.row.nommod}" to module "${check.mappedModule}" (sysmod=${check.row.sysmod}), but you specified --module ${module}.`);
      console.warn(`Consider using --module ${check.mappedModule} instead.`);
    }
  }

  console.log(`Executing report: ${reportName} (${module}, format: ${format})`);

  const params = {
    prRelatorio: reportName,
    prPrintDest: 'A',
    prExecFmt: format,
    prDir: CONFIG.outputDir.replace(/\//g, '\\'),
    prFileName: `report_${reportName}_${Date.now()}`,
  };

  if (entrada) {
    params.prEntrada = entrada;
    params.prEntranceIsXML = 'true';
  }

  try {
    const result = await soapCall(svc.path, svc.operation, params);
    console.log(`Status: ${result.status}`);

    const errorMatch = result.body.match(/<erroExecucao>(.*?)<\/erroExecucao>/s);
    const logMatch = result.body.match(/<prLOG>(.*?)<\/prLOG>/s);
    const retornoMatch = result.body.match(/<prRetorno>(.*?)<\/prRetorno>/s);

    if (errorMatch && errorMatch[1] && errorMatch[1].trim()) {
      console.log(`Error: ${errorMatch[1].trim()}`);
    }
    if (logMatch && logMatch[1] && logMatch[1].trim()) {
      console.log(`Log: ${logMatch[1].trim().substring(0, 200)}`);
    }

    // If prRetorno has base64 content, save as file
    if (retornoMatch && retornoMatch[1] && retornoMatch[1].trim().length > 10) {
      const ext = format.toLowerCase() === 'pdf' ? '.pdf' : format.toLowerCase() === 'xls' ? '.xls' : `.${format.toLowerCase()}`;
      const outFile = path.join(CONFIG.outputDir, `${reportName}${ext}`);
      const buf = Buffer.from(retornoMatch[1].trim(), 'base64');
      fs.mkdirSync(CONFIG.outputDir, { recursive: true });
      fs.writeFileSync(outFile, buf);
      console.log(`Report saved: ${outFile} (${buf.length} bytes)`);
      return outFile;
    }

    // Save raw response for debugging
    const responseFile = path.join(CONFIG.outputDir, `response_${reportName}_${Date.now()}.xml`);
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    fs.writeFileSync(responseFile, result.body);
    console.log(`Response saved to: ${responseFile}`);
    return null;
  } catch (err) {
    console.error(`Failed: ${err.message}`);
    return null;
  }
}

// ── Batch Report Execution ──────────────────────────────────────────────────

async function executeBatchReports(reportListPath) {
  const reportList = JSON.parse(fs.readFileSync(reportListPath, 'utf-8'));
  const reports = reportList.reports || [];
  const results = [];

  console.log(`\n=== Batch Report Execution: ${reports.length} reports ===\n`);

  for (const report of reports) {
    const module = report.soap_module || 'rubi';
    const modelCode = report.model_code;
    const entrada = report.required_params?.prEntrada || '';

    console.log(`\n[${report.rank}/${reports.length}] ${modelCode} — ${report.name}`);

    try {
      const outFile = await executeReport(module, modelCode, 'PDF', entrada);
      results.push({ rank: report.rank, id: report.id, model: modelCode, status: outFile ? 'success' : 'no_output', file: outFile });
    } catch (err) {
      results.push({ rank: report.rank, id: report.id, model: modelCode, status: 'error', error: err.message });
    }
  }

  // Summary
  console.log(`\n=== Batch Summary ===`);
  const success = results.filter(r => r.status === 'success').length;
  const noOutput = results.filter(r => r.status === 'no_output').length;
  const errors = results.filter(r => r.status === 'error').length;
  console.log(`Success: ${success} | No output: ${noOutput} | Errors: ${errors}`);

  const summaryFile = path.join(CONFIG.outputDir, 'batch-results.json');
  fs.writeFileSync(summaryFile, JSON.stringify({ generated: new Date().toISOString(), results }, null, 2));
  console.log(`Results saved to: ${summaryFile}`);
}

// ── r910mdg Model Registry ─────────────────────────────────────────────────────

/**
 * Query r910mdg for all registered report models.
 * Returns an array of { nommod, extmod, sysmod, desmod } objects, or null on error.
 */
function fetchRegisteredModels() {
  const sql = 'SELECT nommod, extmod, sysmod, desmod FROM r910mdg ORDER BY sysmod, nommod';
  const raw = sqlQuery('vetorh', sql);
  if (raw.startsWith('Error:')) {
    console.error(`Failed to query r910mdg: ${raw}`);
    return null;
  }

  const lines = raw.trim().split('\n').filter(l => l.trim());
  // lines[0] = header, lines[1] = dashes, lines[2..] = data rows
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('(') && line.endsWith(')')) continue;
    if (!line) continue;
    const cols = line.split('|').map(c => c.trim());
    if (cols.length >= 4) {
      rows.push({ nommod: cols[0], extmod: cols[1], sysmod: cols[2], desmod: cols[3] });
    }
  }
  return rows;
}

/**
 * Validate that a report model name exists in r910mdg before calling SOAP.
 * Returns { valid: true, row } on success or { valid: false, message } on failure.
 */
function validateModelInRegistry(reportName) {
  const models = fetchRegisteredModels();
  if (!models) {
    return { valid: false, message: 'Could not reach r910mdg registry — DB unavailable.' };
  }

  // nommod includes the extension, e.g. "FPRE001.COL"
  // Accept both bare name and full name with extension
  const upper = reportName.toUpperCase();
  let row = models.find(r => r.nommod.toUpperCase() === upper);
  if (!row) {
    // Try prefix match (caller passed "FPRE001" without extension)
    row = models.find(r => r.nommod.toUpperCase().startsWith(upper + '.'));
  }

  if (!row) {
    const candidates = models
      .filter(r => r.nommod.toUpperCase().includes(upper))
      .slice(0, 5)
      .map(r => `  ${r.nommod} (${r.sysmod} → ${SYSMOD_TO_MODULE[r.sysmod] || r.sysmod})`)
      .join('\n');

    return {
      valid: false,
      message:
        `Model "${reportName}" is not registered in r910mdg.\n` +
        `Only FP (486 models) and BS (14 models) are registered.\n` +
        (candidates ? `Similar models found:\n${candidates}` : 'No similar models found.'),
    };
  }

  const mappedModule = SYSMOD_TO_MODULE[row.sysmod];
  return { valid: true, row, mappedModule };
}

// ── Async Report Execution ─────────────────────────────────────────────────────

const ASYNC_SERVICE = {
  path: '/g5-senior-services/sapiens_Synccom_senior_g5_co_int_geral_relatorio',
  startOperation: 'IniciarGeracao',
  pollOperation: 'ObterSituacao',
};

/**
 * Execute a report asynchronously using IniciarGeracao + polling ObterSituacao.
 * Based on async-report-start / async-report-poll templates in soap-templates.json.
 */
async function executeReportAsync(module, reportName, format = 'PDF', entrada = '') {
  const svc = REPORT_SERVICES[module];
  if (!svc) {
    console.error(`Unknown module: ${module}. Available: ${Object.keys(REPORT_SERVICES).join(', ')}`);
    return null;
  }

  console.log(`[async] Starting generation: ${reportName} (${module}, format: ${format})`);

  const startParams = {
    prRelatorio: reportName,
    prPrintDest: 'A',
    prExecFmt: format,
    prDir: CONFIG.outputDir.replace(/\//g, '\\'),
    prFileName: `report_${reportName}_${Date.now()}`,
  };

  if (entrada) {
    startParams.prEntrada = entrada;
    startParams.prEntranceIsXML = 'true';
  }

  let generationId;
  try {
    const startResult = await soapCall(ASYNC_SERVICE.path, ASYNC_SERVICE.startOperation, startParams);
    console.log(`[async] IniciarGeracao status: ${startResult.status}`);

    const idMatch = startResult.body.match(/<prIdGeracao>(.*?)<\/prIdGeracao>/s);
    const errMatch = startResult.body.match(/<erroExecucao>(.*?)<\/erroExecucao>/s);

    if (errMatch && errMatch[1] && errMatch[1].trim()) {
      console.error(`[async] Error starting generation: ${errMatch[1].trim()}`);
      return null;
    }

    if (!idMatch || !idMatch[1] || !idMatch[1].trim()) {
      console.error(`[async] No generation ID returned. Raw response saved.`);
      const debugFile = path.join(CONFIG.outputDir, `async_start_${reportName}_${Date.now()}.xml`);
      fs.mkdirSync(CONFIG.outputDir, { recursive: true });
      fs.writeFileSync(debugFile, startResult.body);
      console.error(`  Saved to: ${debugFile}`);
      return null;
    }

    generationId = idMatch[1].trim();
    console.log(`[async] Generation ID: ${generationId}`);
  } catch (err) {
    console.error(`[async] Failed to start generation: ${err.message}`);
    return null;
  }

  // Poll ObterSituacao until complete (prSituacao: P=Processing, C=Complete, E=Error)
  const maxAttempts = 60;
  const pollIntervalMs = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    try {
      const pollResult = await soapCall(ASYNC_SERVICE.path, ASYNC_SERVICE.pollOperation, { prIdGeracao: generationId });
      const situacao = (pollResult.body.match(/<prSituacao>(.*?)<\/prSituacao>/s) || [])[1]?.trim() || '';
      const pollErr = (pollResult.body.match(/<prError>(.*?)<\/prError>/s) || [])[1]?.trim() || '';

      console.log(`[async] Poll ${attempt}/${maxAttempts}: situacao=${situacao || '(empty)'}`);

      if (situacao === 'E' || (pollErr && !situacao)) {
        console.error(`[async] Generation failed: ${pollErr || 'unknown error'}`);
        return null;
      }

      if (situacao === 'C') {
        console.log(`[async] Generation complete.`);
        const retornoMatch = pollResult.body.match(/<prRetorno>(.*?)<\/prRetorno>/s);
        if (retornoMatch && retornoMatch[1] && retornoMatch[1].trim().length > 10) {
          const ext = format.toLowerCase() === 'pdf' ? '.pdf' : format.toLowerCase() === 'xls' ? '.xls' : `.${format.toLowerCase()}`;
          const outFile = path.join(CONFIG.outputDir, `${reportName}${ext}`);
          fs.mkdirSync(CONFIG.outputDir, { recursive: true });
          fs.writeFileSync(outFile, Buffer.from(retornoMatch[1].trim(), 'base64'));
          console.log(`[async] Report saved: ${outFile}`);
          return outFile;
        }
        // Complete but no inline content — file may have been written server-side
        const responseFile = path.join(CONFIG.outputDir, `async_response_${reportName}_${Date.now()}.xml`);
        fs.writeFileSync(responseFile, pollResult.body);
        console.log(`[async] No inline content. Raw response: ${responseFile}`);
        return null;
      }
      // situacao === 'P' or empty — keep polling
    } catch (err) {
      console.error(`[async] Poll error (attempt ${attempt}): ${err.message}`);
    }
  }

  console.error(`[async] Timed out after ${maxAttempts} polls (${(maxAttempts * pollIntervalMs / 1000)}s).`);
  return null;
}

// ── List Commands ──────────────────────────────────────────────────────────────

function listQueries() {
  const templates = loadSqlTemplates();
  const keys = Object.keys(templates);

  if (keys.length === 0) {
    console.log('No SQL templates found. Check: ' + CONFIG.sqlTemplatesPath);
    return;
  }

  console.log('=== SQL Query Templates ===\n');
  console.log(`Loaded from: ${CONFIG.sqlTemplatesPath}\n`);

  for (const key of keys) {
    const t = templates[key];
    const paramStr = (t.params || []).length > 0
      ? t.params.map(p => `${p.name}=${p.default !== undefined ? p.default : '?'}`).join(', ')
      : 'none';
    console.log(`  ${t.id}`);
    console.log(`    ${t.name} - ${t.description}`);
    console.log(`    Database: ${t.database} | Tables: ${t.joins.join(', ')} | Params: ${paramStr}`);
    console.log();
  }

  console.log(`Total: ${keys.length} templates\n`);
  console.log('Run with: node report-runner.js --query <id> [--param key=value ...]');
}

function listReportModels() {
  console.log('=== Report Models on Disk ===\n');

  const modelDirs = [
    { dir: `${SENIOR_ROOT}/Vetorh/Modelos/`, label: 'Vetorh (HCM)' },
    { dir: `${SENIOR_ROOT}/Sapiens/Modelos/`, label: 'Sapiens (ERP)' },
  ];

  for (const { dir, label } of modelDirs) {
    console.log(`--- ${label} ---`);
    try {
      const files = fs.readdirSync(dir);
      console.log(`  ${files.length} report models found`);
      files.slice(0, 20).forEach(f => console.log(`  ${f}`));
      if (files.length > 20) console.log(`  ... and ${files.length - 20} more`);
    } catch {
      console.log(`  Directory not found or empty`);
    }
    console.log();
  }
}

function listRegisteredModels(filterSysmod) {
  console.log('=== Registered Report Models (r910mdg) ===\n');

  const models = fetchRegisteredModels();
  if (!models) {
    console.error('Could not retrieve models from r910mdg.');
    return;
  }

  let filtered = models;
  if (filterSysmod) {
    filtered = models.filter(m => m.sysmod.toUpperCase() === filterSysmod.toUpperCase());
    console.log(`Filtered by sysmod: ${filterSysmod.toUpperCase()}\n`);
  }

  if (filtered.length === 0) {
    console.log('No models found.');
    return;
  }

  // Group by sysmod for display
  const byModule = {};
  for (const row of filtered) {
    if (!byModule[row.sysmod]) byModule[row.sysmod] = [];
    byModule[row.sysmod].push(row);
  }

  for (const [sysmod, rows] of Object.entries(byModule)) {
    const mappedModule = SYSMOD_TO_MODULE[sysmod] || sysmod.toLowerCase();
    console.log(`--- ${sysmod} → module: ${mappedModule} (${rows.length} models) ---`);
    for (const r of rows) {
      const desc = r.desmod ? r.desmod.substring(0, 60) : '';
      console.log(`  ${r.nommod.padEnd(20)} ${desc}`);
    }
    console.log();
  }

  console.log(`Total: ${filtered.length} registered models`);
  console.log(`\nNote: prRelatorio must match the full nommod value (e.g., "FPRE001.COL")`);
  console.log(`      Use --module with the mapped module name shown above.\n`);
}

// ── SQL Execution with Templates ───────────────────────────────────────────────

function executeTemplateQuery(queryId, userParams) {
  const templates = loadSqlTemplates();
  const template = templates[queryId];

  if (!template) {
    console.error(`Unknown query template: '${queryId}'`);
    console.error(`Available: ${Object.keys(templates).join(', ')}`);
    process.exit(1);
  }

  console.log(`=== ${template.name} ===`);
  console.log(`${template.description}\n`);

  const resolvedSql = resolveTemplateParams(template.sql, template.params, userParams);

  console.log(`Database: ${template.database}`);
  console.log(`Tables: ${template.joins.join(', ')}`);
  if (Object.keys(userParams).length > 0) {
    console.log(`Params: ${JSON.stringify(userParams)}`);
  }
  console.log(`SQL: ${resolvedSql.substring(0, 120)}${resolvedSql.length > 120 ? '...' : ''}\n`);

  const rawResult = sqlQuery(template.database, resolvedSql);

  if (rawResult.startsWith('Error:')) {
    console.error(rawResult);
    return;
  }

  console.log(formatAsMarkdownTable(rawResult));

  // Show field legend
  if (template.fields) {
    console.log('Field Legend:');
    for (const [field, desc] of Object.entries(template.fields)) {
      console.log(`  ${field}: ${desc}`);
    }
  }
}

function executeArbitrarySql(database, query) {
  console.log(`=== SQL Query on ${database} ===`);
  console.log(`SQL: ${query}\n`);

  const rawResult = sqlQuery(database, query);

  if (rawResult.startsWith('Error:')) {
    console.error(rawResult);
    return;
  }

  console.log(formatAsMarkdownTable(rawResult));
}

// ── Argument Parsing ───────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { flags: new Set(), values: {}, params: {} };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--param' && args[i + 1]) {
      const kv = args[i + 1];
      const eqIdx = kv.indexOf('=');
      if (eqIdx > 0) {
        result.params[kv.substring(0, eqIdx)] = kv.substring(eqIdx + 1);
      }
      i++;
    } else if (arg.startsWith('--')) {
      const key = arg.substring(2);
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        result.values[key] = args[i + 1];
        i++;
      } else {
        result.flags.add(key);
      }
    }
  }

  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const parsed = parseArgs(process.argv);

  // --list-queries
  if (parsed.flags.has('list-queries')) {
    listQueries();
    return;
  }

  // --list-reports
  if (parsed.flags.has('list-reports')) {
    listReportModels();
    return;
  }

  // --list-models [--sysmod FP|BS]
  if (parsed.flags.has('list-models')) {
    listRegisteredModels(parsed.values.sysmod || null);
    return;
  }

  // --query <id> [--param key=value ...]
  if (parsed.values.query) {
    executeTemplateQuery(parsed.values.query, parsed.params);
    return;
  }

  // --sql "<query>" --db <database>
  if (parsed.values.sql) {
    const db = parsed.values.db || 'vetorh';
    executeArbitrarySql(db, parsed.values.sql);
    return;
  }

  // --batch <report-list.json>
  if (parsed.values.batch) {
    await executeBatchReports(parsed.values.batch);
    return;
  }

  // --module <mod> --report <name> [--format <fmt>] [--entrada <xml>] [--async] [--skip-validation]
  if (parsed.values.module && parsed.values.report) {
    const skipValidation = parsed.flags.has('skip-validation');
    if (parsed.flags.has('async')) {
      await executeReportAsync(parsed.values.module, parsed.values.report, parsed.values.format || 'PDF', parsed.values.entrada || '');
    } else {
      await executeReport(parsed.values.module, parsed.values.report, parsed.values.format || 'PDF', parsed.values.entrada || '', skipValidation);
    }
    return;
  }

  // Help
  console.log(`Senior HCM Report Runner

Usage:
  node report-runner.js --list-queries                           List SQL templates
  node report-runner.js --query <id>                             Run a template query
  node report-runner.js --query <id> --param numEmp=2            With parameters
  node report-runner.js --sql "SELECT ..." --db vetorh           Arbitrary SQL
  node report-runner.js --list-reports                           List report model files on disk
  node report-runner.js --list-models                            List models registered in r910mdg
  node report-runner.js --list-models --sysmod FP                Filter by sysmod (FP or BS)
  node report-runner.js --module rubi --report "FPRE001.COL"     SOAP report (validates against r910mdg)
  node report-runner.js --module rubi --report "FPRE001.COL" --format PDF --async
                                                                 Async mode: IniciarGeracao + poll
  node report-runner.js --module rubi --report "FPRE001.COL" --skip-validation
                                                                 Skip r910mdg pre-flight check

Registry notes (from r910mdg investigation):
  - Only FP (486 models) and BS (14 models) are registered in r910mdg
  - prRelatorio must match the full nommod value including extension (e.g., "FPRE001.COL")
  - FP models must use --module rubi; BS models must use --module bs
  - Run --list-models to browse all registered models before executing

SQL Templates: loaded from discovery/reports/sql-templates.json
SOAP Templates: loaded from discovery/reports/soap-templates.json

Modules: ${Object.keys(REPORT_SERVICES).join(', ')}
Databases: ${Object.keys(DB_CONFIG).join(', ')}
`);
}

main().catch(console.error);
