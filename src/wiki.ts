import { wikiNoteProposalSchema, type EvidenceRecord } from "./contracts.js";

export function sanitizeWikiTitle(value: string) {
  return value
    .replace(/[\\/:*?"<>|#\[\]^]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 100) || "Knowledge note";
}

export function wikiTargetPath(title: string) {
  const path = `Wiki/Synthesis/${sanitizeWikiTitle(title)}.md`;
  if (!path.startsWith("Wiki/Synthesis/") || !path.endsWith(".md")) throw new Error("Wiki note path is invalid.");
  return path;
}

export function createWikiProposal(title: string, answer: string, evidence: EvidenceRecord[]) {
  return wikiNoteProposalSchema.parse({
    title: sanitizeWikiTitle(title),
    body: answer,
    sources: evidence.map(({ id, path, page, heading }) => ({ id, path, ...(page ? { page } : {}), heading })),
  });
}

export function renderWikiNote(proposal: ReturnType<typeof createWikiProposal>, date = new Date()) {
  const sources = proposal.sources.map((source) => {
    const name = source.path.split("/").at(-1) ?? source.path;
    const anchor = source.page
      ? `#page=${source.page}`
      : source.path.toLowerCase().endsWith(".md") && source.heading ? `#${source.heading.split(" > ").at(-1)}` : "";
    const label = `${name}${source.page ? ` · page ${source.page}` : ""}`;
    return `- [${source.id}] [[${source.path}${anchor}|${label}]]`;
  }).join("\n");
  return `---\ntype: synthesis\nstatus: reviewed\ncreated: ${date.toISOString().slice(0, 10)}\n---\n# ${proposal.title}\n\n${proposal.body}\n\n## Sources\n${sources}\n`;
}
