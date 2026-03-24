# Senior Knowledge MCP (Docs + LSP)

Full MCP knowledge flow for Senior docs and LSP sources:

1. Scrape docs to chunks (`chunks.jsonl`).
2. Index docs/LSP chunks into PostgreSQL with pgvector.
3. Query via MCP tools (`senior_*`) from Claude Code, Codex, or any MCP client.

## 1) Database setup

Create `knowledge_chunks` table and indexes. PostgreSQL needs `pgvector` extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 2) Environment

Required DB variables: `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME`.

Knowledge settings:

- `SENIOR_DOCS_CHUNKS_FILE` optional single fallback file.
- `SENIOR_DOCS_CHUNKS_FILES` optional multi-source list (comma-separated).
- `SENIOR_LSP_ROOT` required for LSP indexing.
- `SENIOR_LSP_EXTRA_PATHS` optional extra folders/files.
- `SENIOR_LSP_EXTENSIONS` optional, default `.lsp,.prg,.src,.txt,.sql,.xml`.
- `SENIOR_LSP_IGNORE_TERMS` optional line-level ignore terms.
- `SENIOR_LSP_IGNORE_PATH_PATTERNS` optional path-level ignore patterns.
- `SENIOR_LSP_TAG_RULES_JSON` optional JSON tag rules by path match.

Embeddings:

- `VOYAGE_API_KEY` required for production semantic quality.
- `EMBEDDING_MODEL` optional (`voyage-4` default).
- `EMBEDDING_FALLBACK_MODELS` optional (`voyage-4-large,voyage-4-lite` suggested).
- `EMBEDDING_DIM` optional (`1024` default).

Search tuning:

- `KNOWLEDGE_CANDIDATE_POOL_VECTOR` optional (`80` default).
- `KNOWLEDGE_CANDIDATE_POOL_TEXT` optional (`80` default).
- `KNOWLEDGE_VECTOR_WEIGHT_DOCS` optional (`0.75` default).
- `KNOWLEDGE_TEXT_WEIGHT_DOCS` optional (`0.25` default).
- `KNOWLEDGE_VECTOR_WEIGHT_LSP` optional (`0.65` default).
- `KNOWLEDGE_TEXT_WEIGHT_LSP` optional (`0.35` default).

## 3) Reindex workflow

```bash
npm run knowledge:reindex           # incremental, all domains
npm run knowledge:reindex:full      # full rebuild
npm run knowledge:reindex:docs      # only docs
npm run knowledge:reindex:lsp       # only LSP
```

## 4) MCP tools available

- `senior_search` — Semantic search across docs and LSP
- `senior_get_chunk` — Get a specific chunk by ID
- `senior_catalog` — List indexed sources
- `senior_stats` — Knowledge base statistics
- `senior_reindex` — Trigger reindexing

## 5) Retrieval quality benchmark

```bash
npm run knowledge:eval
```

Dataset: `scripts/knowledge/eval/golden-queries.jsonl`
