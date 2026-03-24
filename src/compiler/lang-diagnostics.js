import { BUILTIN_ARITY } from './lang-knowledge.js';

/**
 * Senior HCM Rule Language — Diagnostics & Parser Engine
 *
 * Pure ESM module ported from tools/senior-compile.js.
 * No I/O, no ANSI colors, no CLI code — just functions that operate on text.
 *
 * Exports:
 *   computeDiagnostics(text)          → [{severity, range, message, source}]
 *   computeSemanticDiagnostics(text)  → [{severity, range, message, source}]
 *   validateVariables(tokens, variables, functions) → diagnostics[]
 *   validateFunctionCalls(tokens, functions) → diagnostics[]
 *   validateCursorLifecycle(tokens, cursors) → diagnostics[]
 *   tokenizeLine(text, lineNumber, inBlockComment) → {tokens, inBlockComment}
 *   parseDocument(text)               → {tokens, variables, cursors, functions}
 *   extractTableRefs(source)          → sorted string[]
 *   extractTableFieldRefs(source)     → Map<table, Set<field>>
 *   extractSqlStatements(source)      → string[]
 *   extractSystemVars(tokens)         → sorted string[]
 *   extractBuiltinCalls(tokens)       → sorted string[]
 *   DiagnosticSeverity                → {Error:1, Warning:2, Information:3, Hint:4}
 *   TokenType                         → enum object
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export const DiagnosticSeverity = Object.freeze({
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
});

export const TokenType = Object.freeze({
  Keyword: 'keyword',
  BuiltinFunction: 'builtinFunction',
  SystemVariable: 'systemVariable',
  TableReference: 'tableReference',
  CursorMethod: 'cursorMethod',
  Comment: 'comment',
  String: 'string',
  Number: 'number',
  Identifier: 'identifier',
  Operator: 'operator',
  Punctuation: 'punctuation',
  Whitespace: 'whitespace',
  Unknown: 'unknown',
});

// ─── Constants ────────────────────────────────────────────────────────────────

export const RESERVED_WORD_NAMES = [
  'definir', 'se', 'senao', 'enquanto', 'inicio', 'fim',
  'funcao', 'numero', 'alfa', 'data', 'cursor', 'retorna',
  'erro', 'e', 'ou',
];

export const BUILTIN_FUNCTION_NAMES = [
  // Original set
  'mensagem', 'mensagemlog', 'cancel', 'datahoje', 'desmontadata',
  'montadata', 'intparaalfa', 'alfaparaint', 'trocastring',
  'tamanhoalfa', 'lerposicaoalfa', 'convertecodificacaostring',
  'retornaascii', 'formatar', 'convertemascara', 'retornavalorcfg',
  'abrir', 'fechar', 'gravarnl', 'contador', 'wcheckvalinteger',
  'wcheckvalstring', 'wcheckvaldata', 'wcheckvaldouble',
  'wcheckvalcheckbox', 'getaccesstoken', 'carregarcsvrplataforma',
  'retnivloc', 'retnumlocniv', 'retornaperguntas',
  'carregarespostasporpergunta', 'conferirquadroefetivo',
  'calculadatarev',

  // Discovered from examples
  'copiaralfa', 'concatena', 'estanulo', 'retornamesdata',
  'retornaanodata', 'retornacodloc', 'busqtddias',
  'busqtddiasmes', 'dataextenso', 'arredondarvalor',
  'montaabrangencia', 'descitemlista', 'listaquantidade',
  'listaitem', 'enviaemail', 'retornanomecampofrmtevidencia',

  // SQL API family
  'sql_criar', 'sql_definircomando', 'sql_definirinteiro',
  'sql_definiralfa', 'sql_definirdata', 'sql_abrircursor',
  'sql_retornarinteiro', 'sql_retornaralfa', 'sql_retornardata',
  'sql_eof', 'sql_proximo', 'sql_fecharcursor', 'sql_destruir',

  // FluxoBasico API family
  'fluxobasico_criar', 'fluxobasico_adicionarsecao',
  'fluxobasico_adicionarcaixa', 'fluxobasico_adicionaritem',
  'fluxobasico_adicionarimagem', 'fluxobasico_adicionarlegenda',
  'fluxobasico_finalizar',

  // GerSolExa API family
  'gersolexaconsultarlistaexames', 'gersolexaadicionarexamelista',
  'gersolexaremoverexamelista', 'gersolexalimparlistaexames',
];

export const SYSTEM_VARIABLE_NAMES = [
  // Original set
  'verweb', 'datsis', 'menlog', 'numemp', 'tipcol', 'numcad',
  // Expanded (45+)
  'empatu', 'vexecucaoregra', 'cgiaddr', 'wnconector',
  'mediaavadet', 'tipoavadet', 'retdatrev', 'tipoppes', 'tipopaves',
  'listarequisicoesonuncio', 'listarequisicoesamuncio',
  'datareferencialnt', 'codusu',
  'abrsolexatipcol', 'abrsolexanumcad', 'abrsolexacodfic', 'abrsolexacodex',
  'gersolexaorigem', 'gersolexaperiodoinicio', 'gersolexaperiodotermino',
  'gersolexaconsiderarexames', 'gersolexadataexame', 'gersolexavencimentoexame',
  'gersolexaatendente', 'gersolexaconvenio', 'gersolexaentidadeexame',
  'gersolexasolicitacoesaberto', 'gersolexadiassolicitacao', 'gersolexarequisicao',
  'gersolexaestruturapostos', 'gersolexapostotrabalho', 'gersolexafilial',
  'gersolexaorganograma', 'gersolexalocal', 'gersolexaestruturacargos',
  'gersolexacargo', 'gersolexaatividade', 'gersolexappra', 'gersolexaabrangenciaghe',
  'gersolexaconsiderarsituacao', 'gersolexagerarexamesorigem',
  'gersolexaconsiderarexamesmesmotipo', 'resasstestearray',
  'listarequisicoes',
];

/** Prefixes that identify system variables (case-insensitive match) */
const SYSTEM_VARIABLE_PREFIXES = ['gersolexa_', 'abrsolexa_'];

