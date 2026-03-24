import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DocsIndexerService } from '../services/docs-indexer';
import { KnowledgeSearchService } from '../services/knowledge-search';
import { LspIndexerService } from '../services/lsp-indexer';
import { KnowledgeSearchFilters } from '../types';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function asError(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: true,
  };
}

function asJson(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function parsePathList(value?: string): string[] {
  return String(value || '')
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function registerKnowledgeTools(server: McpServer) {
  const searchService = new KnowledgeSearchService();
  const lspIndexer = new LspIndexerService();

  server.tool(
    'senior_search',
    {
      query: z.string().min(2).describe('Natural language query'),
      domain: z.enum(['docs', 'lsp']).default('docs').describe('Knowledge domain'),
      context: z.string().optional().describe('Optional docs context (erp/hcm/crm etc)'),
      product: z.string().optional().describe('Optional product slug'),
      version: z.string().optional().describe('Optional version'),
      module: z.string().optional().describe('Optional module'),
      routine_name: z.string().optional().describe('Optional routine name (LSP)'),
      top_k: z.number().int().min(1).max(30).optional().describe('Result limit'),
    },
    async ({
      query,
      domain,
      context,
      product,
      version,
      module,
      routine_name,
      top_k,
    }: {
      query: string;
      domain: 'docs' | 'lsp';
      context?: string;
      product?: string;
      version?: string;
      module?: string;
      routine_name?: string;
      top_k?: number;
    }) => {
      try {
        const filters: KnowledgeSearchFilters = {
          domain,
          context,
          product,
          version,
          module,
          routineName: routine_name,
        };

        const results = await searchService.search(query, filters, top_k);
        return asJson({
          query,
          domain,
          count: results.length,
          results,
        });
      } catch (error) {
        return asError(`senior_search failed: ${getErrorMessage(error)}`);
      }
    }
  );

  server.tool(
    'senior_get_chunk',
    {
      chunk_id: z.string().describe('Chunk ID returned by knowledge_search'),
    },
    async ({ chunk_id }: { chunk_id: string }) => {
      try {
        const chunk = await searchService.getChunk(chunk_id);
        if (!chunk) {
          return asError(`Chunk not found: ${chunk_id}`);
        }
        return asJson(chunk);
      } catch (error) {
        return asError(`senior_get_chunk failed: ${getErrorMessage(error)}`);
      }
    }
  );

  server.tool(
    'senior_catalog',
    {
      domain: z.enum(['docs', 'lsp', 'all']).default('all').describe('Catalog scope'),
    },
    async ({ domain }: { domain: 'docs' | 'lsp' | 'all' }) => {
      try {
        const rows = await searchService.listCatalog(domain);
        return asJson({
          domain,
          count: rows.length,
          rows,
        });
      } catch (error) {
        return asError(`senior_catalog failed: ${getErrorMessage(error)}`);
      }
    }
  );

  server.tool('senior_stats', {}, async () => {
    try {
      const stats = await searchService.stats();
      return asJson(stats);
    } catch (error) {
      return asError(`senior_stats failed: ${getErrorMessage(error)}`);
    }
  });

  server.tool(
    'senior_reindex',
    {
      domain: z
        .enum(['docs', 'lsp', 'all'])
        .default('all')
        .describe('Reindex only docs, only lsp, or both'),
      full_rebuild: z
        .boolean()
        .default(false)
        .describe('When true, delete stale chunks that are no longer in source'),
      docs_chunks_file: z
        .string()
        .optional()
        .describe('Optional docs chunks JSONL path (or comma-separated list) for this run'),
    },
    async ({
      domain,
      full_rebuild,
      docs_chunks_file,
    }: {
      domain: 'docs' | 'lsp' | 'all';
      full_rebuild: boolean;
      docs_chunks_file?: string;
    }) => {
      const runs: unknown[] = [];
      const errors: Array<{ domain: 'docs' | 'lsp'; error: string }> = [];
      const docsChunksFiles = parsePathList(docs_chunks_file);

      if (domain === 'docs' || domain === 'all') {
        try {
          const docsIndexer = new DocsIndexerService(undefined, undefined, {
            docsChunksFiles,
          });
          runs.push(await docsIndexer.reindex(full_rebuild));
        } catch (error) {
          errors.push({ domain: 'docs', error: getErrorMessage(error) });
        }
      }

      if (domain === 'lsp' || domain === 'all') {
        try {
          runs.push(await lspIndexer.reindex(full_rebuild));
        } catch (error) {
          errors.push({ domain: 'lsp', error: getErrorMessage(error) });
        }
      }

      if (errors.length > 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  domain,
                  full_rebuild,
                  docs_chunks_files: docsChunksFiles,
                  runs,
                  errors,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      return asJson({
        domain,
        full_rebuild,
        docs_chunks_files: docsChunksFiles,
        runs,
      });
    }
  );
}
