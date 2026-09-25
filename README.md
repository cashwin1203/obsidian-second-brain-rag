# Second Brain RAG for Obsidian

A local-first Obsidian plugin implementing Retrieval-Augmented Generation (RAG) across Markdown, PDF, Word, and image content, with inspectable evidence behind every answer.

This is an independent implementation by `cashwin1203`. External projects and technical documentation are used as design references only; this repository is not a fork and carries no third-party Git history.

## RAG pipeline

1. Parse Markdown by heading, PDFs by page, Word documents by text segment, and opted-in images into factual descriptions.
2. Index chunks locally with BM25 and optionally cache embeddings.
3. Retrieve with BM25 or reciprocal-rank fusion over BM25 and vector results.
4. Send only those excerpts to an OpenAI-compatible model as grounded context.
5. Require `[S1]`, `[S2]`, and similar citations and display links to the original notes.

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

## Development

```powershell
npm install
npm test
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

- **Model:** optional cited answer generation.
- **Embedding model:** optional hybrid vector retrieval. Run **Second Brain: Reindex vault** after configuring it.
- **Image model:** optional and explicit. Reindexing sends vault images to that vision-capable endpoint and caches only their descriptions.

Leave all model fields empty for fully local BM25 retrieval.

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

The server is read-only. It searches Markdown, PDFs, and Word documents and can return original image content to a multimodal MCP client. Installed agent-shell plugins such as Copilot or Claudian remain separate unless configured to launch this server.

## Privacy boundary

Markdown, PDF text, and Word text are extracted locally. Embedding text is sent only when an embedding model is configured; retrieved excerpts are sent only when an answer model is configured; images are sent only when an image model is configured. The plugin does not create, modify, rename, or delete notes.

Scanned PDFs still require OCR. Gmail requires a separate read-only OAuth connection and is intentionally not presented as working until credentials are supplied. Audio and video ingestion follow the document and image milestone.

`npm run eval` reports Hit@5 and mean reciprocal rank against the included retrieval cases; replace or extend those cases with real personal questions before comparing BM25 and hybrid retrieval.

See [the PRD](docs/PRD.md) for scope and deferred work.
