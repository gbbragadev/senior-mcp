import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __filename_test = fileURLToPath(import.meta.url);
const __dirname_test = dirname(__filename_test);
import { readFileSync, readdirSync } from 'fs';
import { computeDiagnostics, computeSemanticDiagnostics, parseDocument, extractTableRefs, extractTableFieldRefs, extractSqlStatements, extractBuiltinCalls, extractSystemVars, DiagnosticSeverity } from '../src/compiler/lang-diagnostics.js';
import { encodeLsp } from '../src/compiler/lang-encoder.js';
import { searchExamples, listExamples } from '../src/compiler/lang-examples.js';
import { generateTemplate, listTemplates } from '../src/compiler/lang-templates.js';
import { REFERENCE_SECTIONS, BUILTIN_CATALOG, MODULE_CONTEXTS } from '../src/compiler/lang-knowledge.js';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === false) throw new Error('assertion failed');
    console.log(`  ${PASS} ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ${FAIL} ${name}: ${e.message}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 1: Templates geram código válido ═══\x1b[0m\n');

const templateNames = listTemplates().map(t => t.name);
for (const name of templateNames) {
  test(`Template "${name}" gera código sem erros de sintaxe`, () => {
    const { code } = generateTemplate(name, { table: 'R034FUN', fields: 'NumEmp,NomFun,DatAdm' });
    const diags = computeDiagnostics(code);
    const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
    if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
  });
}

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 2: Regra manual — validação + cursor + email ═══\x1b[0m\n');

const regra = readFileSync(resolve(__dirname_test, 'test-rule.senior'), 'utf-8');

test('Regra não tem erros de sintaxe', () => {
  const diags = computeDiagnostics(regra);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('Parser detecta 6 variáveis', () => {
  const { variables } = parseDocument(regra);
  if (variables.size !== 6) throw new Error(`esperado 6, obtido ${variables.size}: ${[...variables.keys()].join(', ')}`);
});

test('Parser detecta cursor cChefe', () => {
  const { cursors } = parseDocument(regra);
  if (!cursors.has('cChefe')) throw new Error(`cursores: ${[...cursors].join(', ')}`);
});

test('Detecta tabela R034FUN', () => {
  const tables = extractTableRefs(regra);
  if (!tables.includes('R034FUN')) throw new Error(`tabelas: ${tables.join(', ')}`);
});

test('Detecta campos NumEmp, NomFun da R034FUN', () => {
  const fieldRefs = extractTableFieldRefs(regra);
  const fields = fieldRefs.get('R034FUN');
  if (!fields || !fields.has('NumEmp') || !fields.has('NomFun'))
    throw new Error(`campos: ${fields ? [...fields].join(', ') : 'nenhum'}`);
});

test('Extrai SQL do cursor', () => {
  const sqls = extractSqlStatements(regra);
  if (sqls.length !== 1) throw new Error(`esperado 1 SQL, obtido ${sqls.length}`);
  if (!sqls[0].includes('R034FUN')) throw new Error(`SQL não referencia R034FUN`);
});

test('Detecta builtins: Mensagem, Cancel, EnviaEMail, MensagemLog', () => {
  const { tokens } = parseDocument(regra);
  const builtins = extractBuiltinCalls(tokens);
  const expected = ['Cancel', 'EnviaEMail', 'Mensagem', 'MensagemLog'];
  for (const fn of expected) {
    if (!builtins.includes(fn)) throw new Error(`falta builtin: ${fn}, encontrados: ${builtins.join(', ')}`);
  }
});

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 3: Encode → decode round-trip ═══\x1b[0m\n');

test('Encode produz buffer válido com magic bytes corretos', () => {
  const { buffer } = encodeLsp(regra, 'Regra Antes Salvar Funcionario');
  if (buffer[0] !== 0x01 || buffer[1] !== 0x03) throw new Error('magic bytes incorretos');
  if (buffer.length < 0x68 + regra.length) throw new Error(`buffer muito pequeno: ${buffer.length}`);
});

test('Título é armazenado corretamente no header', () => {
  const title = 'Regra Antes Salvar Funcionario';
  const { buffer } = encodeLsp(regra, title);
  const titleLen = buffer[0x08];
  const stored = Buffer.from(buffer.slice(0x09, 0x09 + titleLen)).toString('latin1');
  if (stored !== title) throw new Error(`esperado "${title}", obtido "${stored}"`);
});

test('Round-trip: decode do encode reproduz o source original', () => {
  const { buffer, key } = encodeLsp(regra, 'Test');
  // Decode manually (same logic as lsp-decoder)
  const body = buffer.slice(0x68);
  const decoded = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i++) decoded[i] = body[i] ^ key;
  const recoveredSource = decoded.toString('latin1');
  // Compare (trim trailing nulls/garbage)
  const clean = recoveredSource.replace(/[\x00-\x08\x0E-\x1F]+$/g, '');
  if (!clean.includes('Definir Numero xNumEmp')) throw new Error('source não recuperado');
  if (!clean.includes('EnviaEMail')) throw new Error('EnviaEMail não encontrado no decode');
});

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 4: Busca de exemplos ═══\x1b[0m\n');

test('listExamples retorna 20 arquivos', () => {
  if (listExamples().length !== 20) throw new Error(`${listExamples().length} arquivos`);
});

test('Busca "cursor" encontra múltiplos resultados', () => {
  const results = searchExamples('cursor');
  if (results.length < 5) throw new Error(`apenas ${results.length} resultados`);
});

test('Busca "EnviaEMail" encontra QLRG001', () => {
  const results = searchExamples('EnviaEMail');
  if (!results.some(r => r.file === 'QLRG001.senior')) throw new Error('QLRG001 não encontrado');
});

test('Filtro por módulo SMRG retorna apenas SMRG*', () => {
  const results = searchExamples('cursor', null, 'SMRG');
  if (results.some(r => !r.module.startsWith('SM'))) throw new Error('resultados fora do módulo SMRG');
});

test('Filtro por padrão platform_api encontra FPRG800', () => {
  const results = searchExamples('plataforma', 'platform_api');
  if (!results.some(r => r.file === 'FPRG800.senior')) throw new Error('FPRG800 não encontrado');
});

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 5: Knowledge base ═══\x1b[0m\n');

test('REFERENCE_SECTIONS tem 11 seções', () => {
  if (Object.keys(REFERENCE_SECTIONS).length !== 11) throw new Error(`${Object.keys(REFERENCE_SECTIONS).length} seções`);
});

test('BUILTIN_CATALOG tem 75+ funções', () => {
  if (BUILTIN_CATALOG.length < 75) throw new Error(`apenas ${BUILTIN_CATALOG.length} funções`);
});

test('MODULE_CONTEXTS cobre 7 módulos', () => {
  if (Object.keys(MODULE_CONTEXTS).length !== 7) throw new Error(`${Object.keys(MODULE_CONTEXTS).length} módulos`);
});

test('Seção "syntax" contém Definir, Se, Enquanto', () => {
  const s = REFERENCE_SECTIONS.syntax;
  if (!s.includes('Definir') || !s.includes('Se') || !s.includes('Enquanto'))
    throw new Error('keywords faltando na seção syntax');
});

test('Seção "builtins" contém EnviaEMail e SQL_Criar', () => {
  const s = REFERENCE_SECTIONS.builtins;
  if (!s.includes('EnviaEMail') || !s.includes('SQL_Criar'))
    throw new Error('builtins faltando');
});

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 6: Detecção de erros ═══\x1b[0m\n');

test('Detecta chave não fechada', () => {
  const diags = computeDiagnostics('Se (x = 1) {\n  Mensagem(Retorna, "ok");\n');
  if (!diags.some(d => d.severity === 1)) throw new Error('erro não detectado');
});

test('Detecta string não fechada', () => {
  const diags = computeDiagnostics('xMsg = "texto sem fechar;');
  if (!diags.some(d => d.message.includes('String'))) throw new Error('string aberta não detectada');
});

test('Detecta Inicio sem Fim', () => {
  const diags = computeDiagnostics('Se (x = 1)\nInicio\n  x = 2;\n');
  if (!diags.some(d => d.message.includes('Inicio'))) throw new Error('Inicio sem Fim não detectado');
});

test('Detecta Definir sem ponto-e-vírgula', () => {
  const diags = computeDiagnostics('Definir Numero xVal');
  if (!diags.some(d => d.message.includes('Definir'))) throw new Error('warning não detectado');
});

test('Código válido tem 0 erros', () => {
  const diags = computeDiagnostics('Definir Numero x;\nx = 42;\nSe (x > 0) {\n  Mensagem(Retorna, "ok");\n}');
  const errors = diags.filter(d => d.severity === 1);
  if (errors.length > 0) throw new Error(`${errors.length} erros em código válido`);
});

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 7: Fase 1 — Validação Estrutural Avançada ═══\x1b[0m\n');

test('S01: String multi-linha com backslash continuation', () => {
  const code = 'x = "SELECT a \\\nFROM b";';
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S02: String multi-linha com backslash + inline comment', () => {
  const code = 'x = "col = 1 \\ - inline comment\nAND col2 = 2";';
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S03: Char literal backslash', () => {
  const code = "Definir Alfa c;\nSe (c <> '\\\\') {\n  c = \"ok\";\n}";
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S04: Char literal comma', () => {
  const code = "Definir Alfa c;\nSe (c = ',') {\n  c = \"ok\";\n}";
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S05: Inicio/Fim com semicolon', () => {
  const code = "Definir Numero x;\nSe (x = 1)\nInicio\n  x = 2;\nFim;";
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S06: Fim inside identifier xDatFim', () => {
  const code = "Definir Data xDatFim;\nxDatFim = 0;";
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S07: Inicio inside identifier xInicio', () => {
  const code = "Definir Alfa xInicio;\nxInicio = \"test\";";
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S08: @ comment mid-line (code after closing @)', () => {
  // The second x = x + 1 is AFTER the closing @, so it should be parsed as code
  const code = "Definir Numero x;\nx = 1; @ comentário @ x = x + 1;";
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S09: /* */ inside string (not a comment)', () => {
  const code = 'Definir Alfa x;\nx = "/* não é comentário */";';
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S10: Keywords case-insensitive', () => {
  const code = "definir numero x;\nse (x = 1)\ninicio\n  x = 2;\nfim;";
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S11: Empty file', () => {
  const code = "";
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

test('S12: Multiple Definir on same line', () => {
  const code = "Definir Numero x; Definir Alfa y;";
  const diags = computeDiagnostics(code);
  const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);
  if (errors.length > 0) throw new Error(errors.map(e => `L${e.range.start.line+1}: ${e.message}`).join('; '));
});

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 8: Batch 20 exemplos ═══\x1b[0m\n');

const DECODED_RULES_DIR = resolve(__dirname_test, '../data/decoded-rules');
// TRRG005 is known to be truncated — it is expected to have errors
const KNOWN_TRUNCATED = new Set(['TRRG005.senior']);

let batchPassed = 0;
let batchFailed = 0;
const batchFiles = readdirSync(DECODED_RULES_DIR).filter(f => f.endsWith('.senior')).sort();

for (const file of batchFiles) {
  const isTruncated = KNOWN_TRUNCATED.has(file);
  const label = isTruncated ? `${file} (truncado — erros esperados)` : file;

  test(label, () => {
    const code = readFileSync(`${DECODED_RULES_DIR}/${file}`, 'utf-8');
    const diags = computeDiagnostics(code);
    const errors = diags.filter(d => d.severity === DiagnosticSeverity.Error);

    if (isTruncated) {
      // For the truncated file we just verify it doesn't crash the parser
      return true;
    }

    if (errors.length > 0) {
      throw new Error(errors.slice(0, 3).map(e => `L${e.range.start.line+1}: ${e.message}`).join('; ') +
        (errors.length > 3 ? ` (+${errors.length - 3} more)` : ''));
    }
  });
}

console.log(`\n  Batch summary: ${batchFiles.length} files processed (${batchFiles.length - KNOWN_TRUNCATED.size} expected clean, ${KNOWN_TRUNCATED.size} known truncated)\n`);

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 9: Fase 2 — Validação de Variáveis ═══\x1b[0m\n');

test('V01: Variável declarada e usada — 0 warnings', () => {
  const d = computeSemanticDiagnostics('Definir Numero x;\nx = 1;');
  const warns = d.filter(x => x.message.includes('não declarada'));
  if (warns.length > 0) throw new Error(warns[0].message);
});

test('V02: Variável não declarada — detectada', () => {
  const d = computeSemanticDiagnostics('xUndef = 1;');
  if (!d.some(x => x.message.includes('não declarada') && x.message.includes('xUndef')))
    throw new Error('undeclared variable not detected');
});

test('V03: System variable VerWeb — sem warning', () => {
  const d = computeSemanticDiagnostics('Definir Numero x;\nSe (VerWeb = 1) {\n  x = 1;\n}');
  if (d.some(x => x.message.toLowerCase().includes('verweb')))
    throw new Error('VerWeb flagged as undeclared');
});

test('V04: System variable datsis — sem warning', () => {
  const d = computeSemanticDiagnostics('Definir Data xData;\nxData = datsis;');
  if (d.some(x => x.message.toLowerCase().includes('datsis')))
    throw new Error('datsis flagged as undeclared');
});

test('V05: Table.Field acesso — sem warning no campo', () => {
  const d = computeSemanticDiagnostics('Definir Numero x;\nx = R034FUN.NumEmp;');
  if (d.some(x => x.message.includes('NumEmp') && x.message.includes('não declarada')))
    throw new Error('table field flagged as undeclared');
});

test('V08: GerSolExa_* prefixed system var — sem warning', () => {
  const d = computeSemanticDiagnostics('Definir Alfa x;\nx = GerSolExa_Origem;');
  if (d.some(x => x.message.includes('GerSolExa_Origem') && x.message.includes('não declarada')))
    throw new Error('GerSolExa_ prefix not recognized as system var');
});

test('V09: Definir dentro de bloco — sem warning', () => {
  const d = computeSemanticDiagnostics('Se (1 = 1) {\n  Definir Alfa y;\n  y = "ok";\n}');
  if (d.some(x => x.message.includes("'y'") && x.message.includes('não declarada')))
    throw new Error('block-scoped variable flagged');
});

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 10: Fase 3 — Validação de Funções ═══\x1b[0m\n');

test('F01: Builtin Mensagem(Retorna, "ok") — correto', () => {
  const d = computeSemanticDiagnostics('Mensagem(Retorna, "ok");');
  if (d.some(x => x.message.includes('Mensagem')))
    throw new Error('Mensagem flagged: ' + d.find(x => x.message.includes('Mensagem')).message);
});

test('F03: Builtin aridade errada — EnviaEMail com 2 args', () => {
  const d = computeSemanticDiagnostics('EnviaEMail("a", "b");');
  if (!d.some(x => x.message.includes('esperado') || x.message.includes('expected')))
    throw new Error('wrong arity not detected');
});

test('F04: Função inexistente — detectada', () => {
  const d = computeSemanticDiagnostics('FuncaoFalsa("x");');
  if (!d.some(x => x.message.includes('desconhecida') || x.message.includes('Unknown')))
    throw new Error('unknown function not detected');
});

test('F05: Typo em builtin — Mensagemm', () => {
  const d = computeSemanticDiagnostics('Mensagemm(Retorna, "x");');
  if (!d.some(x => x.message.includes('desconhecida') || x.message.includes('Unknown')))
    throw new Error('typo not detected');
});

test('F06: User-defined function — sem warning', () => {
  const d = computeSemanticDiagnostics('definir funcao f();\nf();\nfuncao f(); {\n  Definir Numero x;\n  x = 1;\n}');
  if (d.some(x => x.message.includes("'f'") && x.message.includes('desconhecida')))
    throw new Error('user function flagged as unknown');
});

test('F09: Concatena 3 args — correto', () => {
  const d = computeSemanticDiagnostics('Definir Alfa x;\nConcatena("a", "b", x);');
  if (d.some(x => x.message.includes('Concatena') && x.message.includes('esperado')))
    throw new Error('Concatena 3-arg flagged');
});

test('F13: FluxoBasico_Finalizar() 0 args — correto', () => {
  const d = computeSemanticDiagnostics('FluxoBasico_Finalizar();');
  if (d.some(x => x.message.includes('FluxoBasico_Finalizar') && x.message.includes('esperado')))
    throw new Error('0-arg function flagged');
});

test('F15: DataHoje 1 arg — correto', () => {
  const d = computeSemanticDiagnostics('Definir Data xData;\nDataHoje(xData);');
  if (d.some(x => x.message.includes('DataHoje') && x.message.includes('esperado')))
    throw new Error('DataHoje flagged');
});

// ═══════════════════════════════════════════════════════════════
console.log('\n\x1b[1m═══ TESTE 11: Fase 4 — Ciclo de Vida de Cursores ═══\x1b[0m\n');

test('C01: Ciclo completo correto — sem warning', () => {
  const code = 'Definir Cursor c;\nc.SQL "SELECT 1";\nc.AbrirCursor();\nEnquanto (c.Achou) {\n  c.Proximo();\n}\nc.FecharCursor();';
  const d = computeSemanticDiagnostics(code);
  const cursorWarns = d.filter(x => x.message.toLowerCase().includes('cursor'));
  if (cursorWarns.length > 0) throw new Error(cursorWarns[0].message);
});

test('C02: AbrirCursor sem SQL — detectado', () => {
  const code = 'Definir Cursor c;\nc.AbrirCursor();';
  const d = computeSemanticDiagnostics(code);
  if (!d.some(x => x.message.includes('SQL')))
    throw new Error('cursor opened without SQL not detected');
});

test('C03: Cursor nunca fechado — detectado', () => {
  const code = 'Definir Cursor c;\nc.SQL "SELECT 1";\nc.AbrirCursor();\nDefinir Numero x;\nx = c.Campo;';
  const d = computeSemanticDiagnostics(code);
  if (!d.some(x => x.message.includes('fechado') || x.message.includes('closed') || x.message.includes('not closed')))
    throw new Error('unclosed cursor not detected');
});

// ═══════════════════════════════════════════════════════════════
console.log(`\n\x1b[1m═══ RESULTADO: ${passed} passed, ${failed} failed ═══\x1b[0m\n`);
process.exit(failed > 0 ? 1 : 0);
