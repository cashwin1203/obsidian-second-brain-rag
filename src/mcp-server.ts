#!/usr/bin/env node
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { extractText } from "unpdf";
import mammoth from "mammoth";
import { buildEvidence, buildIndex, parseDocumentText, parseMarkdown, parsePdfPages, searchIndex, withTimeout } from "./retrieval.js";
import { readSourceArgsSchema, searchBrainArgsSchema, type EvidenceRecord, type ReadSourceResult } from "./contracts.js";
import { createReadOnlyTools, executeTool } from "./tools.js";

const requestedVault = process.argv[2] ?? process.env.SECOND_BRAIN_VAULT;
if (!requestedVault) throw new Error("Pass the Obsidian vault path as the first argument or SECOND_BRAIN_VAULT.");
const vault = await realpath(path.resolve(requestedVault));

async function listSources(directory: string): Promise<string[]> {
  const results: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await listSources(target));
    else if ([".md", ".pdf", ".docx"].includes(path.extname(entry.name).toLowerCase())) results.push(target);
  }
  return results;
}

async function extractPdf(file: string) {
  const extracted = await withTimeout(
    extractText(new Uint8Array(await readFile(file)), { mergePages: false }),
    120_000,
    "PDF extraction timed out",
  );
  return Array.isArray(extracted.text) ? extracted.text : [extracted.text];
}

async function loadIndex() {
  // ponytail: rescan on each search; add a file watcher/cache only when vault-size latency is measurable.
  const chunks = [];
  for (const file of await listSources(vault)) {
    const relative = path.relative(vault, file).split(path.sep).join("/");
    const extension = path.extname(file).toLowerCase();
    try {
      if (extension === ".pdf") chunks.push(...parsePdfPages(relative, await extractPdf(file)));
      else if (extension === ".docx") {
        const document = await mammoth.extractRawText({ buffer: await readFile(file) });
        chunks.push(...parseDocumentText(relative, document.value, "docx"));
      } else chunks.push(...parseMarkdown(relative, await readFile(file, "utf8")));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "extraction failed";
      console.error(`Second Brain skipped ${relative}: ${reason}`);
    }
  }
  return buildIndex(chunks);
}

async function resolveSource(relative: string) {
  if (relative.split(/[\\/]/).some((part) => part.startsWith("."))) throw new Error("Hidden vault paths cannot be read.");
  const candidate = path.resolve(vault, relative);
  if (candidate !== vault && !candidate.startsWith(`${vault}${path.sep}`)) throw new Error("Source path leaves the vault.");
  const resolved = await realpath(candidate);
  if (resolved !== vault && !resolved.startsWith(`${vault}${path.sep}`)) throw new Error("Source path leaves the vault.");
  return resolved;
}

function plainEvidence(items: Array<{
  id: string;
  path: string;
  heading: string;
  excerpt: string;
  kind: string;
  page?: number;
  startLine?: number;
  endLine?: number;
  score?: number;
}>): EvidenceRecord[] {
  return items.map((item) => ({
    id: item.id,
    path: item.path,
    heading: item.heading,
    excerpt: item.excerpt,
    kind: item.kind,
    ...(item.page ? { page: item.page } : {}),
    ...(item.startLine ? { startLine: item.startLine } : {}),
    ...(item.endLine ? { endLine: item.endLine } : {}),
    ...(Number.isFinite(item.score) ? { score: item.score } : {}),
  }));
}

const tools = createReadOnlyTools({
  searchBrain: async ({ query, limit }) => ({
    retrievalMode: "bm25",
    evidence: plainEvidence(buildEvidence(searchIndex(await loadIndex(), query, limit), 1200)),
  }),
  readSource: async ({ sourcePath, page }): Promise<ReadSourceResult> => {
    const file = await resolveSource(sourcePath);
    const extension = path.extname(file).toLowerCase();
    const imageMime: Record<string, "image/png" | "image/jpeg" | "image/webp" | "image/gif"> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };
    if (imageMime[extension]) {
      return { contentType: "image", sourcePath, data: (await readFile(file)).toString("base64"), mimeType: imageMime[extension] };
    }
    if (![".md", ".pdf", ".docx"].includes(extension)) throw new Error("Unsupported source type.");
    let text: string;
    if (extension === ".pdf") {
      const pages = await extractPdf(file);
      if (page && page > pages.length) throw new Error(`PDF has ${pages.length} pages.`);
      text = page ? pages[page - 1] : pages.join("\n\n");
    } else if (extension === ".docx") {
      text = (await mammoth.extractRawText({ buffer: await readFile(file) })).value;
    } else {
      text = await readFile(file, "utf8");
    }
    return { contentType: "text", sourcePath, ...(page ? { page } : {}), text: text.slice(0, 100_000) };
  },
});

const server = new McpServer({ name: "obsidian-second-brain", version: "0.4.0" });

server.registerTool("search_brain", {
  description: "Search Markdown notes, text-based PDFs, and Word documents in the configured Obsidian vault.",
  inputSchema: searchBrainArgsSchema.shape,
}, async (args) => {
  const result = await executeTool(tools, "search_brain", args);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

server.registerTool("read_source", {
  description: "Read a Markdown or Word source, one PDF page, or an image inside the configured vault.",
  inputSchema: readSourceArgsSchema.shape,
}, async (args) => {
  const result = await executeTool(tools, "read_source", args) as ReadSourceResult;
  if (result.contentType === "image") {
    return { content: [{ type: "image" as const, data: result.data, mimeType: result.mimeType }] };
  }
  return { content: [{ type: "text" as const, text: result.text }] };
});

await server.connect(new StdioServerTransport());
console.error(`Second Brain MCP server connected to ${vault}`);
