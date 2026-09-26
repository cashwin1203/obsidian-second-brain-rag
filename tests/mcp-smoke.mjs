import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP server exposes searchable vault evidence", async () => {
  const vault = await mkdtemp(path.join(tmpdir(), "second-brain-"));
  await writeFile(path.join(vault, "Evidence.md"), "# Decision\nHuman approval protects consequential AI workflows.");
  const server = fileURLToPath(new URL("../mcp-server.mjs", import.meta.url));
  const client = new Client({ name: "second-brain-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [server, vault], stderr: "pipe" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name), ["search_brain", "read_source"]);
    const result = await client.callTool({ name: "search_brain", arguments: { query: "human approval", limit: 3 } });
    assert.match(result.content[0].text, /Evidence\.md/);
    const source = await client.callTool({ name: "read_source", arguments: { sourcePath: "Evidence.md" } });
    assert.match(source.content[0].text, /Human approval protects/);
  } finally {
    await client.close();
    await rm(vault, { recursive: true, force: true });
  }
});
