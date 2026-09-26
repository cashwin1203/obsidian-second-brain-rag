import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEvidence,
  buildIndex,
  fuseRankings,
  parseMarkdown,
  parseDocumentText,
  parsePdfPages,
  searchIndex,
  searchVectorIndex,
  withTimeout,
} from "../src/retrieval.js";

test("parses headings without treating fenced examples as sections", () => {
  const chunks = parseMarkdown("Notes.md", `---\ntags: [ai]\n---\n# Adoption\nEarly experiments.\n\`\`\`md\n## Not a heading\n\`\`\`\n## Risks\nReliability and cost.`);
  assert.deepEqual(chunks.map((chunk) => chunk.heading), ["Adoption", "Adoption > Risks"]);
});

test("creates retrievable Word and image-description chunks", () => {
  const chunks = [
    ...parseDocumentText("Brief.docx", "Customer trust depends on visible source citations.", "docx"),
    ...parseDocumentText("Diagram.png", "Flow diagram showing retrieval before generation.", "image"),
  ];
  const index = buildIndex(chunks);
  assert.equal(searchIndex(index, "source citations", 1)[0].path, "Brief.docx");
  assert.equal(searchIndex(index, "flow diagram", 1)[0].kind, "image");
});

test("ranks the section containing the query evidence", () => {
  const chunks = [
    ...parseMarkdown("AI.md", "# Adoption\nWorkflow fit drives durable AI adoption."),
    ...parseMarkdown("Cooking.md", "# Dinner\nRoast the vegetables at high heat."),
  ];
  const evidence = buildEvidence(searchIndex(buildIndex(chunks), "durable AI workflow", 3));
  assert.equal(evidence[0].path, "AI.md");
  assert.equal(evidence[0].id, "S1");
  assert.equal(searchIndex(buildIndex(chunks), "the and what", 3).length, 0);
});

test("combines lexical and semantic retrieval across Markdown and PDF pages", () => {
  const chunks = [
    ...parseMarkdown("AI.md", "# Adoption\nWorkflow fit drives durable AI adoption."),
    ...parsePdfPages("Research.pdf", ["Organizational acceptance requires trust and useful workflows."]),
  ];
  const index = buildIndex(chunks);
  const vectors = new Map(index.chunks.map((chunk) => [
    chunk.key,
    chunk.path.endsWith(".pdf") ? [1, 0] : [0.8, 0.2],
  ]));
  const lexical = searchIndex(index, "durable adoption", 4);
  const semantic = searchVectorIndex(index, [1, 0], vectors, 4);
  const results = fuseRankings([lexical, semantic], 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].path, "AI.md");
  assert.equal(results[1].page, 1);
});

test("times out a stalled PDF task so indexing can continue", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, "PDF extraction timed out"),
    /PDF extraction timed out/,
  );
  assert.equal(await withTimeout(Promise.resolve("next PDF"), 50, "timed out"), "next PDF");
});
