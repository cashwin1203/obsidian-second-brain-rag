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
6. Refuse when evidence is missing.
7. Keep the vault read-only until a diff-and-approve workflow is implemented.

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

The current milestone implements Retrieval-Augmented Generation (RAG) across Markdown, text-based PDFs, Word documents, and opted-in images. Retrieval uses BM25 by default and hybrid BM25 + vector ranking when an embedding model is configured. A read-only MCP server exposes vault search and source reading to compatible AI clients.

## Deferred until measured

- Retrieval evaluation and reranking
- Knowledge-graph expansion
- OCR for scanned PDFs
- Gmail read-only OAuth ingestion
- Audio and video transcription
- Web ingestion
- AI-maintained wiki pages
- Approval-gated writes
- Cloud sync and multi-user access
