import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex, parseMarkdown, searchIndex } from "../src/retrieval.js";

const cases = [
  { question: "What makes AI adoption durable?", expected: "AI Product Adoption.md" },
  { question: "When should a human review an AI decision?", expected: "Human in the Loop.md" },
  { question: "How should research claims be recorded?", expected: "Research Practice.md" },
];

const directory = fileURLToPath(new URL("../demo-vault", import.meta.url));
const files = (await readdir(directory)).filter((file) => file.endsWith(".md"));
const chunks = (await Promise.all(files.map(async (file) =>
  parseMarkdown(file, await readFile(path.join(directory, file), "utf8")),
))).flat();
const index = buildIndex(chunks);
let hits = 0;
let reciprocalRanks = 0;

for (const item of cases) {
  const results = searchIndex(index, item.question, 5);
  const rank = results.findIndex((result) => result.path === item.expected) + 1;
  if (rank) {
    hits += 1;
    reciprocalRanks += 1 / rank;
  }
  console.log(`${rank ? "PASS" : "FAIL"} · ${item.question} · rank ${rank || "not found"}`);
}

console.log(`Hit@5 ${(hits / cases.length).toFixed(2)} · MRR ${(reciprocalRanks / cases.length).toFixed(2)}`);
if (hits !== cases.length) process.exitCode = 1;
