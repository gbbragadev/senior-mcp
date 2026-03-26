import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.MCP_HTTP_PORT ?? '3100', 10);
const BEARER_TOKEN = process.env.MCP_HTTP_TOKEN ?? '';

function asBooleanEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/**
 * Creates a fresh McpServer with tools registered.
 * Called once per HTTP request in stateless mode.
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'Senior MCP Server',
    version: '1.2.0',
  });

  const enableKnowledgeTools = asBooleanEnv('MCP_ENABLE_KNOWLEDGE_TOOLS', true);

  if (enableKnowledgeTools) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { registerKnowledgeTools } =
      require('./mcp/tools/knowledge-tools') as typeof import('./mcp/tools/knowledge-tools');
    registerKnowledgeTools(server);
  }

  if (!enableKnowledgeTools) {
    throw new Error(
      'No MCP tools enabled. Set MCP_ENABLE_KNOWLEDGE_TOOLS=true.',
    );
  }

  return server;
}

async function main(): Promise<void> {
  if (!BEARER_TOKEN) {
    console.error('[MCP HTTP] FATAL: MCP_HTTP_TOKEN env var is not set.');
    console.error('[MCP HTTP] Add MCP_HTTP_TOKEN=<strong-secret> to your .env file.');
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  // Health check — no auth required
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'senior-mcp-http', version: '1.2.0' });
  });

  // ── Block OAuth discovery ──────────────────────────────────────────
  // Claude Code (and MCP SDK clients) try OAuth when they get 401.
  // Returning clean 404 on these endpoints tells the client "no OAuth
  // here — use the Bearer token from your config".
  app.all('/.well-known/oauth-authorization-server', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'OAuth not supported. Use Bearer token.' });
  });
  app.all('/.well-known/oauth-protected-resource', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'OAuth not supported. Use Bearer token.' });
  });
  app.all('/register', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'OAuth not supported. Use Bearer token.' });
  });
  app.all('/authorize', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'OAuth not supported. Use Bearer token.' });
  });
  app.all('/token', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'OAuth not supported. Use Bearer token.' });
  });

  // Bearer token middleware for /mcp
  const requireToken = (req: Request, res: Response, next: NextFunction): void => {
    const auth = req.headers['authorization'] ?? '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== BEARER_TOKEN) {
      res.status(401).json({ error: 'Unauthorized: valid Bearer token required' });
      return;
    }
    next();
  };

  /**
   * MCP Streamable HTTP endpoint — stateless mode.
   *
   * Each HTTP request gets its own McpServer + Transport instance.
   * This is correct for stateless knowledge tools: initialize, tools/list,
   * and tools/call are independent requests that share no in-memory state.
   *
   * Compatible with: Claude Code (--transport http), Codex, and any MCP
   * client that supports the 2024-11-05 Streamable HTTP transport spec.
   */
  app.all('/mcp', requireToken, async (req: Request, res: Response): Promise<void> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless: no session tracking
    });
    const mcpServer = createMcpServer();

    // Cleanup after response is sent
    res.on('finish', () => {
      mcpServer.close().catch(() => {});
    });

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[MCP HTTP] Server listening on port ${PORT}`);
    console.log(`[MCP HTTP] MCP endpoint  → http://0.0.0.0:${PORT}/mcp`);
    console.log(`[MCP HTTP] Health check  → http://0.0.0.0:${PORT}/health`);
    console.log(`[MCP HTTP] Public URL    → https://seniormcp.gbbragadev.com/mcp`);
  });
}

main().catch((err) => {
  console.error('[MCP HTTP] Fatal startup error:', err);
  process.exit(1);
});
