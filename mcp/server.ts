// gist MCP server over stdio, for Claude Desktop / Claude Code. Read-only.
// Run: bun run mcp   (from the repo root; loads .env.local)
// stdout carries the protocol, so any stray console.log goes to stderr instead.
console.log = (...a: unknown[]) => console.error(...a);
console.info = console.log;

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "@/lib/server/mcp/tools";

async function main() {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
  console.error("gist MCP server ready on stdio");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
