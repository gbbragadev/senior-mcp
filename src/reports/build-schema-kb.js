#!/usr/bin/env node
/**
 * build-schema-kb.js
 * Builds ${SENIOR_ROOT}/discovery/senior-schema-kb.json from:
 *   1. r996fld field definitions (pre-dumped to temp file)
 *   2. Parsed report model JSON files
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SENIOR_ROOT = process.env.SENIOR_ROOT || 'C:/Senior';

// ─── Config ────────────────────────────────────────────────────────────────

const FIELDS_DUMP = process.env.FIELDS_DUMP || 'C:/Users/gui/AppData/Local/Temp/r996fld_fields.txt';
const REPORTS_DIR = process.env.REPORTS_DIR || `${SENIOR_ROOT}/discovery/report-models/parsed/vetorh/`;
const OUTPUT_FILE = process.env.OUTPUT_FILE || `${SENIOR_ROOT}/discovery/senior-schema-kb.json`;

// dattyp codes from ASAS framework
const TYPE_MAP = {
  '1': 'alpha',
  '2': 'numeric',
  '3': 'date',
  '4': 'logical',
  '5': 'memo',
  '6': 'image',
  '7': 'currency',
  '8': 'integer',
  '9': 'time',
  '10': 'datetime',
};

// Known table descriptions (discovered from reports + domain knowledge)
const KNOWN_TABLE_DESCS = {
  'R034FUN': 'Funcionários / Colaboradores (Employees)',
  'R030EMP': 'Empresas (Companies)',
  'R010SIT': 'Situações de Afastamento (Leave Situations)',
  'R036DEP': 'Dependentes (Dependents)',
  'R038HCA': 'Histórico de Cargo (Job History)',
  'R038HCC': 'Histórico de Centro de Custo (Cost Center History)',
  'R038HFI': 'Histórico de Filial (Branch History)',
  'R038HNA': 'Histórico de Natureza (Nature History)',
  'R038HES': 'Histórico de Escala (Schedule History)',
  'R038HVI': 'Histórico de Vínculo (Employment Bond History)',
  'R038HLO': 'Histórico Local (Local History)',
  'R038HSA': 'Histórico de Salário (Salary History)',
  'R024CAR': 'Cargos (Job Positions)',
  'R018CCU': 'Centros de Custo (Cost Centers)',
  'R023FIL': 'Filiais (Branches)',
  'R044CAL': 'Cálculo de Folha (Payroll Calculation)',
  'R044MOV': 'Movimentos de Folha (Payroll Movements)',
  'R044EVE': 'Eventos de Folha (Payroll Events)',
  'R044DES': 'Descontos de Folha (Payroll Deductions)',
  'R008EVE': 'Eventos (Events/Earnings)',
  'R008TOT': 'Totalizadores (Totalizers)',
  'R008EVC': 'Eventos por Característica (Events by Characteristic)',
  'R007SAL': 'Salários (Salary Table)',
  'R016HIE': 'Hierarquia / Organograma (Organization Hierarchy)',
  'R024HIS': 'Histórico de Cargos (Job History)',
  'R032OEM': 'Organograma Empresarial (Company Org Chart)',
  'R163CRE': 'Créditos (Credits)',
  'R057PGT': 'Pagamentos (Payments)',
  'R071END': 'Endereços (Addresses)',
  'R074RUA': 'Ruas / CEP (Streets / ZIP)',
  'R028FER': 'Férias (Vacation)',
  'R028HFE': 'Histórico de Férias (Vacation History)',
  'R069EXM': 'Exames Médicos (Medical Exams)',
  'R069EXA': 'Exames (Exams)',
  'R054DEP': 'Dependentes Plano (Plan Dependents)',
  'R050PLN': 'Planos de Benefícios (Benefit Plans)',
  'R050INS': 'Inscrições em Planos (Plan Enrollments)',
  'R052MOV': 'Movimentos de Benefícios (Benefit Movements)',
  'R001REG': 'Regiões (Regions)',
  'R002EST': 'Estados (States)',
  'R003CID': 'Cidades (Cities)',
  'R012NAC': 'Nacionalidades (Nationalities)',
  'R015GRE': 'Graus de Escolaridade (Education Levels)',
  'R025SIT': 'Situações de Emprego (Employment Situations)',
  'R026SIN': 'Sindicatos (Unions)',
  'R027CAT': 'Categorias (Categories)',
  'R031JOR': 'Jornadas de Trabalho (Work Schedules)',
  'R033ESC': 'Escalas (Work Shifts)',
  'R060CID': 'CID - Código Internacional de Doenças',
  'R061CAU': 'Causas de Afastamento (Leave Causes)',
  'R040PIS': 'PIS/PASEP (Social Integration Program)',
  'R041INC': 'Incidências (Incidences)',
  'R042PPP': 'PPP - Perfil Profissiográfico',
  'R045ADE': 'Adiantamentos (Advances)',
  'R053BEN': 'Benefícios (Benefits)',
  'R058DEP': 'Departamentos (Departments)',
  'R073PAP': 'Papéis de Trabalho (Work Papers)',
  'R075CAR': 'Características de Cargo (Job Characteristics)',
  // Additional high-frequency tables discovered from report analysis
  'R006ESC': 'Escalas de Trabalho (Work Shift Schedules)',
  'R038AFA': 'Histórico de Afastamentos (Leave/Absence History)',
  'R016ORN': 'Organograma por Local (Org Chart by Location)',
  'R034USU': 'Usuários por Colaborador (Users per Employee)',
  'R030FIL': 'Filiais da Empresa (Company Branches)',
  'R128CUA': 'Cursos de Aperfeiçoamento (Training Courses)',
  'R134DTU': 'Turmas de Cursos (Course Classes)',
  'R110FIC': 'Fichas Médicas (Medical Records)',
  'R017POS': 'Postos de Trabalho (Work Posts/Positions)',
  'R038HPO': 'Histórico de Posto de Trabalho (Work Post History)',
  'R910ENT': 'Entidades do Sistema (System Entities - Framework)',
  'R910USU': 'Usuários do Sistema (System Users - Framework)',
  'R074CID': 'Cidades (Cities - Address module)',
  'R122CEX': 'Certificações Externas (External Certifications)',
  'R005ACI': 'Acidentes de Trabalho (Work Accidents)',
  'R005FFU': 'Fatores de Risco por Função (Risk Factors by Job)',
  'R125CNC': 'Conhecimentos e Competências (Knowledge and Competencies)',
  'R108TAT': 'Atendimentos Médicos (Medical Appointments)',
  'R017TAP': 'Tabela de Aperfeiçoamento (Improvement Table)',
  'R070ACC': 'Acompanhamentos (Follow-ups)',
  'R009HIS': 'Histórico de Salário por Cargo (Salary History by Job)',
  'R038HSL': 'Histórico de Salário (Salary History)',
  'R038HVM': 'Histórico de Vínculo Movimento (Bond Movement History)',
  'R044HIS': 'Histórico da Folha de Pagamento (Payroll History)',
  'R035REC': 'Recibos de Pagamento (Pay Stubs)',
  'R057REC': 'Recibos (Receipts)',
  'R046CAL': 'Cálculo Provisório (Provisional Calculation)',
  'R047DEF': 'Definições de Folha (Payroll Definitions)',
  'R008EVT': 'Eventos de Treinamento (Training Events)',
  'R020SIT': 'Situações (Situations lookup)',
  'R007TRE': 'Tabelas de Remuneração (Remuneration Tables)',
};

// ─── Step 1: Parse field definitions ────────────────────────────────────────

console.log('Parsing field definitions from', FIELDS_DUMP, '...');
const fieldLines = fs.readFileSync(FIELDS_DUMP, 'utf8').split('\n');
const fieldsByTable = {};

for (const line of fieldLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('(') || trimmed.startsWith('---')) continue;
  const parts = trimmed.split('|');
  if (parts.length < 4) continue;
  const [tblnam, fldnam, lgntit, dattyp, lenfld] = parts;
  if (!tblnam || !fldnam) continue;

  const tbl = tblnam.trim().toUpperCase();
  const fld = fldnam.trim();
  if (!tbl.match(/^R[0-9]/)) continue;

  if (!fieldsByTable[tbl]) fieldsByTable[tbl] = {};
  const rawType = dattyp ? dattyp.trim() : '';
  fieldsByTable[tbl][fld] = {
    type: TYPE_MAP[rawType] || rawType || 'unknown',
    size: lenfld ? parseInt(lenfld.trim()) || 0 : 0,
    desc: lgntit ? lgntit.trim() : '',
  };
}

console.log(`  -> Loaded ${Object.keys(fieldsByTable).length} tables with field definitions`);

// ─── Step 2: Analyze report models ──────────────────────────────────────────

console.log('Analyzing report models from', REPORTS_DIR, '...');

const reportFiles = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
console.log(`  -> Found ${reportFiles.length} report files`);

// Per-table usage: which reports use this table
const tableToReports = {};       // { TABLE: [reportId, ...] }
// Joint frequency: how often two tables appear together
const joinFrequency = {};        // { "TABLE1+TABLE2": count }
// Report patterns: grouped by table combos
const reportPatterns = {};       // for common combos

for (const fname of reportFiles) {
  const reportId = fname.replace(/\.json$/i, '').toUpperCase();
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, fname), 'utf8'));
  } catch (e) {
    console.error(`  WARN: Could not parse ${fname}: ${e.message}`);
    continue;
  }

  const refs = (data.tablesReferenced || [])
    .map(t => t.split('.')[0].toUpperCase().trim())   // strip field qualifiers like R044MOV.CODEVE
    .filter(t => t.match(/^R[0-9]/))
    .filter((t, i, a) => a.indexOf(t) === i);         // dedupe

  for (const tbl of refs) {
    if (!tableToReports[tbl]) tableToReports[tbl] = [];
    tableToReports[tbl].push(reportId);
  }

  // Record join pairs
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const pair = [refs[i], refs[j]].sort().join('+');
      joinFrequency[pair] = (joinFrequency[pair] || 0) + 1;
    }
  }
}

console.log(`  -> Found ${Object.keys(tableToReports).length} distinct tables referenced in reports`);

// Determine top 50 tables by report usage
const tableUsageList = Object.entries(tableToReports)
  .map(([tbl, reps]) => ({ tbl, count: reps.length }))
  .sort((a, b) => b.count - a.count);

const top50Tables = new Set(tableUsageList.slice(0, 50).map(x => x.tbl));

// Tables appearing in 5+ reports
const tablesIn5Plus = new Set(tableUsageList.filter(x => x.count >= 5).map(x => x.tbl));

console.log(`  -> Tables in 5+ reports: ${tablesIn5Plus.size}`);
console.log(`  -> Top 50 tables: ${[...top50Tables].slice(0,10).join(', ')} ...`);

// ─── Step 3: Compute common_joins per table ──────────────────────────────────

// For each table, find its top co-occurring tables
const commonJoinsPerTable = {};
for (const [pair, count] of Object.entries(joinFrequency)) {
  const [a, b] = pair.split('+');
  if (!commonJoinsPerTable[a]) commonJoinsPerTable[a] = [];
  if (!commonJoinsPerTable[b]) commonJoinsPerTable[b] = [];
  commonJoinsPerTable[a].push({ tbl: b, count });
  commonJoinsPerTable[b].push({ tbl: a, count });
}

for (const tbl of Object.keys(commonJoinsPerTable)) {
  commonJoinsPerTable[tbl] = commonJoinsPerTable[tbl]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map(x => x.tbl);
}

// ─── Step 4: Build report_patterns ──────────────────────────────────────────

// Group reports by their primary table combo signature (top 3 most-used tables)
const PATTERN_NAMES = {
  'R034FUN': 'employee',
  'R044CAL': 'payroll_calc',
  'R044MOV': 'payroll_movements',
  'R050INS': 'benefit_enrollment',
  'R038HCA': 'job_history',
  'R038HCC': 'cost_center_history',
  'R028FER': 'vacation',
  'R069EXM': 'medical_exams',
  'R024CAR': 'job_positions',
  'R016HIE': 'org_hierarchy',
  'R038AFA': 'leave_absence',
  'R128CUA': 'training_courses',
  'R030EMP': 'company',
  'R030FIL': 'branches',
  'R005ACI': 'work_accidents',
  'R110FIC': 'medical_records',
  'R052MOV': 'benefit_movements',
  'R038HLO': 'location_history',
  'R034USU': 'user_employee',
};

// Build patterns by dominant table
const patternsByDominant = {};
for (const fname of reportFiles) {
  const reportId = fname.replace(/\.json$/i, '').toUpperCase();
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, fname), 'utf8'));
  } catch (e) { continue; }

  const refs = (data.tablesReferenced || [])
    .map(t => t.split('.')[0].toUpperCase().trim())
    .filter(t => t.match(/^R[0-9]/))
    .filter((t, i, a) => a.indexOf(t) === i);

  // Find the most-used table in this report as the "dominant" one
  let dominant = null;
  let maxUsage = 0;
  for (const t of refs) {
    const usage = (tableToReports[t] || []).length;
    if (usage > maxUsage) { maxUsage = usage; dominant = t; }
  }
  if (!dominant) continue;

  const patternName = PATTERN_NAMES[dominant] || dominant.toLowerCase();
  if (!patternsByDominant[patternName]) {
    patternsByDominant[patternName] = { tables: [], example_models: [], dominant };
  }
  const pat = patternsByDominant[patternName];
  pat.example_models.push(reportId);
  for (const t of refs) {
    if (!pat.tables.includes(t)) pat.tables.push(t);
  }
}

// Keep top patterns by example count, cap examples at 5
const reportPatternsFinal = {};
for (const [name, pat] of Object.entries(patternsByDominant)) {
  if (pat.example_models.length < 2) continue;
  reportPatternsFinal[name] = {
    dominant_table: pat.dominant,
    tables: pat.tables.slice(0, 15),
    example_models: pat.example_models.slice(0, 8),
    report_count: pat.example_models.length,
  };
}

// ─── Step 5: Assemble final KB ───────────────────────────────────────────────

console.log('Assembling knowledge base...');

const tables = {};

// All tables that appear in reports
const allReferencedTables = new Set([
  ...Object.keys(tableToReports),
  ...Object.keys(fieldsByTable).filter(t => tablesIn5Plus.has(t)),
]);

for (const tbl of allReferencedTables) {
  const usedInReports = tableToReports[tbl] || [];
  const isTop50 = top50Tables.has(tbl);
  const fields = fieldsByTable[tbl] || {};

  const entry = {
    description: KNOWN_TABLE_DESCS[tbl] || '',
    report_count: usedInReports.length,
    common_joins: commonJoinsPerTable[tbl] || [],
    used_in_reports: usedInReports.slice(0, 20), // cap at 20 for size
  };

  // Full fields for top 50, otherwise omit
  if (isTop50 && Object.keys(fields).length > 0) {
    entry.fields = fields;
  } else if (Object.keys(fields).length > 0 && usedInReports.length >= 5) {
    // Tables in 5+ reports but not top 50: include fields too (schema is valuable)
    entry.fields = fields;
  }
  // For rarely-used tables: just table name + description + report list

  tables[tbl] = entry;
}

// Sort join_frequency descending, cap at 200 entries
const joinFrequencySorted = Object.entries(joinFrequency)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 200)
  .reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {});

const kb = {
  _meta: {
    generated: new Date().toISOString(),
    source_tables: Object.keys(fieldsByTable).length,
    report_files_analyzed: reportFiles.length,
    tables_in_kb: Object.keys(tables).length,
    tables_with_full_fields: Object.keys(tables).filter(t => tables[t].fields).length,
    top50_by_report_usage: tableUsageList.slice(0, 50).map(x => ({ table: x.tbl, count: x.count })),
  },
  tables,
  report_patterns: reportPatternsFinal,
  join_frequency: joinFrequencySorted,
};

// ─── Write output ────────────────────────────────────────────────────────────

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(kb, null, 2), 'utf8');
const stats = fs.statSync(OUTPUT_FILE);
console.log(`\nWritten: ${OUTPUT_FILE}`);
console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
console.log(`  Tables in KB: ${Object.keys(tables).length}`);
console.log(`  Tables with fields: ${Object.keys(tables).filter(t => tables[t].fields).length}`);
console.log(`  Top 10 by report usage:`);
for (const { tbl, count } of tableUsageList.slice(0, 10)) {
  console.log(`    ${tbl}: ${count} reports  (${KNOWN_TABLE_DESCS[tbl] || 'no description'})`);
}
console.log(`  Join frequency top 10:`);
for (const [pair, cnt] of Object.entries(joinFrequencySorted).slice(0, 10)) {
  console.log(`    ${pair}: ${cnt}`);
}
console.log('\nDone.');
