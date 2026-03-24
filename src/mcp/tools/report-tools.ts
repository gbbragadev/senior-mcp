import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, existsSync, readdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = resolve(__dirname, '../../../data/reports');

function loadJson(relativePath: string): any {
  const fullPath = resolve(DATA_DIR, relativePath);
  if (!existsSync(fullPath)) return null;
  return JSON.parse(readFileSync(fullPath, 'utf-8'));
}

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function asText(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}
function asError(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}

export function registerReportTools(server: McpServer) {

  server.tool(
    'report_catalog',
    'List available Senior HCM report models from the curated catalog (top 20 reports with SOAP params and DB tables).',
    {
      search: z.string().optional().describe('Filter by keyword in name/description'),
      module: z.string().optional().describe('Filter by SOAP module (rubi, bs, rs, cs, sm, tr, sapiens)'),
    },
    async ({ search, module }: { search?: string; module?: string }) => {
      const data = loadJson('009-top-reports.json');
      if (!data?.reports) return asError('Report catalog not found at data/reports/009-top-reports.json');

      let reports = data.reports as any[];
      if (module) {
        const m = module.toLowerCase();
        reports = reports.filter((r: any) => r.soap_module?.toLowerCase() === m);
      }
      if (search) {
        const s = search.toLowerCase();
        reports = reports.filter((r: any) => JSON.stringify(r).toLowerCase().includes(s));
      }
      return asJson({
        count: reports.length,
        reports: reports.map((r: any) => ({
          rank: r.rank, id: r.id, name: r.name, model: r.model_code,
          module: r.soap_module, category: r.category, tables: r.db_tables,
        })),
      });
    }
  );

  server.tool(
    'report_sql_templates',
    'List and render SQL report templates. Without params lists all. With template_id shows definition. With template_id + params renders the SQL.',
    {
      template_id: z.string().optional().describe('Template ID (e.g., employee_roster, payroll_summary)'),
      params: z.record(z.string()).optional().describe('Key-value params to substitute in the SQL'),
    },
    async ({ template_id, params }: { template_id?: string; params?: Record<string, string> }) => {
      const data = loadJson('sql-templates.json');
      if (!data) return asError('SQL templates not found at data/reports/sql-templates.json');

      const templates = Array.isArray(data) ? data : data.templates || Object.values(data);

      if (!template_id) {
        return asJson(templates.map((t: any) => ({
          id: t.id || t.name, description: t.description || t.name, params: t.params || t.parameters || [],
        })));
      }

      const tmpl = templates.find((t: any) =>
        (t.id || t.name || '').toLowerCase() === template_id.toLowerCase()
      );
      if (!tmpl) {
        return asError(`Template "${template_id}" not found. Available: ${templates.map((t: any) => t.id || t.name).join(', ')}`);
      }
      if (!params) return asJson(tmpl);

      let sql = tmpl.sql || tmpl.query || '';
      for (const [k, v] of Object.entries(params)) {
        sql = sql.replace(new RegExp(`\\$\\(${k}\\)`, 'gi'), v);
      }
      return asJson({ template_id, rendered_sql: sql, params });
    }
  );

  server.tool(
    'report_soap_templates',
    'List SOAP envelope templates for Senior HCM report execution.',
    {
      module: z.string().optional().describe('Filter by module code (rubi, bs, rs, cs, sm, tr, sapiens, jr, plr, ql)'),
    },
    async ({ module }: { module?: string }) => {
      const data = loadJson('soap-templates.json');
      if (!data) return asError('SOAP templates not found at data/reports/soap-templates.json');

      const templates = Array.isArray(data) ? data : Object.entries(data).map(([k, v]) => ({ module: k, ...(v as any) }));
      if (module) {
        const m = module.toLowerCase();
        const filtered = templates.filter((t: any) => (t.module || t.code || '').toLowerCase() === m);
        return filtered.length > 0 ? asJson(filtered) : asError(`Module "${module}" not found`);
      }
      return asJson(templates);
    }
  );

  server.tool(
    'report_corpus_list',
    'List the 20 curated report model examples (JSON) used for LLM-based report generation.',
    {
      search: z.string().optional().describe('Filter by keyword'),
      category: z.string().optional().describe('Category: simple-list, break-report, total-report, complex-rules, multi-detail, drawings, system-vars, memo-image'),
    },
    async ({ search, category }: { search?: string; category?: string }) => {
      const corpusDir = resolve(DATA_DIR, 'corpus');
      if (!existsSync(corpusDir)) return asError('Report corpus not found at data/reports/corpus/');

      let files = readdirSync(corpusDir).filter(f => f.endsWith('.json')).sort();
      if (category) files = files.filter(f => f.toLowerCase().includes(category.toLowerCase()));
      if (search) {
        const s = search.toLowerCase();
        files = files.filter(f => {
          const content = readFileSync(resolve(corpusDir, f), 'utf-8');
          return f.toLowerCase().includes(s) || content.toLowerCase().includes(s);
        });
      }

      const results = files.map(f => {
        const parts = f.replace('.json', '').split('_');
        const num = parts[0];
        const cat = num.includes('-') ? num.split('-').slice(1).join('-') : '';
        const model = parts.slice(1).join('_');
        return { filename: f, category: cat, model_code: model };
      });
      return asJson({ count: results.length, examples: results });
    }
  );

  server.tool(
    'report_corpus_get',
    'Return a specific report model example from the corpus (full JSON).',
    {
      name: z.string().describe('Filename (e.g., "01-simple-list_PLPR003.json")'),
    },
    async ({ name }: { name: string }) => {
      if (name.includes('..') || name.includes('/') || name.includes('\\')) return asError('Invalid filename');
      const filePath = resolve(DATA_DIR, 'corpus', name);
      if (!existsSync(filePath)) return asError(`Corpus file not found: ${name}`);
      return asJson(JSON.parse(readFileSync(filePath, 'utf-8')));
    }
  );

  server.tool(
    'report_generate_prompt',
    'Generate an LLM system prompt for creating a Senior HCM report model. Includes schema KB and corpus examples.',
    {
      description: z.string().describe('Natural language description of the desired report'),
      include_examples: z.boolean().default(true).describe('Include corpus examples'),
      max_examples: z.number().int().min(1).max(5).default(3).describe('Max examples to include'),
    },
    async ({ description, include_examples, max_examples }: {
      description: string; include_examples: boolean; max_examples: number;
    }) => {
      const schemaKb = loadJson('senior-schema-kb.json');

      let prompt = 'You are an expert Senior HCM report model generator. Generate a valid JSON report model for the Senior G5 HCM system.\n\n';
      prompt += `## User Request\n${description}\n\n`;

      if (schemaKb) {
        const schemaStr = JSON.stringify(schemaKb).substring(0, 8000);
        prompt += `## Schema Knowledge Base (excerpt)\n\`\`\`json\n${schemaStr}\n\`\`\`\n\n`;
      }

      if (include_examples) {
        const corpusDir = resolve(DATA_DIR, 'corpus');
        if (existsSync(corpusDir)) {
          const files = readdirSync(corpusDir).filter(f => f.endsWith('.json')).sort();
          const keywords = description.toLowerCase().split(/\s+/);
          const scored = files.map(f => {
            const content = readFileSync(resolve(corpusDir, f), 'utf-8');
            const score = keywords.filter(k => f.toLowerCase().includes(k) || content.toLowerCase().includes(k)).length;
            return { f, content, score };
          }).sort((a, b) => b.score - a.score);

          const selected = scored.slice(0, max_examples);
          if (selected.length > 0) {
            prompt += '## Example Report Models\n\n';
            for (const { f, content } of selected) {
              const short = content.length > 3000 ? content.substring(0, 3000) + '...(truncated)' : content;
              prompt += `### ${f}\n\`\`\`json\n${short}\n\`\`\`\n\n`;
            }
          }
        }
      }

      prompt += '## Output Format\nReturn ONLY a valid JSON object representing the Senior report model. Follow the exact structure shown in the examples above.\n';
      return asText(prompt);
    }
  );
}