export const TABLE_REF_PATTERN = /^[Rr]\d{3}[A-Za-z_]\w*/;

export const CURSOR_METHOD_PATTERN = /^(SQL|AbrirCursor|FecharCursor|Proximo|Achou|NaoAchou)\b/i;

export const TABLE_DESCRIPTIONS = {
  'R030EMP': 'Empresas (Companies)',
  'R030ORG': 'Organograma da Empresa (Company Org Chart)',
  'R034FUN': 'Funcionários (Employees)',
  'R034CPL': 'Complemento do Funcionário (Employee Complement)',
  'R034USU': 'Usuário do Funcionário (Employee User)',
  'R036DEP': 'Dependentes (Dependents)',
  'R016HIE': 'Hierarquia de Locais (Location Hierarchy)',
  'R016ORN': 'Organograma de Locais (Location Org Chart)',
  'R018CCU': 'Centros de Custo (Cost Centers)',
  'R024CAR': 'Cargos (Positions/Jobs)',
  'R077CDE': 'Avaliação de Desempenho - Conceito (Performance Eval - Concept)',
  'R077PDE': 'Avaliação de Desempenho - Peso (Performance Eval - Weight)',
  'R079EDE': 'Avaliação de Desempenho - Escala (Performance Eval - Scale)',
  'R098EQP': 'Equipamentos (Equipment)',
  'R098RTE': 'Revisão de Equipamentos (Equipment Reviews)',
  'R101AVA': 'Avaliações (Evaluations)',
  'R110FIC': 'Fichas Médicas (Medical Records)',
  'R126CAN': 'Candidatos (Candidates)',
  'R166LAN': 'Lançamentos de Auxílio (Benefit Entries)',
  'R166AUX': 'Auxílios (Benefits)',
  'R960RUL': 'Regras - Dados Binários (Rules - Binary Data)',
  'R999USU': 'Usuários do Sistema (System Users)',
  'R999RUL': 'Regras - Strings (Rules - Strings)',
  'R996FLD': 'Definições de Campos (Field Definitions)',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createRange(startLine, startChar, endLine, endChar) {
  return {
    start: { line: startLine, character: startChar },
    end: { line: endLine, character: endChar },
  };
}

// ─── Diagnostics Engine ───────────────────────────────────────────────────────

export function computeDiagnostics(text) {
  const lines = text.split(/\r?\n/);
  const diagnostics = [];
  let inCStyleComment = false, cStyleCommentStart = 0;
  let inAtComment = false, atCommentStart = 0;
  let inMultiLineString = null, multiLineStringStart = 0; // '"' or "'" when inside a continued string
  let braceDepth = 0;
  const braceStack = [];
  let inicioFimDepth = 0;
  const inicioStack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let pos = 0;

    // Handle multi-line string continuation (backslash line continuation)
    if (inMultiLineString) {
      const quoteChar = inMultiLineString;
      const endIdx = line.indexOf(quoteChar, pos);
      if (endIdx !== -1) {
        // String closed on this line — check if closing quote is real
        // (not preceded by backslash, or preceded by escaped backslash)
        inMultiLineString = null;
        pos = endIdx + 1;
      } else if (line.includes('\\')) {
        // Line contains backslash — treat as continuation regardless of what follows
        // Senior allows: "SQL text \ - inline comment" as continuation
        pos = line.length;
      } else {
        // No closing quote and no backslash — string ends without closing
        inMultiLineString = null;
        pos = line.length;
      }
      if (pos >= line.length) continue;
    }

    while (pos < line.length) {
      if (inCStyleComment) {
        const endIdx = line.indexOf('*/', pos);
        if (endIdx !== -1) { inCStyleComment = false; pos = endIdx + 2; }
        else pos = line.length;
        continue;
      }
      if (inAtComment) {
        const endIdx = line.indexOf('@', pos);
        if (endIdx !== -1) { inAtComment = false; pos = endIdx + 1; }
        else pos = line.length;
        continue;
      }
      const ch = line[pos];
      if (ch === '/' && pos + 1 < line.length && line[pos + 1] === '*') {
        cStyleCommentStart = i;
        const endIdx = line.indexOf('*/', pos + 2);
        if (endIdx !== -1) pos = endIdx + 2;
        else { inCStyleComment = true; pos = line.length; }
        continue;
      }
      if (ch === '@') {
        atCommentStart = i;
        const endIdx = line.indexOf('@', pos + 1);
        if (endIdx !== -1) pos = endIdx + 1;
        else { inAtComment = true; pos = line.length; }
        continue;
      }
      if (ch === '"') {
        const startPos = pos; pos++;
        let closed = false;
        while (pos < line.length) {
          if (line[pos] === '\\' && pos + 1 < line.length) { pos += 2; continue; }
          if (line[pos] === '"') { closed = true; pos++; break; }
          pos++;
        }
        if (!closed) {
          // Check for backslash line continuation anywhere after the opening quote
          // Senior allows: "SQL text \ - comment" as line continuation
          const afterQuote = line.substring(startPos + 1);
          if (afterQuote.includes('\\')) {
            // Multi-line string continuation — scan subsequent lines
            inMultiLineString = '"';
            multiLineStringStart = i;
          } else {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: createRange(i, startPos, i, line.length),
              message: 'String não fechada (Unclosed string literal)',
              source: 'senior-lsp',
            });
          }
        }
        continue;
      }
      if (ch === "'") {
        const startPos = pos; pos++;
        let closed = false;
        // Single-quoted strings are char literals in Senior — no escape processing
        while (pos < line.length) {
          if (line[pos] === "'") { closed = true; pos++; break; }
          pos++;
        }
        if (!closed) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: createRange(i, startPos, i, line.length),
            message: 'String não fechada (Unclosed string literal)',
            source: 'senior-lsp',
          });
        }
        continue;
      }
      if (ch === '{') { braceStack.push({ line: i, char: pos }); braceDepth++; pos++; continue; }
      if (ch === '}') {
        if (braceStack.length > 0) { braceStack.pop(); braceDepth--; }
        else {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: createRange(i, pos, i, pos + 1),
            message: 'Chave de fechamento sem correspondência (Unmatched closing brace)',
            source: 'senior-lsp',
          });
        }
        pos++; continue;
      }
      const remaining = line.substring(pos);
      const prevChar = pos > 0 ? line[pos - 1] : '';
      const isWordBoundary = !prevChar || !/[A-Za-z0-9_]/.test(prevChar);
      const inicioMatch = isWordBoundary && remaining.match(/^(inicio)\b/i);
      if (inicioMatch) {
        inicioStack.push({ line: i, char: pos });
        inicioFimDepth++; pos += inicioMatch[0].length; continue;
      }
      const fimMatch = isWordBoundary && remaining.match(/^(fim)\b/i);
      if (fimMatch) {
        if (inicioStack.length > 0) { inicioStack.pop(); inicioFimDepth--; }
        else {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: createRange(i, pos, i, pos + fimMatch[0].length),
            message: '"Fim" sem "Inicio" correspondente ("Fim" without matching "Inicio")',
            source: 'senior-lsp',
          });
        }
        pos += fimMatch[0].length; continue;
      }
      pos++;
    }
    if (!inCStyleComment && !inAtComment) {
      const trimmed = line.trim();
      const definirMatch = trimmed.match(/^[Dd]efinir\s+(?:Numero|Alfa|Data|Cursor|numero|alfa|data|cursor)\s+\w+\s*$/i);
      if (definirMatch) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: createRange(i, line.length - 1, i, line.length),
          message: 'Falta ponto-e-vírgula após declaração Definir (Missing semicolon after Definir statement)',
          source: 'senior-lsp',
        });
      }
    }
  }
  if (inCStyleComment) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: createRange(cStyleCommentStart, 0, cStyleCommentStart, lines[cStyleCommentStart]?.length || 0),
      message: 'Comentário /* não fechado (Unclosed /* comment)',
      source: 'senior-lsp',
    });
  }
  if (inAtComment) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: createRange(atCommentStart, 0, atCommentStart, lines[atCommentStart]?.length || 0),
      message: 'Comentário @ não fechado (Unclosed @ comment)',
      source: 'senior-lsp',
    });
  }
  for (const brace of braceStack) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: createRange(brace.line, brace.char, brace.line, brace.char + 1),
      message: 'Chave de abertura sem correspondência (Unmatched opening brace)',
      source: 'senior-lsp',
    });
  }
  for (const inicio of inicioStack) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: createRange(inicio.line, inicio.char, inicio.line, inicio.char + 6),
      message: '"Inicio" sem "Fim" correspondente ("Inicio" without matching "Fim")',
      source: 'senior-lsp',
    });
  }
  return diagnostics;
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

