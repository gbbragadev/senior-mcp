import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

// ESM compiler modules live in src/compiler/ (not compiled by tsc).
// We import them via file:// URLs so Node treats them as ESM.
const COMPILER_DIR = resolve(__dirname, '../../../src/compiler');

function compilerModule(name: string) {
  return pathToFileURL(resolve(COMPILER_DIR, name)).href;
}

let _knowledge: any;
let _diagnostics: any;
let _examples: any;
let _templates: any;
let _encoder: any;

async function getKnowledge() {
  if (!_knowledge) _knowledge = await import(compilerModule('lang-knowledge.js'));
  return _knowledge;
}
async function getDiagnostics() {
  if (!_diagnostics) _diagnostics = await import(compilerModule('lang-diagnostics.js'));
  return _diagnostics;
}
async function getExamples() {
  if (!_examples) _examples = await import(compilerModule('lang-examples.js'));
  return _examples;
}
async function getTemplates() {
  if (!_templates) _templates = await import(compilerModule('lang-templates.js'));
  return _templates;
}
async function getEncoder() {
  if (!_encoder) _encoder = await import(compilerModule('lang-encoder.js'));
  return _encoder;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function asText(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function asError(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

/* ------------------------------------------------------------------ */
/*  Registration                                                      */
/* ------------------------------------------------------------------ */

export function registerRuleTools(server: McpServer): void {
  /* ---- Tool 1: rule_reference ---- */
  server.tool(
    'rule_reference',
    'Return Senior rule language reference for a specific section. Sections: list, syntax, types, builtins, cursor_api, sql_api, system_vars, operators, web_api, patterns, modules.',
    { section: z.string() },
    async ({ section }) => {
      const { REFERENCE_SECTIONS } = await getKnowledge();
      if (section === 'list') {
        return asJson(Object.keys(REFERENCE_SECTIONS));
      }
      const text = (REFERENCE_SECTIONS as Record<string, string>)[section];
      if (!text) {
        return asError(
          `Unknown section "${section}". Available: ${Object.keys(REFERENCE_SECTIONS).join(', ')}`,
        );
      }
      return asText(text);
    },
  );

  /* ---- Tool 2: rule_validate ---- */
  server.tool(
    'rule_validate',
    'Validate Senior rule language source code. With strict=true, also checks undeclared variables, unknown functions, wrong function arity, cursor lifecycle.',
    {
      code: z.string(),
      strict: z.boolean().default(false),
    },
    async ({ code, strict }) => {
      try {
        const diag = await getDiagnostics();
        const diagnostics = diag.computeDiagnostics(code);
        const errors = diagnostics.filter(
          (d: any) => d.severity === diag.DiagnosticSeverity.Error,
        );
        const warnings = diagnostics.filter(
          (d: any) => d.severity === diag.DiagnosticSeverity.Warning,
        );

        let semanticErrors: any[] = [];
        let semanticWarnings: any[] = [];
        if (strict) {
          const semantic = diag.computeSemanticDiagnostics(code);
          semanticErrors = semantic.filter(
            (d: any) => d.severity === diag.DiagnosticSeverity.Error,
          );
          semanticWarnings = semantic.filter(
            (d: any) => d.severity === diag.DiagnosticSeverity.Warning,
          );
        }

        const allErrors = [...errors, ...semanticErrors];
        const allWarnings = [...warnings, ...semanticWarnings];

        // Analysis extraction
        const doc = diag.parseDocument(code);
        const analysis: Record<string, any> = {};
        try { analysis.tableRefs = diag.extractTableRefs(doc); } catch { /* skip */ }
        try { analysis.tableFieldRefs = diag.extractTableFieldRefs(doc); } catch { /* skip */ }
        try { analysis.sqlStatements = diag.extractSqlStatements(doc); } catch { /* skip */ }
        try { analysis.systemVars = diag.extractSystemVars(doc); } catch { /* skip */ }
        try { analysis.builtinCalls = diag.extractBuiltinCalls(doc); } catch { /* skip */ }

        return asJson({
          valid: allErrors.length === 0,
          errors: allErrors,
          warnings: allWarnings,
          analysis,
        });
      } catch (err: any) {
        return asError(`Validation failed: ${err.message ?? err}`);
      }
    },
  );

  /* ---- Tool 3: rule_examples ---- */
  server.tool(
    'rule_examples',
    'Search 20 decoded Senior rule example files by keyword, pattern, or module.',
    {
      search: z.string(),
      pattern: z.string().optional(),
      module: z.string().optional(),
    },
    async ({ search, pattern, module }) => {
      try {
        const ex = await getExamples();
        const results = ex.searchExamples(search, pattern, module);
        if (results && results.length > 0) {
          return asJson(results);
        }
        const all = ex.listExamples();
        return asJson({
          message: `No results for "${search}". Available examples:`,
          examples: all,
        });
      } catch (err: any) {
        return asError(`Example search failed: ${err.message ?? err}`);
      }
    },
  );

  /* ---- Tool 4: rule_templates ---- */
  server.tool(
    'rule_templates',
    'Generate scaffolding code for common Senior rule patterns. Use "list" to see templates.',
    {
      template: z.string(),
      table: z.string().optional(),
      fields: z.string().optional(),
    },
    async ({ template, table, fields }) => {
      try {
        const tmpl = await getTemplates();
        if (template === 'list') {
          return asJson(tmpl.listTemplates());
        }
        const opts: Record<string, any> = {};
        if (table) opts.table = table;
        if (fields) opts.fields = fields;
        const result = tmpl.generateTemplate(template, opts) as { code: string; description: string };
        return asText(result.code);
      } catch (err: any) {
        return asError(`Template generation failed: ${err.message ?? err}`);
      }
    },
  );

  /* ---- Tool 5: rule_context ---- */
  server.tool(
    'rule_context',
    'Describe available tables, system variables, and return semantics for a Senior rule module.',
    { module: z.string() },
    async ({ module: mod }) => {
      try {
        const { MODULE_CONTEXTS } = await getKnowledge();
        const contexts = MODULE_CONTEXTS as Record<string, any>;
        if (mod === 'list') {
          return asJson(Object.keys(contexts));
        }
        const ctx = contexts[mod] ?? contexts[mod.toLowerCase()];
        if (!ctx) {
          return asError(
            `Unknown module "${mod}". Use "list" to see available modules: ${Object.keys(contexts).join(', ')}`,
          );
        }
        return asJson(ctx);
      } catch (err: any) {
        return asError(`Context lookup failed: ${err.message ?? err}`);
      }
    },
  );

  /* ---- Tool 6: rule_encode ---- */
  server.tool(
    'rule_encode',
    'Encode Senior rule source code to .LSP binary format (best-effort, MD5 hash zeroed).',
    {
      code: z.string(),
      title: z.string().optional(),
    },
    async ({ code, title }) => {
      try {
        const diag = await getDiagnostics();
        const enc = await getEncoder();
        // Pre-validate
        const diagnostics = diag.computeDiagnostics(code);
        const errors = diagnostics.filter(
          (d: any) => d.severity === diag.DiagnosticSeverity.Error,
        );
        if (errors.length > 0) {
          return asJson({
            encoded: false,
            errors,
            message: 'Fix validation errors before encoding.',
          });
        }

        const warnings = diagnostics.filter(
          (d: any) => d.severity === diag.DiagnosticSeverity.Warning,
        );

        const result = enc.encodeLsp(code, title ?? 'RULE');
        const base64 = Buffer.from(result.buffer).toString('base64');

        return asJson({
          encoded: true,
          format: 'base64',
          data: base64,
          sizeBytes: result.buffer.length,
          warnings: [...warnings, ...result.warnings],
        });
      } catch (err: any) {
        return asError(`Encoding failed: ${err.message ?? err}`);
      }
    },
  );
}
