import {
  SecondBrainError,
  calculateCost,
  fingerprintText,
  unavailableUsage,
  type ErrorCategory,
  type ModelCallKind,
  type ModelPricing,
  type RunTraceRecorder,
  type TokenUsage,
} from "./run-history.js";

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ModelTurn {
  content: string;
  toolCalls: ChatToolCall[];
  finishReason?: string;
}

export interface AgentModelClient {
  complete(messages: ChatMessage[], tools: unknown[]): Promise<ModelTurn>;
}

export interface OpenAICompatibleClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  pricing?: ModelPricing;
  trace?: RunTraceRecorder;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleModelClient implements AgentModelClient {
  constructor(private readonly options: OpenAICompatibleClientOptions) {}

  async complete(messages: ChatMessage[], tools: unknown[]): Promise<ModelTurn> {
    return this.request("chat", "/chat/completions", {
      model: this.options.model,
      temperature: 0,
      messages,
      tools,
      tool_choice: "auto",
    }, parseModelTurn);
  }

  async embed(input: string[]) {
    return this.request("embedding", "/embeddings", {
      model: this.options.model,
      input,
    }, (payload) => {
      const record = asRecord(payload);
      const data = Array.isArray(record.data) ? record.data : [];
      const vectors = data
        .map((item) => asRecord(item))
        .sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0))
        .map((item) => item.embedding);
      if (vectors.length !== input.length || vectors.some((vector) => !Array.isArray(vector) || vector.some((value) => typeof value !== "number"))) {
        throw new SecondBrainError("embedding_failure", "Embedding endpoint returned invalid data.");
      }
      return vectors as number[][];
    });
  }

  async describeImage(mime: string, base64: string, prompt: string) {
    return this.request("image", "/chat/completions", {
      model: this.options.model,
      temperature: 0,
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:image/${mime};base64,${base64}` } },
      ] }],
    }, (payload) => {
      const choice = firstChoice(payload);
      const message = asRecord(choice.message);
      if (typeof message.content !== "string" || !message.content.trim()) {
        throw new SecondBrainError("image_failure", "Image model returned no description.");
      }
      return message.content.trim();
    });
  }

  private async request<T>(kind: ModelCallKind, path: string, body: unknown, parse: (payload: unknown) => T): Promise<T> {
    const endpoint = validateModelEndpoint(this.options.baseUrl);
    const request = fingerprintText(JSON.stringify(body));
    const started = performance.now();
    const maxRetries = Math.min(5, Math.max(0, this.options.maxRetries ?? 2));
    let retryCount = 0;
    let finalError: SecondBrainError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const payload = await this.fetchJson(`${endpoint}${path}`, body);
        const result = parse(payload);
        const usage = extractUsage(payload, kind);
        this.options.trace?.recordModelCall({
          kind,
          model: this.options.model,
          status: "success",
          request,
          response: fingerprintText(JSON.stringify(payload)),
          latencyMs: performance.now() - started,
          retryCount,
          usage,
          costUsd: calculateCost(this.options.model, usage, this.options.pricing ?? {}, isLocalEndpoint(endpoint)),
        });
        return result;
      } catch (error) {
        finalError = normalizeModelError(error, kind);
        if (!finalError.retryable || attempt === maxRetries) break;
        retryCount += 1;
        await new Promise((resolve) => setTimeout(resolve, (this.options.retryDelayMs ?? 250) * (2 ** attempt)));
      }
    }

    const failure = finalError ?? new SecondBrainError(categoryForKind(kind), `${kind} request failed.`);
    this.options.trace?.recordModelCall({
      kind,
      model: this.options.model,
      status: "failure",
      request,
      latencyMs: performance.now() - started,
      retryCount,
      usage: unavailableUsage(),
      costUsd: null,
      errorCategory: failure.category,
    });
    throw failure;
  }

  private async fetchJson(url: string, body: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120_000);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SecondBrainError(
          "model_http",
          `Model endpoint returned HTTP ${response.status}.`,
          response.status === 429 || response.status >= 500,
        );
      }
      try {
        return await response.json();
      } catch {
        throw new SecondBrainError("model_response", "Model endpoint returned invalid JSON.");
      }
    } catch (error) {
      if (error instanceof SecondBrainError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new SecondBrainError("model_timeout", "Model request timed out.", true);
      }
      throw new SecondBrainError("model_http", "Model endpoint could not be reached.", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseModelTurn(payload: unknown): ModelTurn {
  const choice = firstChoice(payload);
  const message = asRecord(choice.message);
  if (typeof message.content !== "string" && !Array.isArray(message.tool_calls)) {
    throw new SecondBrainError("model_response", "The model returned an invalid response.");
  }
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map(parseToolCall).filter((call: ChatToolCall | null): call is ChatToolCall => call !== null)
    : [];
  return {
    content: typeof message.content === "string" ? message.content.trim() : "",
    toolCalls,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : undefined,
  };
}

function firstChoice(payload: unknown) {
  const record = asRecord(payload);
  if (!Array.isArray(record.choices) || !record.choices.length) {
    throw new SecondBrainError("model_response", "The model returned no choices.");
  }
  return asRecord(record.choices[0]);
}

function parseToolCall(value: unknown): ChatToolCall | null {
  const record = asRecord(value);
  const fn = asRecord(record.function);
  if (typeof record.id !== "string" || typeof fn.name !== "string") return null;
  return {
    id: record.id,
    name: fn.name,
    arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
  };
}

export function extractUsage(payload: unknown, kind: ModelCallKind): TokenUsage {
  const record = asRecord(payload);
  const usage = asRecord(record.usage);
  const input = finiteNumber(usage.prompt_tokens ?? usage.input_tokens ?? record.prompt_eval_count);
  const reportedOutput = finiteNumber(usage.completion_tokens ?? usage.output_tokens ?? record.eval_count);
  const output = reportedOutput ?? (kind === "embedding" && input !== null ? 0 : null);
  const total = finiteNumber(usage.total_tokens) ?? (input !== null && output !== null ? input + output : null);
  if (input === null && output === null && total === null) return unavailableUsage();
  return { input, output, total, source: "reported" };
}

function normalizeModelError(error: unknown, kind: ModelCallKind) {
  if (error instanceof SecondBrainError) {
    if (error.category === "model_timeout" || kind === "chat") return error;
    return new SecondBrainError(categoryForKind(kind), error.message, error.retryable);
  }
  return new SecondBrainError(categoryForKind(kind), `${kind} request failed.`);
}

function categoryForKind(kind: ModelCallKind): ErrorCategory {
  if (kind === "embedding") return "embedding_failure";
  if (kind === "image") return "image_failure";
  return "model_response";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export function validateModelEndpoint(value: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new SecondBrainError("model_http", "Model base URL is invalid.");
  }
  const local = isLocalEndpoint(endpoint.toString());
  if (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) {
    throw new SecondBrainError("model_http", "Use HTTPS for remote model endpoints.");
  }
  return endpoint.toString().replace(/\/$/, "");
}

function isLocalEndpoint(value: string) {
  const hostname = new URL(value).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}
