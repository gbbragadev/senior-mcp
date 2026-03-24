#!/usr/bin/env node
/**
 * seniorc — Senior HCM Rule Language Compiler
 *
 * Compiles .senior source files into .LSP binary format.
 *
 * Usage:
 *   seniorc <file.senior>                    Compile to <file.LSP> in same directory
 *   seniorc <file.senior> -o <output.LSP>    Compile to specific output path
 *   seniorc <file.senior> --check            Validate only, don't produce .LSP
 *   seniorc <file.senior> --analyze          Full analysis (vars, tables, builtins, SQL)
 *   seniorc <file.senior> --title "Regra X"  Set rule title in .LSP header
 *   seniorc --watch <file.senior>            Watch file and recompile on change
 *   seniorc --batch <dir>                    Compile all .senior files in directory
 *
 * Exit codes:
 *   0 — Success (no errors)
 *   1 — Compilation errors found
 *   2 — File not found / invalid arguments
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, watchFile } from 'fs';
import { resolve, basename, dirname, extname, join } from 'path';
import { computeDiagnostics, computeSemanticDiagnostics, parseDocument, extractTableRefs, extractTableFieldRefs, extractSqlStatements, extractBuiltinCalls, extractSystemVars, DiagnosticSeverity } from '../src/compiler/lang-diagnostics.js';
import { encodeLsp } from '../src/compiler/lang-encoder.js';

// ── ANSI helpers ────────────────────────────────────────────────────────────

const isColor = process.stdout.isTTY !== false && !process.env.NO_COLOR;
const C = {
  reset:   isColor ? '\x1b[0m'  : '',
  bold:    isColor ? '\x1b[1m'  : '',
  dim:     isColor ? '\x1b[2m'  : '',
  red:     isColor ? '\x1b[31m' : '',
  green:   isColor ? '\x1b[32m' : '',
  yellow:  isColor ? '\x1b[33m' : '',
  blue:    isColor ? '\x1b[34m' : '',
  magenta: isColor ? '\x1b[35m' : '',
  cyan:    isColor ? '\x1b[36m' : '',
};

function severityColor(sev) {
  switch (sev) {
    case DiagnosticSeverity.Error:   return C.red;
    case DiagnosticSeverity.Warning: return C.yellow;
    default: return C.blue;
  }
}

function severityLabel(sev) {
  switch (sev) {
    case DiagnosticSeverity.Error:   return 'error';
    case DiagnosticSeverity.Warning: return 'warning';
    case DiagnosticSeverity.Information: return 'info';
    case DiagnosticSeverity.Hint:    return 'hint';
    default: return '?';
  }
}

// ── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
${C.bold}${C.cyan}seniorc${C.reset} — Senior HCM Rule Language Compiler

${C.bold}USAGE${C.reset}
  seniorc <file.senior>                    Compile to .LSP
  seniorc <file.senior> -o <output.LSP>    Compile to specific path
  seniorc <file.senior> --check            Validate only (no output)
  seniorc <file.senior> --analyze          Full code analysis
  seniorc <file.senior> --title "Title"    Set rule title in .LSP header
  seniorc --watch <file.senior>            Watch and recompile on change
  seniorc --batch <dir>                    Compile all .senior in directory

${C.bold}OPTIONS${C.reset}
  -o, --output <path>    Output .LSP file path
  -t, --title <text>     Rule title stored in .LSP header (max 70 chars)
  -c, --check            Validate only, don't produce .LSP binary
  -a, --analyze          Print detailed code analysis
  -w, --watch            Watch file for changes and recompile
  -b, --batch <dir>      Compile all .senior files in a directory
  -q, --quiet            Suppress warnings, show only errors
  -s, --strict           Enable semantic checks (undeclared vars, function arity, cursor lifecycle)
  -v, --verbose          Show extra detail during compilation
      --no-color         Disable colored output

${C.bold}EXAMPLES${C.reset}
  ${C.dim}# Compile a rule${C.reset}
  seniorc Vetorh/Regras/minha_regra.senior

  ${C.dim}# Validate without compiling${C.reset}
  seniorc --check minha_regra.senior

  ${C.dim}# Compile with title${C.reset}
  seniorc minha_regra.senior --title "Regra Antes Salvar Funcionario"

  ${C.dim}# Batch compile directory${C.reset}
  seniorc --batch Vetorh/Regras/

  ${C.dim}# Watch and recompile on change${C.reset}
  seniorc --watch minha_regra.senior
`);
  process.exit(0);
}

// Parse flags
let inputFile = null;
let outputFile = null;
let title = null;
let checkOnly = false;
let analyze = false;
let watchMode = false;
let batchDir = null;
let quiet = false;
let verbose = false;
let strict = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '-o': case '--output':  outputFile = args[++i]; break;
    case '-t': case '--title':   title = args[++i]; break;
    case '-c': case '--check':   checkOnly = true; break;
    case '-a': case '--analyze': analyze = true; break;
    case '-w': case '--watch':   watchMode = true; break;
    case '-q': case '--quiet':   quiet = true; break;
    case '-v': case '--verbose': verbose = true; break;
    case '-s': case '--strict':  strict = true; break;
    case '-b': case '--batch':   batchDir = args[++i]; break;
    default:
      if (!arg.startsWith('-') && !inputFile) inputFile = arg;
      else if (!arg.startsWith('-') && !inputFile) inputFile = arg;
      break;
  }
}

// ── Core compile function ───────────────────────────────────────────────────

function compile(filePath, outPath, ruleTitle) {
  const absPath = resolve(filePath);
  const name = basename(filePath);

  if (!existsSync(absPath)) {
    console.error(`${C.red}error${C.reset}: file not found: ${absPath}`);
    return 2;
  }

  // Read source
  const source = readFileSync(absPath, 'utf-8');
  const lines = source.split(/\r?\n/);

  if (verbose) {
    console.log(`${C.dim}── ${name} (${lines.length} lines, ${source.length} bytes) ──${C.reset}`);
  }

  // Diagnostics — structural
  const diagnostics = computeDiagnostics(source);

  // Semantic checks (--strict mode)
  if (strict) {
    const semanticDiags = computeSemanticDiagnostics(source);
    diagnostics.push(...semanticDiags);
  }

  const errors = diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);
  const warnings = diagnostics.filter(d => d.severity === DiagnosticSeverity.Warning);

  // Print diagnostics (gcc-style: file:line:col: severity: message)
  for (const d of diagnostics) {
    if (quiet && d.severity !== DiagnosticSeverity.Error) continue;
    const line = d.range.start.line + 1;
    const col = d.range.start.character + 1;
    const sev = severityLabel(d.severity);
    const color = severityColor(d.severity);
    console.log(`${C.bold}${name}:${line}:${col}:${C.reset} ${color}${sev}${C.reset}: ${d.message}`);

    // Show source context
    if (!quiet && d.range.start.line < lines.length) {
      const srcLine = lines[d.range.start.line];
      console.log(`  ${C.dim}${line} |${C.reset} ${srcLine}`);
      const pointer = ' '.repeat(col - 1) + '^';
      console.log(`  ${C.dim}  |${C.reset} ${color}${pointer}${C.reset}`);
    }
  }

  // Analysis (if requested)
  if (analyze) {
    const { tokens, variables, cursors, functions } = parseDocument(source);
    const tableRefs = extractTableRefs(source);
    const tableFieldRefs = extractTableFieldRefs(source);
    const sqlStatements = extractSqlStatements(source);
    const sysVars = extractSystemVars(tokens);
    const builtinCalls = extractBuiltinCalls(tokens);

    console.log(`\n${C.bold}${C.cyan}── Analysis: ${name} ──${C.reset}`);
    console.log(`  ${C.bold}Lines:${C.reset}      ${lines.length}`);
    console.log(`  ${C.bold}Variables:${C.reset}  ${[...variables.entries()].map(([k,v]) => `${k} (${v.type})`).join(', ') || '(none)'}`);
    console.log(`  ${C.bold}Cursors:${C.reset}    ${[...cursors].join(', ') || '(none)'}`);
    console.log(`  ${C.bold}Functions:${C.reset}  ${[...functions].join(', ') || '(none)'}`);
    console.log(`  ${C.bold}Tables:${C.reset}     ${tableRefs.join(', ') || '(none)'}`);

    if (tableFieldRefs.size > 0) {
      console.log(`  ${C.bold}Fields:${C.reset}`);
      for (const [table, fields] of tableFieldRefs) {
        console.log(`    ${table}: ${[...fields].join(', ')}`);
      }
    }

    if (sqlStatements.length > 0) {
      console.log(`  ${C.bold}SQL:${C.reset}`);
      for (const sql of sqlStatements) {
        const short = sql.length > 80 ? sql.substring(0, 77) + '...' : sql;
        console.log(`    ${C.dim}${short}${C.reset}`);
      }
    }

    console.log(`  ${C.bold}Builtins:${C.reset}   ${builtinCalls.join(', ') || '(none)'}`);
    console.log(`  ${C.bold}Sys vars:${C.reset}   ${sysVars.join(', ') || '(none)'}`);
  }

  // Summary line
  const summary = [];
  if (errors.length > 0) summary.push(`${C.red}${errors.length} error(s)${C.reset}`);
  if (warnings.length > 0) summary.push(`${C.yellow}${warnings.length} warning(s)${C.reset}`);

  // If errors, stop
  if (errors.length > 0) {
    console.log(`\n${C.red}${C.bold}✗ compilation failed${C.reset} — ${summary.join(', ')}`);
    return 1;
  }

  // Check-only mode
  if (checkOnly) {
    if (summary.length > 0) {
      console.log(`\n${C.green}${C.bold}✓ valid${C.reset} — ${summary.join(', ')}`);
    } else {
      console.log(`${C.green}${C.bold}✓ ${name}${C.reset} — no issues`);
    }
    return 0;
  }

  // Derive title from first comment if not provided
  let effectiveTitle = ruleTitle || '';
  if (!effectiveTitle) {
    // Try to extract from @...@ comment
    const atMatch = source.match(/@\s*(.+?)[\s@]/s);
    if (atMatch) {
      effectiveTitle = atMatch[1].trim().substring(0, 70);
    } else {
      // Try /* ... */ comment
      const blockMatch = source.match(/\/\*\s*(.+?)[\s*]/s);
      if (blockMatch) effectiveTitle = blockMatch[1].trim().substring(0, 70);
    }
    if (!effectiveTitle) {
      effectiveTitle = basename(filePath, extname(filePath));
    }
  }

  // Encode to .LSP
  const { buffer, key, warnings: encWarnings } = encodeLsp(source, effectiveTitle);

  // Determine output path
  const out = outPath || resolve(dirname(absPath), basename(filePath, extname(filePath)) + '.LSP');
  writeFileSync(out, buffer);

  const relOut = out.startsWith(process.cwd()) ? out.substring(process.cwd().length + 1).replace(/\\/g, '/') : out;

  console.log(
    `${C.green}${C.bold}✓ ${name}${C.reset} → ${C.bold}${relOut}${C.reset}` +
    ` ${C.dim}(${buffer.length} bytes, key=0x${key.toString(16).toUpperCase().padStart(2, '0')}` +
    `, title="${effectiveTitle}")${C.reset}` +
    (summary.length > 0 ? ` — ${summary.join(', ')}` : '')
  );

  return 0;
}

