import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Dynamic imports for JS compiler modules (allowJs: true in tsconfig)
// @ts-ignore - JS modules without type declarations
import { REFERENCE_SECTIONS, BUILTIN_CATALOG, MODULE_CONTEXTS } from '../../compiler/lang-knowledge.js';
// @ts-ignore
import { computeDiagnostics, computeSemanticDiagnostics, parseDocument, extractTableRefs, extractTableFieldRefs, extractSqlStatements, extractSystemVars, extractBuiltinCalls, DiagnosticSeverity } from '../../compiler/lang-diagnostics.js';
// @ts-ignore
import { searchExamples, listExamples, getExample } from '../../compiler/lang-examples.js';
// @ts-ignore
import { generateTemplate, listTemplates } from '../../compiler/lang-templates.js';
// @ts-ignore
import { encodeLsp } from '../../compiler/lang-encoder.js';

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
      if (section === 'list') {
        return asJson(Object.keys(REFERENCE_SECTIONS));
      }
      const text = REFERENCE_SECTIONS[section];
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
        const diagnostics = computeDiagnostics(code);
        const errors = diagnostics.filter(
          (d: any) => d.severity === DiagnosticSeverity.Error,
        );
        const warnings = diagnostics.filter(
          (d: any) => d.severity === DiagnosticSeverity.Warning,
        );

        let semanticErrors: any[] = [];
        let semanticWarnings: any[] = [];
        if (strict) {
          const semantic = computeSemanticDiagnostics(code);
          semanticErrors = semantic.filter(
            (d: any) => d.severity === DiagnosticSeverity.Error,
          );
          semanticWarnings = semantic.filter(
            (d: any) => d.severity === DiagnosticSeverity.Warning,
          );
        }

        const allErrors = [...errors, ...semanticErrors];
        const allWarnings = [...warnings, ...semanticWarnings];

        // Analysis extraction
        const doc = parseDocument(code);
        const analysis: Record<string, any> = {};
        try { analysis.tableRefs = extractTableRefs(doc); } catch { /* skip */ }
        try { analysis.tableFieldRefs = extractTableFieldRefs(doc); } catch { /* skip */ }
        try { analysis.sqlStatements = extractSqlStatements(doc); } catch { /* skip */ }
        try { analysis.systemVars = extractSystemVars(doc); } catch { /* skip */ }
        try { analysis.builtinCalls = extractBuiltinCalls(doc); } catch { /* skip */ }

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
        const results = searchExamples(search, { pattern, module });
        if (results && results.length > 0) {
          return asJson(results);
        }
        // Fallback: list all available examples
        const all = listExamples();
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
        if (template === 'list') {
          return asJson(listTemplates());
        }
        const opts: Record<string, any> = {};
        if (table) opts.table = table;
        if (fields) opts.fields = fields;
        const code = generateTemplate(template, opts);
        return asText(code);
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
        if (mod === 'list') {
          return asJson(Object.keys(MODULE_CONTEXTS));
        }
        const ctx = MODULE_CONTEXTS[mod] ?? MODULE_CONTEXTS[mod.toLowerCase()];
        if (!ctx) {
          return asError(
            `Unknown module "${mod}". Use "list" to see available modules: ${Object.keys(MODULE_CONTEXTS).join(', ')}`,
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
        // Pre-validate
        const diagnostics = computeDiagnostics(code);
        const errors = diagnostics.filter(
          (d: any) => d.severity === DiagnosticSeverity.Error,
        );
        if (errors.length > 0) {
          return asJson({
            encoded: false,
            errors,
            message: 'Fix validation errors before encoding.',
          });
        }

        const warnings = diagnostics.filter(
          (d: any) => d.severity === DiagnosticSeverity.Warning,
        );

        const buffer = encodeLsp(code, { title: title ?? 'RULE' });
        const base64 = Buffer.from(buffer).toString('base64');

        return asJson({
          encoded: true,
          format: 'base64',
          data: base64,
          sizeBytes: buffer.length,
          warnings,
        });
      } catch (err: any) {
        return asError(`Encoding failed: ${err.message ?? err}`);
      }
    },
  );
}
