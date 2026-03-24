#!/usr/bin/env node
/**
 * layout-ingester.js — Extract layout constraints from example files
 *
 * Parses XLSX, CSV, or JSON layout files into a standardized constraint format
 * that senior-report-gen.js can use to guide report layout generation.
 *
 * Usage:
 *   node tools/layout-ingester.js <file.xlsx|csv|json> [--output constraints.json]
 *
 * Output format:
 *   {
 *     "columns": [
 *       { "header": "Nome", "width_pct": 30, "align": "left", "type": "text" },
 *       { "header": "Salário", "width_pct": 15, "align": "right", "type": "number" }
 *     ],
 *     "orientation": "portrait|landscape",
 *     "has_totals": true,
 *     "has_grouping": false,
 *     "group_by": [],
 *     "sample_data": []
 *   }
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ─── CSV Parser (built-in, no deps) ─────────────────────────────────────────
function parseCSV(text, delimiter = ',') {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // Auto-detect delimiter
  if (lines[0].includes('\t') && !lines[0].includes(delimiter)) delimiter = '\t';
  if (lines[0].includes(';') && !lines[0].includes(delimiter)) delimiter = ';';

  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows = lines.slice(1).map(line =>
    line.split(delimiter).map(cell => cell.trim().replace(/^["']|["']$/g, ''))
  );

  return { headers, rows };
}

// ─── XLSX Parser (requires 'xlsx' npm package) ──────────────────────────────
function parseXLSX(filePath) {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch (e) {
    console.error('Error: xlsx package not installed. Run: npm install xlsx');
    console.error('Falling back: treating as CSV if possible.');
    const text = fs.readFileSync(filePath, 'utf8');
    return parseCSV(text);
  }

  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (data.length === 0) return { headers: [], rows: [] };

  // Find header row (first row with mostly non-empty cells)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, data.length); i++) {
    const nonEmpty = data[i].filter(c => c !== '').length;
    if (nonEmpty > data[headerIdx].filter(c => c !== '').length) {
      headerIdx = i;
    }
  }

  const headers = data[headerIdx].map(h => String(h).trim());
  const rows = data.slice(headerIdx + 1).filter(row => row.some(c => c !== ''));

  // Extract column widths from sheet
  const colWidths = [];
  if (sheet['!cols']) {
    for (const col of sheet['!cols']) {
      colWidths.push(col?.wpx || col?.wch * 7 || 80);
    }
  }

  return { headers, rows, colWidths };
}

// ─── Infer column types from data ───────────────────────────────────────────
function inferColumnType(values) {
  const nonEmpty = values.filter(v => v !== '' && v != null);
  if (nonEmpty.length === 0) return 'text';

  const numberCount = nonEmpty.filter(v => !isNaN(parseFloat(String(v).replace(/[R$.,\s]/g, '')))).length;
  const dateCount = nonEmpty.filter(v => /\d{2}[\/\-]\d{2}[\/\-]\d{2,4}/.test(String(v))).length;

  if (dateCount > nonEmpty.length * 0.5) return 'date';
  if (numberCount > nonEmpty.length * 0.7) return 'number';
  return 'text';
}

// ─── Infer alignment from type ──────────────────────────────────────────────
function inferAlignment(type) {
  if (type === 'number') return 'right';
  if (type === 'date') return 'center';
  return 'left';
}

// ─── Detect totals row ──────────────────────────────────────────────────────
function detectTotals(rows, headers) {
  if (rows.length < 2) return false;
  const lastRow = rows[rows.length - 1];
  const totalKeywords = ['total', 'soma', 'sum', 'subtotal', 'grand total'];
  return lastRow.some(cell => totalKeywords.some(kw => String(cell).toLowerCase().includes(kw)));
}

// ─── Detect grouping ────────────────────────────────────────────────────────
function detectGrouping(rows, headers) {
  // Look for merged-like patterns: rows where most cells are empty except first
  const groupCandidates = [];
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const nonEmpty = rows[i].filter(c => c !== '').length;
    if (nonEmpty === 1 && rows[i][0] !== '') {
      groupCandidates.push(i);
    }
  }
  return groupCandidates.length >= 2;
}

// ─── Main: build constraints ─────────────────────────────────────────────────
function buildConstraints(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  let parsed;
  if (ext === '.json') {
    // Already a constraint JSON — pass through
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } else if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    const text = fs.readFileSync(filePath, 'utf8');
    parsed = parseCSV(text);
  } else if (ext === '.xlsx' || ext === '.xls') {
    parsed = parseXLSX(filePath);
  } else {
    throw new Error(`Unsupported file type: ${ext}. Use .xlsx, .csv, .tsv, or .json`);
  }

  const { headers, rows, colWidths } = parsed;

  if (headers.length === 0) {
    throw new Error('No headers found in file');
  }

  // Build column definitions
  const totalWidth = (colWidths || []).reduce((s, w) => s + w, 0) || headers.length * 80;
  const columns = headers.map((header, i) => {
    const values = rows.map(r => r[i] || '');
    const type = inferColumnType(values);
    const widthPx = colWidths?.[i] || 80;
    const widthPct = Math.round((widthPx / totalWidth) * 100);

    return {
      header,
      width_pct: widthPct,
      align: inferAlignment(type),
      type,
    };
  });

  // Determine orientation from column count
  const orientation = columns.length > 8 ? 'landscape' : 'portrait';

  // Detect features
  const hasTotals = detectTotals(rows, headers);
  const hasGrouping = detectGrouping(rows, headers);

  // Sample data (first 3 rows)
  const sampleData = rows.slice(0, 3).map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] || '']))
  );

  return {
    source: path.basename(filePath),
    columns,
    orientation,
    has_totals: hasTotals,
    has_grouping: hasGrouping,
    group_by: [],
    sample_data: sampleData,
    total_columns: columns.length,
    total_rows: rows.length,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`layout-ingester.js — Extract layout constraints from example files

Usage:
  node tools/layout-ingester.js <file.xlsx|csv|json> [--output constraints.json]

Supported formats:
  .xlsx, .xls  — Excel spreadsheets (requires: npm install xlsx)
  .csv, .tsv   — Comma/tab-separated values (built-in)
  .json        — Pass-through (already a constraint file)

Output: JSON with columns, orientation, totals, grouping detection`);
    process.exit(0);
  }

  const filePath = args.find(a => !a.startsWith('--'));
  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : null;

  try {
    const constraints = buildConstraints(filePath);

    if (outputPath) {
      fs.writeFileSync(outputPath, JSON.stringify(constraints, null, 2));
      console.error(`Constraints written to ${outputPath}`);
    }

    console.log(JSON.stringify(constraints, null, 2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildConstraints, parseCSV };
