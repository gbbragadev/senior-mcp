#!/usr/bin/env node
/**
 * senior-report-gen.js — LLM-Driven Senior HCM Report Generator
 *
 * Pipeline: Prompt → Claude analyzes → generates JSON model → WriteGer compiles → .raw/.GER
 *
 * Usage:
 *   node tools/senior-report-gen.js --prompt "Lista de funcionários por empresa" --output report.raw
 *   node tools/senior-report-gen.js --prompt "..." --example layout.xlsx --output report.raw
 *   node tools/senior-report-gen.js --prompt "..." --preview html --output report.raw
 *   node tools/senior-report-gen.js --validate report.json     Validate a manually written JSON
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const { TSWriter, writeReportClass, simplifiedToInternal, isSimplifiedFormat, DEFAULTS } = require('./WriteGer.js');

// ─── Configuration ───────────────────────────────────────────────────────────
const TOOLS_DIR = __dirname;
const PROJECT_DIR = path.resolve(TOOLS_DIR, '..');
const CORPUS_DIR = path.join(PROJECT_DIR, 'discovery', 'report-corpus');
const SCHEMA_KB_PATH = path.join(PROJECT_DIR, 'discovery', 'senior-schema-kb.json');

// ─── Schema KB loader ────────────────────────────────────────────────────────
let _schemaKB = null;
function loadSchemaKB() {
  if (_schemaKB) return _schemaKB;
  try {
    _schemaKB = JSON.parse(fs.readFileSync(SCHEMA_KB_PATH, 'utf8'));
  } catch (e) {
    console.error(`Warning: Could not load schema KB from ${SCHEMA_KB_PATH}: ${e.message}`);
    _schemaKB = { tables: {}, report_patterns: {}, join_frequency: {} };
  }
  return _schemaKB;
}

// ─── Corpus loader (few-shot examples) ───────────────────────────────────────
function loadCorpusExamples(categories, maxExamples = 5) {
  const files = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith('.json'));
  const selected = [];

  for (const cat of categories) {
    const matching = files.filter(f => f.includes(cat));
    if (matching.length > 0) {
      const example = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, matching[0]), 'utf8'));
      selected.push({ file: matching[0], category: cat, model: example });
    }
  }

  // If not enough, add defaults
  if (selected.length < maxExamples) {
    const defaultFiles = ['01-simple-list_PLPR003.json', '04-break-report_BSCL002.json', '15-multi-detail_BSBS002.json'];
    for (const f of defaultFiles) {
      if (selected.length >= maxExamples) break;
      if (!selected.find(s => s.file === f) && fs.existsSync(path.join(CORPUS_DIR, f))) {
        const example = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, f), 'utf8'));
        selected.push({ file: f, category: 'default', model: example });
      }
    }
  }

  return selected;
}

// ─── Analyze prompt to determine report characteristics ──────────────────────
function analyzePrompt(prompt) {
  const lower = prompt.toLowerCase();
  const analysis = {
    categories: ['simple-list'],
    tables: [],
    hasBreaks: false,
    hasTotals: false,
    hasRules: false,
    orientation: 'Portrait',
    suggestedPatterns: [],
  };

  // Detect grouping/breaks
  if (/agrup|quebra|por\s+empresa|por\s+depart|por\s+filial|group/i.test(prompt)) {
    analysis.hasBreaks = true;
    analysis.categories = ['break-report'];
  }

  // Detect totals
  if (/total|soma|contagem|count|sum|média|average/i.test(prompt)) {
    analysis.hasTotals = true;
    if (!analysis.hasBreaks) analysis.categories = ['total-report'];
    else analysis.categories = ['break-report', 'total-report'];
  }

  // Detect complex rules
  if (/filtro|where|condição|demitido|ativo|situação|históric/i.test(prompt)) {
    analysis.hasRules = true;
    analysis.categories.push('complex-rules');
  }

  // Detect multi-detail
  if (/dependente|filho|cônjuge|master.*detail|mestre.*detalhe/i.test(prompt)) {
    analysis.categories = ['multi-detail'];
  }

  // Detect orientation
  if (/paisagem|landscape|horizontal|muitas\s+colunas|many\s+columns/i.test(prompt)) {
    analysis.orientation = 'Landscape';
  }

  // Detect tables from prompt keywords
  const kb = loadSchemaKB();
  const tableKeywords = {
    'funcionário': 'R034FUN', 'funcionario': 'R034FUN', 'employee': 'R034FUN', 'colaborador': 'R034FUN',
    'empresa': 'R030EMP', 'company': 'R030EMP',
    'departamento': 'R018DEP', 'department': 'R018DEP',
    'cargo': 'R024CAR', 'position': 'R024CAR', 'job': 'R024CAR',
    'salário': 'R044CAL', 'salario': 'R044CAL', 'salary': 'R044CAL', 'remuneração': 'R044CAL',
    'dependente': 'R036DEP', 'dependent': 'R036DEP',
    'benefício': 'R163CRE', 'beneficio': 'R163CRE', 'benefit': 'R163CRE',
    'férias': 'R038AFA', 'ferias': 'R038AFA', 'vacation': 'R038AFA',
    'situação': 'R010SIT', 'situacao': 'R010SIT', 'status': 'R010SIT',
    'lotação': 'R016HIE', 'lotacao': 'R016HIE',
    'escala': 'R006ESC', 'schedule': 'R006ESC',
    'sindicato': 'R012SIN', 'union': 'R012SIN',
    'organograma': 'R032OEM', 'org chart': 'R032OEM',
    'evento': 'R008EVC', 'event': 'R008EVC',
    'movimento': 'R044MOV', 'payroll movement': 'R044MOV',
    'holerite': 'R044MOV', 'payslip': 'R044MOV',
    'treinamento': 'R040TRE', 'training': 'R040TRE',
    'filial': 'R030FIL', 'branch': 'R030FIL',
    'centro de custo': 'R018CCU', 'cost center': 'R018CCU',
  };

  for (const [keyword, table] of Object.entries(tableKeywords)) {
    if (lower.includes(keyword)) {
      analysis.tables.push(table);
    }
  }

  // Match report patterns from KB
  if (kb.report_patterns) {
    for (const [name, pattern] of Object.entries(kb.report_patterns)) {
      const patternTables = pattern.tables || [];
      const overlap = patternTables.filter(t => analysis.tables.includes(t));
      if (overlap.length > 0) {
        analysis.suggestedPatterns.push({ name, tables: patternTables, overlap: overlap.length });
      }
    }
    analysis.suggestedPatterns.sort((a, b) => b.overlap - a.overlap);
  }

  return analysis;
}

// ─── Build system prompt for Claude ──────────────────────────────────────────
function buildSystemPrompt(analysis) {
  const kb = loadSchemaKB();
  const examples = loadCorpusExamples(analysis.categories);

  // Build relevant table schema subset
  const relevantTables = {};
  const allTables = new Set(analysis.tables);

  // Add commonly joined tables
  for (const t of analysis.tables) {
    if (kb.tables[t]) {
      relevantTables[t] = kb.tables[t];
      const joins = kb.tables[t].common_joins || [];
      joins.forEach(j => allTables.add(j));
    }
  }
  for (const t of allTables) {
    if (kb.tables[t] && !relevantTables[t]) {
      relevantTables[t] = kb.tables[t];
    }
  }

  // Trim schema to essentials (field name, type, description only)
  const schemaSnippet = {};
  for (const [tbl, info] of Object.entries(relevantTables)) {
    schemaSnippet[tbl] = {
      description: info.description || '',
      fields: {},
    };
    if (info.fields) {
      for (const [fld, finfo] of Object.entries(info.fields)) {
        schemaSnippet[tbl].fields[fld] = { type: finfo.type, desc: finfo.desc || finfo.description || '' };
      }
    }
  }

  // Build few-shot examples (condensed)
  const exampleSnippets = examples.map(ex => {
    // Keep only essential structure for few-shot
    const m = ex.model;
    return {
      _comment: `Example: ${ex.file} (${ex.category})`,
      filename: m.filename,
      orientation: m.orientation,
      reportType: m.reportType,
      sections: m.sections,
      bands: (m.bands || []).map(b => ({
        name: b.name,
        bandType: b.bandType,
        tag: b.tag,
        position: b.position,
        canPrint: b.canPrint,
        tableList: b.tableList,
        onBeforePrint: b.onBeforePrint || '',
        onAfterPrint: b.onAfterPrint || '',
        children: (b.children || []).slice(0, 15).map(c => ({
          type: c.type,
          name: c.name,
          position: c.position,
          table: c.table,
          field: c.field,
          caption: c.caption,
          font: c.font,
        })),
      })),
    };
  });

  return `You are a Senior HCM report model generator. You output JSON in the exact schema used by ParseGer.js / WriteGer.js.

## CRITICAL RULES

1. Output ONLY valid JSON — no markdown, no comments, no explanation text.
2. Use ONLY tables and fields from the provided Schema KB. Field names are EXACT (case-sensitive): R034FUN.NomFun, not r034fun.nomfun.
3. Positions use Senior pixel units: 1 char ≈ 7px width, 17px height. Paper width ≈ 774px (Portrait) or 1050px (Landscape).
4. Every report MUST have at minimum:
   - A CABECALHO band (tag 1-99) with: TSSistema "empatu" + TSSistema "NomEmp" + TSSistema "numpag" + TSSistema "datatu" + column header TSDescricao labels + TSDesenho separator line
   - At least one DETALHE band (tag 200-299) with TSCadastro fields bound to DB table.field
5. TSCadastro: has "table" and "field" properties mapping to DB table.field
6. TSDescricao: static text labels (captions, column headers)
7. TSSistema: system variables — caption is the variable name: "empatu", "NomEmp", "numpag", "datatu"
8. TSTotal: accumulator — needs fieldName (what to sum), clearBand (when to reset), typeTotal (0=sum,1=count,2=avg,3=min,4=max)
9. TSDesenho: drawing element (line/rectangle) — shape: 0=rectangle, 3=line. caption " " for visual lines.
10. preambleSelect uses Senior rule language: \`definir alfa/numero\`, \`InsClauSQLWhere("BandName", sql)\`, \`MontarSqlHistorico\`, \`Se/Senao/Inicio/Fim\`
11. Band tags: CABECALHO=1-99, TITULO=101-199, DETALHE=200-299, SUBTOTAL=300-399, SUBTITULO=400-499, ADICIONAL=500-502, RODAPE=503, OUTRO=600-699

## OUTPUT JSON SCHEMA

\`\`\`json
{
  "filename": "CUSTOM001.GER",
  "version": 2061,
  "systemVarVersion": 1001,
  "caption": "Modelo Gerador",
  "description": ["Line 1 of report description", "Line 2"],
  "orientation": "Portrait|Landscape",
  "reportType": 1,
  "formatReport": 0,
  "sections": {
    "preambleSelect": "rule code or empty string",
    "selection": "",
    "initialization": "",
    "finalization": "",
    "functionRule": "",
    "printPage": ""
  },
  "bands": [
    {
      "name": "Cabecalho",
      "bandType": "CABECALHO",
      "tag": 2,
      "position": { "top": 0, "left": 0, "width": 774, "height": 90 },
      "canPrint": true,
      "tableList": [],
      "onBeforePrint": "",
      "onAfterPrint": "",
      "children": [
        {
          "type": "TSSistema",
          "name": "Sistema001",
          "position": { "top": 3, "left": 6, "width": 38, "height": 17 },
          "caption": "empatu",
          "font": { "name": "Arial", "size": 9 }
        }
      ]
    }
  ]
}
\`\`\`

## RELEVANT DATABASE TABLES

${JSON.stringify(schemaSnippet, null, 2)}

## FEW-SHOT EXAMPLES

${exampleSnippets.map(ex => '```json\n' + JSON.stringify(ex, null, 2) + '\n```').join('\n\n')}

## NAMING CONVENTIONS

- Band names: Cabecalho, Detalhe_1, Subtitulo_Empresa, Subtotal_Empresa, Total_Geral, Rodape
- Component names: Sistema001, Descricao001, Cadastro001, Total001, Desenho001
- Number components sequentially within each type
- Use descriptive band names matching the grouping field
`;
}

// ─── Claude API call ─────────────────────────────────────────────────────────
async function callClaude(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable required. Set it with: export ANTHROPIC_API_KEY=sk-...');
  }

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16384,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.error) {
            reject(new Error(`Claude API error: ${response.error.message}`));
            return;
          }
          const text = response.content?.[0]?.text || '';
          resolve(text);
        } catch (e) {
          reject(new Error(`Failed to parse Claude response: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Extract JSON from Claude response ──────────────────────────────────────
function extractJSON(text) {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch (e) {}

  // Try extracting from markdown code block
  const codeBlock = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1]);
    } catch (e) {}
  }

  // Try finding first { ... last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.substring(start, end + 1));
    } catch (e) {}
  }

  throw new Error('Could not extract valid JSON from Claude response');
}

// ─── Validate generated model ────────────────────────────────────────────────
function validateModel(model) {
  const errors = [];
  const warnings = [];

  if (!model.bands || model.bands.length === 0) {
    errors.push('No bands defined');
  }

  const bandTypes = (model.bands || []).map(b => b.bandType);
  if (!bandTypes.includes('CABECALHO')) {
    warnings.push('No CABECALHO band (page header)');
  }
  if (!bandTypes.includes('DETALHE')) {
    errors.push('No DETALHE band (data rows)');
  }

  // Check that TSCadastro fields reference known tables
  const kb = loadSchemaKB();
  for (const band of (model.bands || [])) {
    for (const child of (band.children || [])) {
      if (child.type === 'TSCadastro' && child.table) {
        if (!kb.tables[child.table] && !kb.tables[child.table.toUpperCase()]) {
          warnings.push(`TSCadastro ${child.name}: table "${child.table}" not found in schema KB`);
        }
      }
    }
  }

  return { errors, warnings, valid: errors.length === 0 };
}

// ─── Layout ingestion (XLSX) ─────────────────────────────────────────────────
function ingestLayout(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }
  // For XLSX/PDF/image, return a placeholder — full implementation requires xlsx npm package
  console.error(`Note: Layout ingestion for ${ext} files requires additional npm packages.`);
  console.error('  For XLSX: npm install xlsx');
  console.error('  For PDF/images: use Claude Vision via the API');
  return null;
}

// ─── Generate HTML preview ───────────────────────────────────────────────────
function generateHTMLPreview(model) {
  const bands = model.bands || [];
  let html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>${model.filename || 'Report Preview'}</title>
<style>
body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }
.report { background: white; padding: 20px; max-width: ${model.orientation === 'Landscape' ? '1100' : '800'}px; margin: 0 auto; box-shadow: 0 2px 8px rgba(0,0,0,0.1); position: relative; }
.band { position: relative; border-bottom: 1px dashed #ddd; margin-bottom: 2px; min-height: 20px; }
.band-label { position: absolute; right: -90px; top: 0; font-size: 9px; color: #999; width: 80px; }
.field { position: absolute; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; box-sizing: border-box; }
.field.TSDescricao { color: #333; }
.field.TSCadastro { color: #0066cc; border-bottom: 1px dotted #0066cc; }
.field.TSSistema { color: #cc6600; font-style: italic; }
.field.TSTotal { color: #cc0000; font-weight: bold; }
.field.TSDesenho { background: #333; }
.field.TSFormula { color: #660099; }
.field.TSMemoran { border: 1px solid #ccc; background: #fafafa; }
.legend { margin-top: 20px; font-size: 11px; }
.legend span { margin-right: 15px; }
h2 { margin: 0 0 10px; font-size: 14px; color: #666; }
</style></head><body>
<h2>${model.filename || 'Report'} — ${model.description?.[0] || model.title || ''}</h2>
<div class="report">`;

  for (const band of bands) {
    const h = (band.position?.height || 50);
    html += `\n<div class="band" style="height:${h}px; background: ${bandColor(band.bandType)}">`;
    html += `<span class="band-label">${band.bandType}<br>${band.name}</span>`;

    for (const child of (band.children || [])) {
      const pos = child.position || {};
      const fontSize = child.font?.size || 9;
      const cls = child.type || 'TSDescricao';
      let label = child.caption || '';
      if (cls === 'TSCadastro') label = `[${child.table}.${child.field}]`;
      if (cls === 'TSTotal') label = `Σ ${child.fieldName || child.caption || ''}`;
      if (cls === 'TSDesenho') label = '';

      html += `<div class="field ${cls}" style="top:${pos.top||0}px;left:${pos.left||0}px;width:${pos.width||50}px;height:${pos.height||17}px;font-size:${fontSize}px;line-height:${pos.height||17}px;" title="${cls}: ${child.name}">${label}</div>`;
    }
    html += '</div>';
  }

  html += `</div>
<div class="legend">
  <span style="color:#333">■ Label</span>
  <span style="color:#0066cc">■ DB Field</span>
  <span style="color:#cc6600">■ System</span>
  <span style="color:#cc0000">■ Total</span>
  <span style="color:#660099">■ Formula</span>
</div></body></html>`;

  return html;
}

function bandColor(type) {
  const colors = {
    CABECALHO: '#f8f8ff', TITULO: '#f0f8ff', DETALHE: '#ffffff',
    SUBTOTAL: '#fff8f0', SUBTITULO: '#f0fff0', ADICIONAL: '#fff0f0',
    RODAPE: '#f8f8ff', OUTRO: '#f8fff8',
  };
  return colors[type] || '#ffffff';
}

// ─── Main pipeline ───────────────────────────────────────────────────────────
async function runPipeline(options) {
  const { prompt, outputPath, examplePath, preview, validate: validateOnly } = options;

  // Validate-only mode
  if (validateOnly) {
    const json = JSON.parse(fs.readFileSync(validateOnly, 'utf8'));
    const result = validateModel(json);
    console.log(result.valid ? 'VALID' : 'INVALID');
    if (result.errors.length) console.log('Errors:', result.errors.join('; '));
    if (result.warnings.length) console.log('Warnings:', result.warnings.join('; '));
    return;
  }

  if (!prompt) {
    console.error('Error: --prompt is required');
    process.exit(1);
  }

  console.error('[1/5] Analyzing prompt...');
  const analysis = analyzePrompt(prompt);
  console.error(`  Tables: ${analysis.tables.join(', ') || 'auto-detect'}`);
  console.error(`  Categories: ${analysis.categories.join(', ')}`);
  console.error(`  Breaks: ${analysis.hasBreaks}, Totals: ${analysis.hasTotals}`);

  // Layout constraint (optional)
  let layoutConstraint = null;
  if (examplePath) {
    console.error('[1.5/5] Ingesting layout example...');
    layoutConstraint = ingestLayout(examplePath);
  }

  console.error('[2/5] Building system prompt...');
  const systemPrompt = buildSystemPrompt(analysis);

  let userPrompt = `Generate a Senior HCM report model for the following requirement:\n\n${prompt}`;
  if (layoutConstraint) {
    userPrompt += `\n\nLayout constraints from example file:\n${JSON.stringify(layoutConstraint, null, 2)}`;
  }
  userPrompt += '\n\nRespond with ONLY the JSON model, no other text.';

  console.error('[3/5] Calling Claude API...');
  const response = await callClaude(systemPrompt, userPrompt);

  console.error('[4/5] Extracting and validating JSON...');
  const modelJson = extractJSON(response);

  // Validate
  const validation = validateModel(modelJson);
  if (!validation.valid) {
    console.error('Validation errors:');
    validation.errors.forEach(e => console.error(`  ERROR: ${e}`));
  }
  if (validation.warnings.length) {
    console.error('Warnings:');
    validation.warnings.forEach(w => console.error(`  WARN: ${w}`));
  }

  if (!validation.valid) {
    // Save JSON anyway for debugging
    const jsonPath = (outputPath || 'report').replace(/\.\w+$/, '') + '.json';
    fs.writeFileSync(jsonPath, JSON.stringify(modelJson, null, 2));
    console.error(`JSON saved to ${jsonPath} (has validation errors)`);
    process.exit(1);
  }

  console.error('[5/5] Compiling to binary...');

  // Convert to internal model
  const internalModel = isSimplifiedFormat(modelJson) ? simplifiedToInternal(modelJson) : modelJson;

  // Write .raw
  const w = new TSWriter(256 * 1024);
  w.version = 2061;
  writeReportClass(w, internalModel);
  const rawBuf = w.getBuffer();

  const rawPath = outputPath || 'report.raw';
  fs.writeFileSync(rawPath, rawBuf);
  console.error(`Written ${rawBuf.length} bytes to ${rawPath}`);

  // Save JSON alongside
  const jsonPath = rawPath.replace(/\.raw$/i, '.json');
  fs.writeFileSync(jsonPath, JSON.stringify(modelJson, null, 2));
  console.error(`JSON saved to ${jsonPath}`);

  // Preview
  if (preview === 'html') {
    const htmlPath = rawPath.replace(/\.raw$/i, '.html');
    const html = generateHTMLPreview(modelJson);
    fs.writeFileSync(htmlPath, html);
    console.error(`HTML preview saved to ${htmlPath}`);
  }

  // Roundtrip validation
  try {
    const { execSync } = require('child_process');
    const parseGerPath = path.join(TOOLS_DIR, 'ParseGer.js');
    const parsed = JSON.parse(execSync(`node "${parseGerPath}" "${rawPath}"`, { maxBuffer: 50 * 1024 * 1024 }).toString());
    const bandCount = parsed.bands?.length || 0;
    const fieldCount = parsed._stats?.fieldCount || 0;
    console.error(`Roundtrip OK: ${bandCount} bands, ${fieldCount} fields`);
  } catch (e) {
    console.error(`Roundtrip warning: ${e.message}`);
  }

  console.log(JSON.stringify({
    status: 'success',
    output: rawPath,
    json: jsonPath,
    bytes: rawBuf.length,
    bands: modelJson.bands?.length || 0,
    fields: (modelJson.bands || []).reduce((n, b) => n + (b.children || []).length, 0),
    tables: [...new Set((modelJson.bands || []).flatMap(b => (b.children || []).filter(c => c.table).map(c => c.table)))],
  }, null, 2));
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`senior-report-gen.js — LLM-Driven Senior HCM Report Generator

Usage:
  node tools/senior-report-gen.js --prompt "..." [--output <file.raw>]
  node tools/senior-report-gen.js --prompt "..." --example layout.xlsx
  node tools/senior-report-gen.js --prompt "..." --preview html
  node tools/senior-report-gen.js --validate model.json
  node tools/senior-report-gen.js --analyze "..."        Analyze prompt only (no API call)

Options:
  --prompt <text>     Report description (required for generation)
  --output <file>     Output .raw file path (default: report.raw)
  --example <file>    Layout example file (XLSX, PDF, JSON)
  --preview html      Generate HTML preview alongside .raw
  --validate <json>   Validate a JSON model without generating
  --analyze <text>    Show prompt analysis without API call

Environment:
  ANTHROPIC_API_KEY   Required for generation (Claude API key)`);
    process.exit(0);
  }

  // Parse args
  const options = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--prompt': options.prompt = args[++i]; break;
      case '--output': options.outputPath = args[++i]; break;
      case '--example': options.examplePath = args[++i]; break;
      case '--preview': options.preview = args[++i]; break;
      case '--validate': options.validate = args[++i]; break;
      case '--analyze': {
        const prompt = args[++i];
        const analysis = analyzePrompt(prompt);
        console.log(JSON.stringify(analysis, null, 2));
        return;
      }
    }
  }

  runPipeline(options).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}

module.exports = { analyzePrompt, buildSystemPrompt, validateModel, generateHTMLPreview, loadSchemaKB };
