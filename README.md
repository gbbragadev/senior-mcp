# senior-mcp

MCP HTTP server for **Senior HCM documentation semantic search** via embeddings in PostgreSQL with pgvector.

Public endpoint: `https://seniormcp.gbbragadev.com/mcp`

## What it does

Exposes Senior HCM documentation and LSP source code as searchable knowledge via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Uses hybrid search (vector + full-text) over PostgreSQL with pgvector for high-quality semantic retrieval.

## MCP Tools

| Tool | Description |
|------|-------------|
| `senior_search` | Semantic search across Senior docs and LSP sources |
| `senior_get_chunk` | Retrieve a specific chunk by ID |
| `senior_catalog` | List all indexed sources by domain/context/product |
| `senior_stats` | Knowledge base statistics + embedding config |
| `senior_reindex` | Trigger reindexing (docs, LSP, or both) |

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** with [pgvector](https://github.com/pgvector/pgvector) extension
- **Voyage AI API key** (for embeddings) — get one at [voyageai.com](https://www.voyageai.com/)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/gbbragadev/senior-mcp.git
cd senior-mcp
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your database credentials and API keys
```

Required variables:

- `MCP_HTTP_TOKEN` — Bearer token for authentication (generate with `openssl rand -hex 32`)
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — PostgreSQL connection
- `VOYAGE_API_KEY` — Voyage AI API key for embeddings

### 3. Prepare the database

Ensure pgvector is installed and the `knowledge_chunks` table exists:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 4. Build and run

```bash
npm run build
npm start
```

The server starts on port 3100 (configurable via `MCP_HTTP_PORT`).

### 5. Verify

```bash
curl http://localhost:3100/health
# {"status":"ok","service":"senior-mcp-http","version":"1.2.0"}
```

## Connect from Claude Code

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer YOUR_TOKEN" \
  senior-knowledge \
  https://seniormcp.gbbragadev.com/mcp
```

Or add to `~/.claude/claude.json`:

```json
{
  "mcpServers": {
    "senior-knowledge": {
      "type": "http",
      "url": "https://seniormcp.gbbragadev.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

## Connect from Codex

```bash
codex mcp add senior-knowledge \
  --transport streamable-http \
  --url https://seniormcp.gbbragadev.com/mcp \
  --header "Authorization: Bearer YOUR_TOKEN"
```

## Indexing

### Index documentation chunks

```bash
npm run knowledge:reindex:docs
```

### Index LSP source files

Set `SENIOR_LSP_ROOT` in `.env`, then:

```bash
npm run knowledge:reindex:lsp
```

### Full rebuild (removes stale chunks)

```bash
npm run knowledge:reindex:full
```

## Evaluation

Run the retrieval quality benchmark:

```bash
npm run knowledge:eval
```

See `docs/senior-knowledge-mcp.md` for detailed configuration options.

## Architecture

```
Client (Claude Code / Codex / any MCP client)
    |
    | HTTPS POST /mcp  (Bearer token)
    v
senior-mcp (Express + MCP SDK StreamableHTTP)
    |
    | Hybrid search (vector + text)
    v
PostgreSQL + pgvector
    |
    | Voyage AI embeddings
    v
voyageai.com API
```

## License

MIT