export function tokenizeLine(text, lineNumber, inBlockComment) {
  const tokens = [];
  let pos = 0;
  let blockState = inBlockComment;
  while (pos < text.length) {
    if (blockState === 'at') {
      const end = text.indexOf('@', pos);
      if (end === -1) { tokens.push({ type: TokenType.Comment, value: text.substring(pos), line: lineNumber, startChar: pos, endChar: text.length }); pos = text.length; }
      else { tokens.push({ type: TokenType.Comment, value: text.substring(pos, end + 1), line: lineNumber, startChar: pos, endChar: end + 1 }); pos = end + 1; blockState = null; }
      continue;
    }
    if (blockState === 'cstyle') {
      const end = text.indexOf('*/', pos);
      if (end === -1) { tokens.push({ type: TokenType.Comment, value: text.substring(pos), line: lineNumber, startChar: pos, endChar: text.length }); pos = text.length; }
      else { tokens.push({ type: TokenType.Comment, value: text.substring(pos, end + 2), line: lineNumber, startChar: pos, endChar: end + 2 }); pos = end + 2; blockState = null; }
      continue;
    }
    const wsMatch = text.substring(pos).match(/^\s+/);
    if (wsMatch) { pos += wsMatch[0].length; continue; }
    if (text[pos] === '@') {
      const end = text.indexOf('@', pos + 1);
      if (end === -1) { tokens.push({ type: TokenType.Comment, value: text.substring(pos), line: lineNumber, startChar: pos, endChar: text.length }); pos = text.length; blockState = 'at'; }
      else { tokens.push({ type: TokenType.Comment, value: text.substring(pos, end + 1), line: lineNumber, startChar: pos, endChar: end + 1 }); pos = end + 1; }
      continue;
    }
    if (text[pos] === '/' && pos + 1 < text.length && text[pos + 1] === '*') {
      const end = text.indexOf('*/', pos + 2);
      if (end === -1) { tokens.push({ type: TokenType.Comment, value: text.substring(pos), line: lineNumber, startChar: pos, endChar: text.length }); pos = text.length; blockState = 'cstyle'; }
      else { tokens.push({ type: TokenType.Comment, value: text.substring(pos, end + 2), line: lineNumber, startChar: pos, endChar: end + 2 }); pos = end + 2; }
      continue;
    }
    if (text[pos] === '"') {
      let end = pos + 1;
      while (end < text.length) {
        if (text[end] === '\\' && end + 1 < text.length) { end += 2; continue; }
        if (text[end] === '"') { end++; break; }
        end++;
      }
      tokens.push({ type: TokenType.String, value: text.substring(pos, end), line: lineNumber, startChar: pos, endChar: end });
      pos = end; continue;
    }
    if (text[pos] === "'") {
      let end = pos + 1;
      while (end < text.length) {
        if (text[end] === '\\' && end + 1 < text.length) { end += 2; continue; }
        if (text[end] === "'") { end++; break; }
        end++;
      }
      tokens.push({ type: TokenType.String, value: text.substring(pos, end), line: lineNumber, startChar: pos, endChar: end });
      pos = end; continue;
    }
    const numMatch = text.substring(pos).match(/^\d+(\.\d+)?/);
    if (numMatch && (pos === 0 || !/[A-Za-z_]/.test(text[pos - 1]))) {
      tokens.push({ type: TokenType.Number, value: numMatch[0], line: lineNumber, startChar: pos, endChar: pos + numMatch[0].length });
      pos += numMatch[0].length; continue;
    }
    const idMatch = text.substring(pos).match(/^[A-Za-z_]\w*/);
    if (idMatch) {
      const word = idMatch[0];
      const wordLower = word.toLowerCase();
      const startChar = pos;
      pos += word.length;
      let tokenType = TokenType.Identifier;
      if (TABLE_REF_PATTERN.test(word)) tokenType = TokenType.TableReference;
      else if (RESERVED_WORD_NAMES.includes(wordLower)) tokenType = TokenType.Keyword;
      else if (BUILTIN_FUNCTION_NAMES.includes(wordLower)) tokenType = TokenType.BuiltinFunction;
      else if (SYSTEM_VARIABLE_NAMES.includes(wordLower)) tokenType = TokenType.SystemVariable;
      tokens.push({ type: tokenType, value: word, line: lineNumber, startChar, endChar: pos });
      continue;
    }
    const opMatch = text.substring(pos).match(/^(<>|<=|>=|==|!=|\+\+|--|[+\-*\/=<>!])/);
    if (opMatch) {
      tokens.push({ type: TokenType.Operator, value: opMatch[0], line: lineNumber, startChar: pos, endChar: pos + opMatch[0].length });
      pos += opMatch[0].length; continue;
    }
    if ('(){};,.:\\'.includes(text[pos])) {
      if (text[pos] === '.' && tokens.length > 0) {
        const prevToken = tokens[tokens.length - 1];
        const afterDot = text.substring(pos + 1);
        const methodMatch = afterDot.match(CURSOR_METHOD_PATTERN);
        if (methodMatch) {
          tokens.push({ type: TokenType.Punctuation, value: '.', line: lineNumber, startChar: pos, endChar: pos + 1 });
          pos++;
          tokens.push({ type: TokenType.CursorMethod, value: methodMatch[0], line: lineNumber, startChar: pos, endChar: pos + methodMatch[0].length });
          pos += methodMatch[0].length; continue;
        }
        if (prevToken && prevToken.type === TokenType.TableReference) {
          const fieldMatch = afterDot.match(/^[A-Za-z_]\w*/);
          if (fieldMatch) {
            prevToken.value += '.' + fieldMatch[0];
            prevToken.endChar = pos + 1 + fieldMatch[0].length;
            pos += 1 + fieldMatch[0].length; continue;
          }
        }
      }
      tokens.push({ type: TokenType.Punctuation, value: text[pos], line: lineNumber, startChar: pos, endChar: pos + 1 });
      pos++; continue;
    }
    tokens.push({ type: TokenType.Unknown, value: text[pos], line: lineNumber, startChar: pos, endChar: pos + 1 });
    pos++;
  }
  return { tokens, inBlockComment: blockState };
}

