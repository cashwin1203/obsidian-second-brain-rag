import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod/v4";
import { createReadOnlyTools, executeTool, type ToolDefinition } from "../src/tools.js";

const evidence = {
  id: "S1",
  path: "Policy.md",
  heading: "Review",
  excerpt: "Human review is required.",
  kind: "markdown",
  startLine: 1,
  endLine: 2,
  score: 2,
};

function tools() {
  return createReadOnlyTools({
    searchBrain: async ({ corpus }) => ({ retrievalMode: "bm25", corpus, evidence: [evidence] }),
    readSource: async ({ sourcePath }) => ({ contentType: "text", sourcePath, text: "Human review is required." }),
  });
}

test("strictly validates tool arguments", async () => {
  const result = await executeTool(tools(), "search_brain", { query: "review" });
  assert.equal(result.corpus, "all");
  await assert.rejects(
    executeTool(tools(), "search_brain", { query: "review", limit: 3, unexpected: true }),
    /Unrecognized key/,
  );
  await assert.rejects(executeTool(tools(), "missing_tool", {}), /Unknown tool/);
});

test("limits agent reads to paths returned by search", async () => {
  await assert.rejects(
    executeTool(tools(), "read_source", { sourcePath: "Secret.md" }, { allowedSourcePaths: new Set(["Policy.md"]) }),
    /only open paths returned by search_brain/,
  );
  const result = await executeTool(
    tools(),
    "read_source",
    { sourcePath: "Policy.md" },
    { allowedSourcePaths: new Set(["Policy.md"]) },
  );
  assert.equal(result.contentType, "text");
});

test("denies future write tools without human approval", async () => {
  const writeTool: ToolDefinition = {
    name: "write_note",
    description: "Test-only write tool.",
    permission: "write",
    inputSchema: z.object({ path: z.string() }).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    execute: async () => ({ ok: true }),
  };
  await assert.rejects(executeTool([writeTool], "write_note", { path: "A.md" }), /requires human approval/);
  assert.deepEqual(
    await executeTool([writeTool], "write_note", { path: "A.md" }, { approveWrite: async () => true }),
    { ok: true },
  );
});
