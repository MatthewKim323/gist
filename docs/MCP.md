# gist MCP server

gist exposes each case's knowledge base (digest, phase checklist, contradictions, hybrid search, facts and source text) as a **read-only** [Model Context Protocol](https://modelcontextprotocol.io) server, so a lawyer can work a case from Claude Desktop, Claude Code or any MCP client.

- **Read-only.** Every tool reads Supabase. Nothing writes case data and nothing calls Clio. The only row written anywhere is the cost log entry `lib/server/llm.ts` records for a search embedding or an `ask_case` answer.
- **Matter-scoped.** Every case tool takes a `matter_id` and only reads that matter's rows.
- **Cited.** Results are compact JSON with human labels and source refs (`email:88`, `note:123`, `field:<id>`, `doc:45#p17`, `fact:<uuid>`). Open any ref with `get_source`.
- **One registry, two transports.** `lib/server/mcp/tools.ts` defines the tools once. `mcp/server.ts` serves them over stdio; `app/api/mcp/route.ts` serves them over Streamable HTTP.

## Tools

| tool | use it for | cost |
|---|---|---|
| `list_cases` | Every case gist has processed: id, number, client, stage, demo flag. Call first to get a `matter_id`. | free |
| `get_digest(matter_id)` | The 90-second briefing: story, money (value, coverage, specials, liens, underwater), phase, top red flags, actions, last client contact, injuries. | free |
| `get_phase_checklist(matter_id)` | Have / partial / missing / conflicting items needed to reach the next phase, with who owes each and for how long. | free |
| `get_contradictions(matter_id)` | Where sources disagree, with severity, why it matters, and each side's quote and source. | free |
| `search_case(matter_id, query, k?, expand?)` | Hybrid keyword + vector search over notes, emails, calls, fields and every OCR'd page. Query expansion is off by default. | one embedding (fractions of a cent) |
| `get_fact(fact_id)` | One extracted fact: summary, date, amount, verbatim quote, verification status, source. | free |
| `get_source(matter_id, ref)` | Full text of a note, email (with from / to), call, field, or one document page. A `fact:` ref opens the source it came from. | free |
| `ask_case(matter_id, question)` | A cited answer synthesized from verified facts and retrieved passages. | about $0.01 per call |

Resource: `gist://case/{id}/digest` (same JSON as `get_digest`).

## Claude Code

From anywhere (the repo needs `.env.local` with the Supabase and OpenAI keys):

```bash
claude mcp add gist -- bun run --cwd /absolute/path/to/gist mcp
```

`bun run mcp` runs `env -u OPENAI_API_KEY tsx --conditions=react-server --env-file=.env.local mcp/server.ts`, so the keys come from `.env.local`, not your shell.

Then ask things like "list my gist cases", "brief me on Sapini", "what's missing before trial", "find the left shoulder MRI".

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gist": {
      "command": "bun",
      "args": ["run", "--cwd", "/absolute/path/to/gist", "mcp"]
    }
  }
}
```

If Claude Desktop can't find `bun`, use its absolute path (`which bun`, often `~/.bun/bin/bun`). Restart Claude Desktop after editing.

## HTTP endpoint

`POST /api/mcp` speaks MCP Streamable HTTP in stateless mode with JSON responses (no session ids).

- **Auth:** `Authorization: Bearer $GIST_MCP_TOKEN`. In production a missing `GIST_MCP_TOKEN` env rejects every request. In dev, an unset token leaves the endpoint open.
- **Provider sessions** get a 403 from `proxy.ts`, like every other firm API.

```bash
URL=https://<your-deploy>/api/mcp
H=(-H "Authorization: Bearer $GIST_MCP_TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream")

curl -s "${H[@]}" $URL -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
curl -s "${H[@]}" $URL -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s "${H[@]}" $URL -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_cases","arguments":{}}}'
```

Remote clients that support Streamable HTTP with a bearer header can point at the same URL, e.g. `claude mcp add --transport http gist https://<your-deploy>/api/mcp --header "Authorization: Bearer $GIST_MCP_TOKEN"`.