// ─── Document Parser ──────────────────────────────────────────────────────────

export function parseDocument(text) {
  const lines = text.split(/\r?\n/);
  const allTokens = [];
  const variables = new Map();
  const cursors = new Set();
  const functions = new Set();
  let blockComment = null;
  for (let i = 0; i < lines.length; i++) {
    const { tokens, inBlockComment } = tokenizeLine(lines[i], i, blockComment);
    blockComment = inBlockComment;
    allTokens.push(...tokens);
    for (let t = 0; t < tokens.length - 2; t++) {
      if (tokens[t].type === TokenType.Keyword && tokens[t].value.toLowerCase() === 'definir') {
        const next = tokens[t + 1];
        const nameToken = tokens[t + 2];
        if (next && nameToken) {
          const typeLower = next.value.toLowerCase();
          if (['numero', 'alfa', 'data', 'cursor'].includes(typeLower)) {
            variables.set(nameToken.value, { type: next.value, line: i });
            if (typeLower === 'cursor') cursors.add(nameToken.value);
          } else if (typeLower === 'funcao') {
            functions.add(nameToken.value.replace(/\(.*\)/, ''));
          }
        }
      }
      if (tokens[t].type === TokenType.Keyword && tokens[t].value.toLowerCase() === 'funcao') {
        const nameToken = tokens[t + 1];
        if (nameToken) functions.add(nameToken.value.replace(/\(.*\)/, ''));
      }
    }
  }
  return { tokens: allTokens, variables, cursors, functions };
}