// ── Batch mode ──────────────────────────────────────────────────────────────

if (batchDir) {
  const dir = resolve(batchDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`${C.red}error${C.reset}: not a directory: ${dir}`);
    process.exit(2);
  }

  const files = readdirSync(dir)
    .filter(f => f.toLowerCase().endsWith('.senior'))
    .sort();

  if (files.length === 0) {
    console.log(`${C.yellow}warning${C.reset}: no .senior files found in ${dir}`);
    process.exit(0);
  }

  console.log(`${C.bold}${C.cyan}seniorc${C.reset} — compiling ${files.length} files in ${batchDir}/\n`);

  let ok = 0, fail = 0;
  for (const f of files) {
    const code = compile(join(dir, f), null, null);
    if (code === 0) ok++;
    else fail++;
  }

  console.log(`\n${C.bold}── batch: ${ok} compiled, ${fail} failed ──${C.reset}`);
  process.exit(fail > 0 ? 1 : 0);
}

// ── Watch mode ──────────────────────────────────────────────────────────────

if (watchMode) {
  if (!inputFile) {
    console.error(`${C.red}error${C.reset}: --watch requires an input file`);
    process.exit(2);
  }

  const absPath = resolve(inputFile);
  if (!existsSync(absPath)) {
    console.error(`${C.red}error${C.reset}: file not found: ${absPath}`);
    process.exit(2);
  }

  console.log(`${C.bold}${C.cyan}seniorc${C.reset} — watching ${basename(inputFile)} for changes (Ctrl+C to stop)\n`);
  compile(inputFile, outputFile, title);

  watchFile(absPath, { interval: 500 }, () => {
    console.log(`\n${C.dim}[${new Date().toLocaleTimeString()}] change detected${C.reset}`);
    compile(inputFile, outputFile, title);
  });
} else {
  // ── Single file mode ────────────────────────────────────────────────────

  if (!inputFile) {
    console.error(`${C.red}error${C.reset}: no input file specified. Run ${C.bold}seniorc --help${C.reset} for usage.`);
    process.exit(2);
  }

  const code = compile(inputFile, outputFile, title);
  process.exit(code);
}
