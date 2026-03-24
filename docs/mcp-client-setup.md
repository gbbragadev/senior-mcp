# MCP Client Setup — Senior MCP

Guia para conectar ao Senior MCP via **HTTP remoto** (subdominio publico `seniormcp.gbbragadev.com`).

---

## Arquitetura

```
Cliente MCP (Claude Code / Codex / qualquer cliente)
        |
        | HTTPS  POST /mcp  Bearer <token>
        v
seniormcp.gbbragadev.com   (Cloudflare Tunnel)
        |
        | HTTP localhost:3100
        v
server.ts   (StreamableHTTPServerTransport — stateless)
        |
        | DB queries / embeddings
        v
PostgreSQL + pgvector
```

**Transporte: MCP Streamable HTTP (spec 2024-11-05)**

- Suportado nativamente pelo Claude Code (`--transport http`) e Codex
- Compativel com qualquer cliente MCP moderno
- Stateless: cada requisicao e independente

---

## Conectar clientes

### Claude Code — CLI (qualquer maquina)

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer SEU_TOKEN_AQUI" \
  senior-knowledge \
  https://seniormcp.gbbragadev.com/mcp
```

### Claude Code — config global (~/.claude/claude.json)

```json
{
  "mcpServers": {
    "senior-knowledge": {
      "type": "http",
      "url": "https://seniormcp.gbbragadev.com/mcp",
      "headers": {
        "Authorization": "Bearer SEU_TOKEN_AQUI"
      }
    }
  }
}
```

### Codex CLI

```bash
codex mcp add senior-knowledge \
  --transport streamable-http \
  --url https://seniormcp.gbbragadev.com/mcp \
  --header "Authorization: Bearer SEU_TOKEN_AQUI"
```

### Cursor / Windsurf / Continue / outros clientes MCP

```json
{
  "mcpServers": {
    "senior-knowledge": {
      "url": "https://seniormcp.gbbragadev.com/mcp",
      "headers": {
        "Authorization": "Bearer SEU_TOKEN_AQUI"
      }
    }
  }
}
```

---

## Compartilhar com terceiros

```
URL:    https://seniormcp.gbbragadev.com/mcp
Token:  <token definido em MCP_HTTP_TOKEN>
Tipo:   MCP Streamable HTTP (2024-11-05)
```

---

## Tools disponiveis

| Tool | Descricao |
|------|-----------|
| `senior_search` | Busca semantica na base Senior (docs + LSP) |
| `senior_get_chunk` | Retorna chunk especifico por ID |
| `senior_catalog` | Lista fontes indexadas |
| `senior_stats` | Estatisticas da base de conhecimento |
| `senior_reindex` | Re-indexa documentos |

---

## Troubleshooting

| Problema | Causa | Solucao |
|----------|-------|---------|
| `401 Unauthorized` | Token errado ou ausente | Verifique `MCP_HTTP_TOKEN` no `.env` |
| Health OK mas MCP nao responde | Problema no protocolo | Verifique Accept header |
| `EADDRINUSE :3100` | Porta em uso | Mate o processo na porta 3100 |
| DB nao conecta | PostgreSQL nao esta rodando | Verifique variaveis DB_* |