// ─── Analysis Helpers ─────────────────────────────────────────────────────────

export function extractTableRefs(source) {
  const refs = new Set();
  const pattern = /[Rr]\d{3}[A-Za-z_]\w*/g;
  let m;
  while ((m = pattern.exec(source)) !== null) {
    // Normalize to uppercase prefix
    const ref = m[0].substring(0, 4).toUpperCase() + m[0].substring(4);
    refs.add(ref);
  }
  return [...refs].sort();
}

export function extractTableFieldRefs(source) {
  const refs = new Map(); // table -> Set of fields
  const pattern = /([Rr]\d{3}[A-Za-z_]\w*)\.([A-Za-z_]\w*)/g;
  let m;
  while ((m = pattern.exec(source)) !== null) {
    const table = m[1].substring(0, 4).toUpperCase() + m[1].substring(4);
    if (!refs.has(table)) refs.set(table, new Set());
    refs.get(table).add(m[2]);
  }
  return refs;
}

export function extractSqlStatements(source) {
  const sqls = [];
  const pattern = /\.SQL\s+"([^"]+)"/gi;
  let m;
  while ((m = pattern.exec(source)) !== null) {
    sqls.push(m[1].trim());
  }
  return sqls;
}

export function extractSystemVars(tokens) {
  const vars = new Set();
  for (const t of tokens) {
    if (t.type === TokenType.SystemVariable) vars.add(t.value);
  }
  return [...vars].sort();
}

