import { createHash, randomUUID } from "crypto";
import type { RetrievalMode } from "./contracts.js";

export type RunKind = "answer" | "index";
export type RunStatus = "success" | "partial" | "refused" | "failure";
export type ModelCallKind = "chat" | "embedding" | "image";
export type ErrorCategory =
  | "ingestion_failure"
  | "retrieval_failure"
  | "embedding_failure"
  | "image_failure"
  | "model_timeout"
  | "model_http"
  | "model_response"
  | "tool_validation"
  | "tool_permission"
  | "tool_failure"
  | "citation_invalid"
  | "insufficient_evidence"
  | "max_steps"
  | "unknown";

export interface TokenUsage {
  input: number | null;
  output: number | null;
  total: number | null;
  source: "reported" | "unavailable";
}

export interface ModelPrice {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export type ModelPricing = Record<string, ModelPrice>;

export interface ModelCallTrace {
  kind: ModelCallKind;
  model: string;
  status: "success" | "failure";
  request: PayloadFingerprint;
  response?: PayloadFingerprint;
  latencyMs: number;
  retryCount: number;
  usage: TokenUsage;
  costUsd: number | null;
  errorCategory?: ErrorCategory;
}

export interface PayloadFingerprint {
  hash: string;
  length: number;
}

export interface ToolCallTrace {
  toolName: string;
  status: "success" | "failure";
  latencyMs: number;
  errorCategory?: ErrorCategory;
}

export interface RunError {
  category: ErrorCategory;
  operation: string;
}

export interface RunTrace {
  id: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: string;
  completedAt: string;
  inputHash: string;
  inputLength: number;
  prompt?: { id: string; version: string; hash: string };
  retrievalMode?: RetrievalMode;
  fallbackUsed: boolean;
  calls: ModelCallTrace[];
  toolCalls: ToolCallTrace[];
  errors: RunError[];
  qualityRepairCount: number;
  retries: number;
  usage: TokenUsage;
  costUsd: number | null;
  costStatus: "complete" | "partial" | "unavailable";
  latencyMs: {
    retrieval: number;
    tools: number;
    models: number;
    total: number;
  };
}

export class SecondBrainError extends Error {
  constructor(
    public readonly category: ErrorCategory,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "SecondBrainError";
  }
}

export class RunTraceRecorder {
  private readonly started = performance.now();
  private readonly startedAt = new Date().toISOString();
  private readonly calls: ModelCallTrace[] = [];
  private readonly toolCalls: ToolCallTrace[] = [];
  private readonly errors: RunError[] = [];
  private retrievalMode?: RetrievalMode;
  private retrievalMs = 0;
  private fallbackUsed = false;
  private qualityRepairCount = 0;

  constructor(
    private readonly kind: RunKind,
    input: string,
    private readonly prompt?: { id: string; version: string; hash: string },
    private readonly id = randomUUID(),
  ) {
    const fingerprint = fingerprintText(input);
    this.inputHash = fingerprint.hash;
    this.inputLength = fingerprint.length;
  }

  readonly inputHash: string;
  readonly inputLength: number;

  recordModelCall(call: ModelCallTrace) {
    this.calls.push({ ...call });
    if (call.errorCategory) this.recordError(call.errorCategory, call.kind);
  }

  recordToolCall(call: ToolCallTrace) {
    this.toolCalls.push({ ...call });
    if (call.errorCategory) this.recordError(call.errorCategory, call.toolName);
  }

  recordRetrieval(latencyMs: number, mode: RetrievalMode) {
    this.retrievalMs += Math.max(0, latencyMs);
    this.retrievalMode = mode;
    if (mode === "bm25_fallback") this.fallbackUsed = true;
  }

  recordError(category: ErrorCategory, operation: string) {
    this.errors.push({ category, operation });
  }

  recordQualityRepair() {
    this.qualityRepairCount += 1;
  }

  finish(status: RunStatus): RunTrace {
    const usage = aggregateUsage(this.calls.map((call) => call.usage));
    const knownCosts = this.calls.map((call) => call.costUsd).filter((cost): cost is number => cost !== null);
    const costStatus = !this.calls.length
      ? "unavailable"
      : knownCosts.length === this.calls.length ? "complete" : knownCosts.length ? "partial" : "unavailable";
    return {
      id: this.id,
      kind: this.kind,
      status,
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      inputHash: this.inputHash,
      inputLength: this.inputLength,
      ...(this.prompt ? { prompt: this.prompt } : {}),
      ...(this.retrievalMode ? { retrievalMode: this.retrievalMode } : {}),
      fallbackUsed: this.fallbackUsed,
      calls: this.calls.map((call) => ({ ...call, usage: { ...call.usage } })),
      toolCalls: this.toolCalls.map((call) => ({ ...call })),
      errors: this.errors.map((error) => ({ ...error })),
      qualityRepairCount: this.qualityRepairCount,
      retries: this.calls.reduce((sum, call) => sum + call.retryCount, 0),
      usage,
      costUsd: knownCosts.length ? knownCosts.reduce((sum, cost) => sum + cost, 0) : null,
      costStatus,
      latencyMs: {
        retrieval: this.retrievalMs,
        tools: this.toolCalls.reduce((sum, call) => sum + call.latencyMs, 0),
        models: this.calls.reduce((sum, call) => sum + call.latencyMs, 0),
        total: Math.max(0, performance.now() - this.started),
      },
    };
  }
}

export function appendRun(history: RunTrace[], run: RunTrace, limit = 100) {
  return [...history, run].slice(-Math.max(1, limit));
}

export function summarizeRuns(history: RunTrace[]) {
  const total = history.length;
  const failures = history.filter((run) => run.status === "failure").length;
  const fallbacks = history.filter((run) => run.fallbackUsed).length;
  const retried = history.filter((run) => run.retries > 0).length;
  return {
    total,
    failureRate: total ? failures / total : 0,
    fallbackRate: total ? fallbacks / total : 0,
    retryRate: total ? retried / total : 0,
  };
}

export function unavailableUsage(): TokenUsage {
  return { input: null, output: null, total: null, source: "unavailable" };
}

export function fingerprintText(value: string): PayloadFingerprint {
  return { hash: createHash("sha256").update(value).digest("hex"), length: value.length };
}

export function aggregateUsage(items: TokenUsage[]): TokenUsage {
  if (!items.length || items.some((item) => item.source === "unavailable")) return unavailableUsage();
  return {
    input: sumKnown(items.map((item) => item.input)),
    output: sumKnown(items.map((item) => item.output)),
    total: sumKnown(items.map((item) => item.total)),
    source: "reported",
  };
}

function sumKnown(values: Array<number | null>) {
  return values.every((value): value is number => value !== null)
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

export function calculateCost(model: string, usage: TokenUsage, pricing: ModelPricing, localEndpoint: boolean) {
  const price = pricing[model];
  if (!price) return localEndpoint ? 0 : null;
  if (usage.input === null || usage.output === null) return price.inputPerMillionUsd === 0 && price.outputPerMillionUsd === 0 ? 0 : null;
  return (usage.input * price.inputPerMillionUsd + usage.output * price.outputPerMillionUsd) / 1_000_000;
}

export function errorCategory(error: unknown, fallback: ErrorCategory = "unknown"): ErrorCategory {
  return error instanceof SecondBrainError ? error.category : fallback;
}
