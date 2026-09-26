const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
  "i", "in", "is", "it", "my", "of", "on", "or", "that", "the", "this",
  "to", "was", "what", "when", "where", "which", "who", "why", "with",
]);

export function tokenize(value) {
  return (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function parseMarkdown(path, markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const chunks = [];
  const headings = [];
  let section = [];
  let startLine = 1;
  let inFence = false;
  let frontmatter = lines[0]?.trim() === "---";

  const flush = (endLine) => {
    const text = section.join("\n").trim();
    if (text) {
      chunks.push({
        kind: "markdown",
        path,
        heading: headings.map((item) => item.text).join(" > ") || "Note",
        startLine,
        endLine,
        text,
      });
    }
    section = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === 0 && frontmatter) continue;
    if (frontmatter) {
      if (line.trim() === "---") {
        frontmatter = false;
        startLine = index + 2;
      }
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) {
      section.push(line);
      continue;
    }

    flush(index);
    const level = match[1].length;
    while (headings.length && headings.at(-1).level >= level) headings.pop();
    headings.push({ level, text: match[2] });
    startLine = index + 2;
  }

  flush(lines.length);
  return chunks;
}

export function parsePdfPages(path, pages, maxCharacters = 1800) {
  const chunks = [];
  pages.forEach((page, pageIndex) => {
    const text = page.replace(/\s+/g, " ").trim();
    if (!text) return;
    for (let start = 0, part = 1; start < text.length; start += maxCharacters, part += 1) {
      const excerpt = text.slice(start, start + maxCharacters).trim();
      if (!excerpt) continue;
      chunks.push({
        kind: "pdf",
        path,
        heading: `Page ${pageIndex + 1}${text.length > maxCharacters ? ` · Part ${part}` : ""}`,
        page: pageIndex + 1,
        startLine: 1,
        endLine: 1,
        text: excerpt,
      });
    }
  });
  return chunks;
}

export async function withTimeout(promise, milliseconds, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function parseDocumentText(path, text, kind = "document", maxCharacters = 1800) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks = [];
  for (let start = 0, part = 1; start < normalized.length; start += maxCharacters, part += 1) {
    chunks.push({
      kind,
      path,
      heading: `${kind === "image" ? "Visual content" : "Document"} · Part ${part}`,
      startLine: 1,
      endLine: 1,
      text: normalized.slice(start, start + maxCharacters).trim(),
    });
  }
  return chunks;
}

export function chunkKey(chunk) {
  let hash = 2166136261;
  const value = `${chunk.path}\0${chunk.heading}\0${chunk.text}`;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${chunk.path}:${(hash >>> 0).toString(16)}`;
}

export function buildIndex(chunks) {
  const documentFrequency = new Map();
  const indexedChunks = chunks.map((chunk) => {
    const tokens = tokenize(`${chunk.path} ${chunk.heading} ${chunk.text}`);
    const termCounts = new Map();
    for (const token of tokens) termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
    for (const token of termCounts.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
    return { ...chunk, key: chunkKey(chunk), tokens, termCounts };
  });

  const averageLength = indexedChunks.length
    ? indexedChunks.reduce((sum, chunk) => sum + chunk.tokens.length, 0) / indexedChunks.length
    : 1;
  return { chunks: indexedChunks, documentFrequency, averageLength };
}

export function searchVectorIndex(index, queryVector, vectors, limit = 24) {
  if (!queryVector?.length) return [];
  return index.chunks
    .map((chunk) => ({ ...chunk, score: cosine(queryVector, vectors.get(chunk.key)) }))
    .filter((chunk) => Number.isFinite(chunk.score) && chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit));
}

export function fuseRankings(rankings, limit = 6) {
  const fused = new Map();
  for (const ranking of rankings) {
    ranking.forEach((result, rank) => {
      const current = fused.get(result.key) ?? { ...result, score: 0 };
      current.score += 1 / (60 + rank + 1);
      fused.set(result.key, current);
    });
  }
  return [...fused.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit));
}

function cosine(left, right) {
  if (!right || left.length !== right.length) return Number.NaN;
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftLength += left[index] ** 2;
    rightLength += right[index] ** 2;
  }
  const denominator = Math.sqrt(leftLength * rightLength);
  return denominator ? dot / denominator : Number.NaN;
}

export function searchIndex(index, query, limit = 6) {
  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length || !index.chunks.length) return [];

  const total = index.chunks.length;
  const k1 = 1.5;
  const b = 0.75;
  return index.chunks
    .map((chunk) => {
      let score = 0;
      for (const token of queryTokens) {
        const frequency = chunk.termCounts.get(token) ?? 0;
        if (!frequency) continue;
        const foundIn = index.documentFrequency.get(token) ?? 0;
        const inverseFrequency = Math.log(1 + (total - foundIn + 0.5) / (foundIn + 0.5));
        const lengthScale = 1 - b + b * (chunk.tokens.length / index.averageLength);
        score += inverseFrequency * ((frequency * (k1 + 1)) / (frequency + k1 * lengthScale));
      }
      const label = `${chunk.path} ${chunk.heading}`.toLowerCase();
      score += queryTokens.filter((token) => label.includes(token)).length * 0.35;
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, limit));
}

export function buildEvidence(results, maxCharacters = 2400) {
  return results.map((result, index) => ({
    id: `S${index + 1}`,
    ...result,
    excerpt: result.text.slice(0, maxCharacters),
  }));
}