export function extractBuiltinCalls(tokens) {
  const fns = new Set();
  for (const t of tokens) {
    if (t.type === TokenType.BuiltinFunction) fns.add(t.value);
  }
  return [...fns].sort();
}

// ─── Semantic Validation (Phases 2–4) ────────────────────────────────────────

/**
 * Helper: check if an identifier looks like a system variable by prefix.
 */
function isSystemVariableByPrefix(name) {
  const lower = name.toLowerCase();
  return SYSTEM_VARIABLE_PREFIXES.some(prefix => lower.startsWith(prefix));
}

/**
 * Phase 2–4 master semantic validator.
 * Parses the document, then runs variable, function-call, and cursor-lifecycle checks.
 */
export function computeSemanticDiagnostics(text) {
  const diagnostics = [];
  const { tokens, variables, cursors, functions } = parseDocument(text);

  // Phase 2: Variable validation
  diagnostics.push(...validateVariables(tokens, variables, functions));

  // Phase 3: Function arity validation
  diagnostics.push(...validateFunctionCalls(tokens, functions));

  // Phase 4: Cursor lifecycle
  diagnostics.push(...validateCursorLifecycle(tokens, cursors));

  return diagnostics;
}

// ─── Phase 2: Variable Validation ────────────────────────────────────────────

const MESSAGE_TYPE_KEYWORDS = new Set(['retorna', 'erro', 'alerta']);
const FILE_MODE_KEYWORDS = new Set(['gravarnl', 'lernl']);
const ITERATOR_OPS = new Set(['i', 'p', 'primeiro', 'proximo', 'libera']);

export function validateVariables(tokens, variables, functions) {
  const diagnostics = [];
  const reservedSet = new Set(RESERVED_WORD_NAMES);
  const builtinFnSet = new Set(BUILTIN_FUNCTION_NAMES.map(n => n.toLowerCase()));
  const systemVarSet = new Set(SYSTEM_VARIABLE_NAMES);
  const funcNameSet = new Set([...functions].map(f => f.toLowerCase()));

  // Track duplicate declarations — variables Map stores last declaration;
  // we need to scan tokens for all Definir statements to find duplicates.
  const declCounts = new Map();
  for (let i = 0; i < tokens.length - 2; i++) {
    const t = tokens[i];
    if (t.type === TokenType.Keyword && t.value.toLowerCase() === 'definir') {
      const typeToken = tokens[i + 1];
      const nameToken = tokens[i + 2];
      if (typeToken && nameToken) {
        const typeLower = typeToken.value.toLowerCase();
        if (['numero', 'alfa', 'data', 'cursor'].includes(typeLower)) {
          const key = nameToken.value.toLowerCase();
          if (!declCounts.has(key)) {
            declCounts.set(key, []);
          }
          declCounts.get(key).push(nameToken);
        }
      }
    }
  }

  // Emit warnings for duplicate declarations
  for (const [name, occurrences] of declCounts) {
    if (occurrences.length > 1) {
      for (let k = 1; k < occurrences.length; k++) {
        const tok = occurrences[k];
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: createRange(tok.line, tok.startChar, tok.line, tok.endChar),
          message: `Variável '${tok.value}' declarada mais de uma vez (Duplicate variable declaration '${tok.value}')`,
          source: 'senior-lsp',
        });
      }
    }
  }

  // Check undeclared identifiers
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== TokenType.Identifier) continue;

    const name = t.value;
    const nameLower = name.toLowerCase();

    // Skip if it's a declared variable
    if (variables.has(name)) continue;
    // Case-insensitive check for variables
    let foundVar = false;
    for (const [vName] of variables) {
      if (vName.toLowerCase() === nameLower) { foundVar = true; break; }
    }
    if (foundVar) continue;

    // Skip known system variables
    if (systemVarSet.has(nameLower)) continue;
    if (isSystemVariableByPrefix(name)) continue;

    // Skip table references
    if (TABLE_REF_PATTERN.test(name)) continue;

    // Skip reserved words
    if (reservedSet.includes ? reservedSet.has(nameLower) : reservedSet.has(nameLower)) continue;

    // Skip builtin function names
    if (builtinFnSet.has(nameLower)) continue;

    // Skip declared function names
    if (funcNameSet.has(nameLower)) continue;

    // Skip cursor method names
    if (CURSOR_METHOD_PATTERN.test(name)) continue;

    // Skip if after a dot (member access — cursor field or table field)
    if (i > 0 && tokens[i - 1].type === TokenType.Punctuation && tokens[i - 1].value === '.') continue;

    // Skip if part of a Definir statement (the type keyword or name being declared)
    if (i >= 1) {
      const prev = tokens[i - 1];
      if (prev.type === TokenType.Keyword && prev.value.toLowerCase() === 'definir') continue;
      if (i >= 2) {
        const prevPrev = tokens[i - 2];
        if (prevPrev.type === TokenType.Keyword && prevPrev.value.toLowerCase() === 'definir') continue;
      }
    }

    // Skip message type keywords
    if (MESSAGE_TYPE_KEYWORDS.has(nameLower)) continue;

    // Skip file mode keywords
    if (FILE_MODE_KEYWORDS.has(nameLower)) continue;

    // Skip iterator ops
    if (ITERATOR_OPS.has(nameLower)) continue;

    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: createRange(t.line, t.startChar, t.line, t.endChar),
      message: `Variável '${name}' não declarada (Undeclared variable '${name}')`,
      source: 'senior-lsp',
    });
  }

  return diagnostics;
}

