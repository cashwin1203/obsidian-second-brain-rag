# Second Brain RAG for Obsidian

A local-first Obsidian plugin implementing Retrieval-Augmented Generation (RAG) across Markdown, PDF, Word, and image content, with inspectable evidence behind every answer.

This is an independent implementation by `cashwin1203`. External projects and technical documentation are used as design references only; this repository is not a fork and carries no third-party Git history.

Repository: https://github.com/cashwin1203/obsidian-second-brain-rag

## RAG pipeline

1. Parse Markdown by heading, PDFs by page, Word documents by text segment, and opted-in images into factual descriptions.
2. Index chunks locally with BM25 and optionally cache embeddings.
3. Retrieve with BM25 or reciprocal-rank fusion over BM25 and vector results.
4. Let a configured tool-capable model choose `search_brain`, optionally inspect a returned source with `read_source`, and stop within a configured step limit.
5. Validate `[S1]`, `[S2]`, and similar citations before displaying the answer, with one repair attempt and a deterministic refusal when support is insufficient.

Without an embedding model the plugin remains a complete sparse-RAG implementation. Configuring an embedding model enables hybrid retrieval.

## Current capabilities

- Markdown, text-based PDF, and `.docx` indexing
- Opt-in image understanding for PNG, JPEG, WebP, and GIF files
- Retrieval-Augmented Generation (RAG) using BM25 or hybrid BM25 + vector retrieval
- Source excerpts that open in Obsidian
- Automatic re-indexing after vault changes
- Optional cited generation through an OpenAI-compatible endpoint
- Retrieval-only mode when no model is configured
- Local MCP server with `search_brain` and `read_source` tools
- Bounded model-controlled agent loop using the same read-only tool contracts
- Strict Zod validation and default-deny permissions for future write tools
- Visible model/tool step history in Obsidian
- Versioned agent prompt with untrusted-content instructions
- Unsupported-citation detection, citation repair, and insufficient-evidence refusal
- Per-file ingestion timeouts so failed PDFs do not block the remaining vault
- Local privacy-safe traces for answer and indexing runs (latest 100)
- Chat, embedding, and image-call latency, retry, token, and configurable cost tracking
- Retrieval-mode, BM25 fallback, typed failure, tool latency, and end-to-end latency tracking
- Hashed request/response fingerprints without raw prompt, response, vault excerpt, API-key, or authorization-header logging

## Development

```powershell
npm install
npm test
npm run typecheck
npm run eval
npm run test:mcp
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/cashwin-second-brain-rag/
```

Restart Obsidian, open **Settings > Community plugins**, and enable **Second Brain**.

## Model configuration

The default base URL is `http://127.0.0.1:11434/v1`, suitable for a local OpenAI-compatible Ollama endpoint. Remote endpoints must use HTTPS.

- **Model:** optional agentic cited-answer generation. The model must support OpenAI-compatible tool/function calling.
- **Embedding model:** optional hybrid vector retrieval. Run **Second Brain: Reindex vault** after configuring it.
- **Image model:** optional and explicit. Reindexing sends vault images to that vision-capable endpoint and caches only their descriptions.

Leave all model fields empty for fully local BM25 retrieval.

The maximum agent-step setting defaults to six and has a hard limit of ten. Retrieval-only mode does not invoke the agent or a generation model.

Optional pricing is configured in **Model pricing (USD per million tokens)** as JSON keyed by the exact model ID, for example:

```json
{
  "gpt-model-id": {
    "inputPerMillionUsd": 1,
    "outputPerMillionUsd": 2
  }
}
```

Token counts are recorded only when the endpoint reports them; missing usage is labelled unavailable rather than estimated. Local endpoints default to zero cost when no price is configured. Remote models without configured prices have unavailable cost.

## MCP server

Build the project, then configure any standards-compatible MCP client with:

```json
{
  "command": "node",
  "args": [
    "C:/path/to/obsidian-second-brain/mcp-server.mjs",
    "C:/path/to/your/Obsidian vault"
  ]
}
```

The server is read-only. It searches Markdown, PDFs, and Word documents and can return original image content to a multimodal MCP client. Both tools use the same strict Zod contracts as the Obsidian agent. Hidden paths, unsupported file types, and paths outside the vault are rejected. Installed agent-shell plugins such as Copilot or Claudian remain separate unless configured to launch this server.

## Privacy boundary

Markdown, PDF text, and Word text are extracted locally. Embedding text is sent only when an embedding model is configured; retrieved excerpts are sent only when an answer model is configured; images are sent only when an image model is configured. The plugin does not create, modify, rename, or delete notes.

Vault excerpts and tool results are treated as untrusted data. During an agent run, `read_source` can only open paths previously returned by `search_brain`. No write tool is registered; the shared executor denies any future write-capable tool unless a human-approval callback explicitly permits that invocation.

Run traces are stored only in this vault's Obsidian plugin data. They contain hashes, lengths, model and tool identifiers, timings, usage, costs, retrieval modes, retry counts, and typed error categories—not raw questions, prompts, model responses, source text, API keys, or authorization headers. A diagnostics screen and sanitized export are intentionally deferred to the next phase.

Scanned PDFs still require OCR. Gmail requires a separate read-only OAuth connection and is intentionally not presented as working until credentials are supplied. Audio and video ingestion follow the document and image milestone.

`npm run eval` reports Hit@5 and mean reciprocal rank against the included retrieval cases; replace or extend those cases with real personal questions before comparing BM25 and hybrid retrieval.

See [the PRD](docs/PRD.md) for scope and deferred work.
