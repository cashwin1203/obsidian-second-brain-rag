import assert from "node:assert/strict";
import test from "node:test";
import { createWikiProposal, renderWikiNote, sanitizeWikiTitle, wikiTargetPath } from "../src/wiki.js";

test("renders a safe multimodal Wiki note with durable source links", () => {
  const proposal = createWikiProposal("What: builds / trust?", "Human review builds trust [S1] and diagrams show the flow [S2].", [
    { id: "S1", path: "Sources/PDFs/Policy.pdf", heading: "Page 3", page: 3, excerpt: "Review", kind: "pdf" },
    { id: "S2", path: "Sources/Images/Flow.png", heading: "Visual content", excerpt: "Flow", kind: "image" },
  ]);
  assert.equal(sanitizeWikiTitle("What: builds / trust?"), "What builds trust");
  assert.equal(wikiTargetPath(proposal.title), "Wiki/Synthesis/What builds trust.md");
  const note = renderWikiNote(proposal, new Date("2026-09-27T00:00:00Z"));
  assert.match(note, /\[\[Sources\/PDFs\/Policy\.pdf#page=3\|Policy\.pdf · page 3\]\]/);
  assert.match(note, /\[\[Sources\/Images\/Flow\.png\|Flow\.png\]\]/);
  assert.match(note, /status: reviewed/);
});