// ─── Phase 3: Function Arity Validation ──────────────────────────────────────

const CURSOR_METHOD_NAMES = new Set(['abrircursor', 'fecharcursor', 'proximo']);

export function validateFunctionCalls(tokens, functions) {
  const diagnostics = [];
  const funcNameSet = new Set([...functions].map(f => f.toLowerCase()));

  for (let i = 0; i < tokens.length - 1; i++) {
    const t = tokens[i];
    if (t.type !== TokenType.Identifier && t.type !== TokenType.BuiltinFunction) continue;

    // Check that next non-whitespace token is '('
    const next = tokens[i + 1];
    if (!next || next.type !== TokenType.Punctuation || next.value !== '(') continue;

    const fnName = t.value;
    const fnNameLower = fnName.toLowerCase();

    // Count arguments: find matching ')' at depth 0
    let depth = 0;
    let argCount = 0;
    let hasContent = false;
    let j = i + 1; // points to '('

    for (j = i + 1; j < tokens.length; j++) {
      const tok = tokens[j];
      if (tok.type === TokenType.Punctuation && tok.value === '(') {
        depth++;
      } else if (tok.type === TokenType.Punctuation && tok.value === ')') {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1 && tok.type === TokenType.Punctuation && tok.value === ',') {
        argCount++;
      } else if (depth === 1 && tok.type !== TokenType.Whitespace) {
        hasContent = true;
      }
    }

    // If we found content, argCount = commas + 1; empty parens = 0 args
    if (hasContent) {
      argCount = argCount + 1;
    } else {
      argCount = 0;
    }

    // Check arity
    if (BUILTIN_ARITY.has(fnNameLower)) {
      const { min, max } = BUILTIN_ARITY.get(fnNameLower);
      if (argCount < min || argCount > max) {
        const expected = min === max ? `${min}` : `${min}-${max}`;
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: createRange(t.line, t.startChar, t.line, t.endChar),
          message: `Função '${fnName}': esperados ${expected} argumento(s), recebidos ${argCount} (Function '${fnName}': expected ${expected} args, got ${argCount})`,
          source: 'senior-lsp',
        });
      }
    } else if (funcNameSet.has(fnNameLower)) {
      // User-defined function — skip (no signature info)
    } else if (CURSOR_METHOD_NAMES.has(fnNameLower)) {
      // Cursor method — skip
    } else {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: createRange(t.line, t.startChar, t.line, t.endChar),
        message: `Função '${fnName}' desconhecida (Unknown function '${fnName}')`,
        source: 'senior-lsp',
      });
    }
  }

  return diagnostics;
}

// ─── Phase 4: Cursor Lifecycle Validation ────────────────────────────────────

const CURSOR_STATES = Object.freeze({
  DECLARED: 'DECLARED',
  SQL_SET: 'SQL_SET',
  OPENED: 'OPENED',
  CLOSED: 'CLOSED',
});

