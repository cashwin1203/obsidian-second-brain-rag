# Product Requirements Document: Second Brain

## Product goal

Create a private Obsidian assistant that lets one person ask questions across a Markdown vault, inspect the exact supporting sections, and approve every proposed write.

## Primary user

A knowledge worker who keeps personal research, decisions, reflections, and project notes in Obsidian.

## Core job

When I need information from my accumulated notes, help me find and synthesize it without losing provenance or control of my vault.

## MVP

1. Index Markdown notes by heading, PDFs by page, Word documents by segment, and opted-in image descriptions.
2. Retrieve relevant sections locally.
3. Generate answers only from retrieved evidence when a model is configured.
4. Display the source path, heading, excerpt, and an action that opens the note.
5. Re-index after vault changes.
6. Refuse when evidence is missing or the generated answer cannot pass citation validation.
7. Never write automatically; create a new Wiki memory note only after an editable preview and explicit approval.
8. Let a configured tool-capable model decide when to search and when to inspect a returned source, within a bounded number of steps.

## Success criteria

- A user can ask a question from an Obsidian sidebar.
- The relevant source section appears in the top five results for the evaluation set.
- Every generated factual claim uses a visible source marker.
- Selecting a source opens the originating note and heading.
- No note is changed automatically.

## Privacy

- Indexing and lexical retrieval happen locally.
- No content leaves the device unless the user configures a model endpoint.
- Only retrieved excerpts, not the full vault, are sent for generation.
- Remote endpoints require HTTPS. Plain HTTP is allowed only for loopback addresses.

## Current milestone

The current milestone implements Retrieval-Augmented Generation (RAG) across Markdown, text-based PDFs, Word documents, and opted-in images. Retrieval uses BM25 by default and hybrid BM25 + vector ranking when an embedding model is configured. A bounded model-controlled agent can call the same strictly validated `search_brain` and `read_source` capabilities exposed by the read-only MCP server. The UI displays tool steps, rejects unsupported citations, attempts one citation repair, and refuses when supported evidence is unavailable.

The latest 100 answer and indexing runs retain privacy-safe local metrics: prompt/request/response fingerprints and lengths, prompt version, retrieval mode, fallback use, model/tool/retrieval/end-to-end latency, retry counts, typed errors, provider-reported token usage, and configurable model cost. Raw questions, prompts, responses, source excerpts, API keys, and authorization headers are not stored.

The assistant now routes agent searches to reviewed `Wiki/` Markdown first and immutable source material second. A citation-validated answer can be saved as a linked `Wiki/Synthesis/` note only after an editable preview and explicit approval. This memory path supports PDF, Word, image-description, and Markdown evidence uniformly; it never changes the source files and never overwrites an existing Wiki note.

## Deferred until measured

- Retrieval evaluation and reranking
- Knowledge-graph expansion
- OCR for scanned PDFs
- Gmail read-only OAuth ingestion
- Audio and video transcription
- Web ingestion
- Model-assisted editing of existing Wiki pages
- Automatic source-note generation, Wiki index maintenance, link traversal, linting, and undo
- Run-history and diagnostics UI, opt-in raw trace storage, and sanitized diagnostic export
- Comprehensive retrieval, tool-selection, groundedness, and generation evaluation
- Cloud sync and multi-user access
