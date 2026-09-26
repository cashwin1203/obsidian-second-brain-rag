import * as z from "zod/v4";

export const retrievalModeSchema = z.enum(["bm25", "vector", "hybrid", "bm25_fallback"]);

export const modelPricingSchema = z.record(z.string().min(1), z.object({
  inputPerMillionUsd: z.number().min(0),
  outputPerMillionUsd: z.number().min(0),
}).strict());

export const evidenceSchema = z.object({
  id: z.string().regex(/^S\d+$/),
  path: z.string().min(1),
  heading: z.string(),
  excerpt: z.string(),
  kind: z.string(),
  page: z.number().int().min(1).optional(),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
  score: z.number().finite().optional(),
}).strict();

export const searchBrainArgsSchema = z.object({
  query: z.string().trim().min(1).max(2_000),
  limit: z.number().int().min(1).max(10).default(5),
}).strict();

export const readSourceArgsSchema = z.object({
  sourcePath: z.string().trim().min(1).max(1_024),
  page: z.number().int().min(1).optional(),
}).strict();

export const searchBrainResultSchema = z.object({
  retrievalMode: retrievalModeSchema,
  evidence: z.array(evidenceSchema).max(10),
}).strict();

export const readSourceResultSchema = z.discriminatedUnion("contentType", [
  z.object({
    contentType: z.literal("text"),
    sourcePath: z.string().min(1),
    page: z.number().int().min(1).optional(),
    text: z.string().max(100_000),
  }).strict(),
  z.object({
    contentType: z.literal("image"),
    sourcePath: z.string().min(1),
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    data: z.string(),
  }).strict(),
]);

export type EvidenceRecord = z.infer<typeof evidenceSchema>;
export type RetrievalMode = z.infer<typeof retrievalModeSchema>;
export type SearchBrainArgs = z.infer<typeof searchBrainArgsSchema>;
export type ReadSourceArgs = z.infer<typeof readSourceArgsSchema>;
export type SearchBrainResult = z.infer<typeof searchBrainResultSchema>;
export type ReadSourceResult = z.infer<typeof readSourceResultSchema>;
export type ToolPermission = "read" | "write";