export function validateCursorLifecycle(tokens, cursors) {
  const diagnostics = [];
  // State machine per cursor
  const state = new Map();
  for (const c of cursors) {
    state.set(c.toLowerCase(), { name: c, state: CURSOR_STATES.DECLARED });
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // Look for cursor.Method patterns: Identifier(cursor) . CursorMethod
    if (t.type !== TokenType.Identifier && t.type !== TokenType.TableReference) continue;

    const cursorKey = t.value.toLowerCase();
    if (!state.has(cursorKey)) continue;

    // Check for dot + cursor method after this identifier
    if (i + 2 >= tokens.length) continue;
    const dot = tokens[i + 1];
    if (!dot || dot.type !== TokenType.Punctuation || dot.value !== '.') continue;
    const method = tokens[i + 2];
    if (!method || method.type !== TokenType.CursorMethod) continue;

    const methodLower = method.value.toLowerCase();
    const cursorState = state.get(cursorKey);

    if (methodLower === 'sql') {
      cursorState.state = CURSOR_STATES.SQL_SET;
    } else if (methodLower === 'abrircursor') {
      if (cursorState.state !== CURSOR_STATES.SQL_SET) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: createRange(method.line, method.startChar, method.line, method.endChar),
          message: `Cursor '${cursorState.name}' aberto sem SQL definida (Cursor '${cursorState.name}' opened without SQL set)`,
          source: 'senior-lsp',
        });
      }
      cursorState.state = CURSOR_STATES.OPENED;
    } else if (methodLower === 'fecharcursor') {
      if (cursorState.state !== CURSOR_STATES.OPENED) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: createRange(method.line, method.startChar, method.line, method.endChar),
          message: `Cursor '${cursorState.name}' fechado sem estar aberto (Cursor '${cursorState.name}' closed without being open)`,
          source: 'senior-lsp',
        });
      }
      cursorState.state = CURSOR_STATES.CLOSED;
    } else if (methodLower === 'achou' || methodLower === 'naoachou') {
      if (cursorState.state !== CURSOR_STATES.OPENED) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: createRange(method.line, method.startChar, method.line, method.endChar),
          message: `Cursor '${cursorState.name}' testado sem estar aberto (Cursor '${cursorState.name}' tested without being open)`,
          source: 'senior-lsp',
        });
      }
    } else if (methodLower === 'proximo') {
      if (cursorState.state !== CURSOR_STATES.OPENED) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: createRange(method.line, method.startChar, method.line, method.endChar),
          message: `Cursor '${cursorState.name}': Proximo() sem cursor aberto (Cursor '${cursorState.name}': Proximo() without open cursor)`,
          source: 'senior-lsp',
        });
      }
    }
  }

  // Warn about cursors left open at end
  for (const [, cursorState] of state) {
    if (cursorState.state === CURSOR_STATES.OPENED) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: createRange(0, 0, 0, 0),
        message: `Cursor '${cursorState.name}' não foi fechado (Cursor '${cursorState.name}' was never closed)`,
        source: 'senior-lsp',
      });
    }
  }

  // Check Enquanto loops with cursor.Achou for missing Proximo()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== TokenType.Keyword || t.value.toLowerCase() !== 'enquanto') continue;

    // Look for cursor.Achou pattern after Enquanto
    // Scan ahead for the condition pattern: cursor.Achou
    let cursorNameInLoop = null;
    for (let j = i + 1; j < tokens.length && j < i + 10; j++) {
      if (tokens[j].type === TokenType.CursorMethod && tokens[j].value.toLowerCase() === 'achou') {
        // The cursor name is 2 tokens back (before the dot)
        if (j >= 2 && tokens[j - 1].value === '.') {
          const cKey = tokens[j - 2].value.toLowerCase();
          if (state.has(cKey)) {
            cursorNameInLoop = tokens[j - 2].value;
          }
        }
        break;
      }
      // Stop scanning if we hit a line break keyword
      if (tokens[j].type === TokenType.Keyword &&
          ['inicio', 'fim', 'se', 'senao'].includes(tokens[j].value.toLowerCase())) break;
    }

    if (!cursorNameInLoop) continue;

    // Scan the loop body for Proximo() on the same cursor
    // Find the Inicio..Fim block
    let loopStart = -1;
    let depth = 0;
    let loopEnd = -1;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].type === TokenType.Keyword && tokens[j].value.toLowerCase() === 'inicio') {
        if (depth === 0) loopStart = j;
        depth++;
      } else if (tokens[j].type === TokenType.Keyword && tokens[j].value.toLowerCase() === 'fim') {
        depth--;
        if (depth === 0) { loopEnd = j; break; }
      }
    }

    if (loopStart === -1 || loopEnd === -1) continue;

    // Search for cursor.Proximo() within the loop body
    let foundProximo = false;
    for (let j = loopStart; j <= loopEnd; j++) {
      if (tokens[j].type === TokenType.CursorMethod && tokens[j].value.toLowerCase() === 'proximo') {
        // Check that it's for the same cursor
        if (j >= 2 && tokens[j - 1].value === '.' && tokens[j - 2].value.toLowerCase() === cursorNameInLoop.toLowerCase()) {
          foundProximo = true;
          break;
        }
      }
    }

    if (!foundProximo) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: createRange(t.line, t.startChar, t.line, t.endChar),
        message: `Loop Enquanto com '${cursorNameInLoop}.Achou' sem '${cursorNameInLoop}.Proximo()' — possível loop infinito (While loop with '${cursorNameInLoop}.Achou' without '${cursorNameInLoop}.Proximo()' — possible infinite loop)`,
        source: 'senior-lsp',
      });
    }
  }

  return diagnostics;
}
