import { withTimeout } from "./retrieval.js";

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
}

export class OpenAICompatibleModelClient implements AgentModelClient {
  constructor(private readonly options: OpenAICompatibleClientOptions) {}

  async complete(messages: ChatMessage[], tools: unknown[]): Promise<ModelTurn> {
    const endpoint = validateModelEndpoint(this.options.baseUrl);
    const response = await withTimeout(fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        messages,
        tools,
        tool_choice: "auto",
      }),
    }), this.options.timeoutMs ?? 120_000, "model request timed out");
    if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
    const payload = await response.json();
    const choice = payload?.choices?.[0];
    const message = choice?.message;
    if (!message || (typeof message.content !== "string" && !Array.isArray(message.tool_calls))) {
      throw new Error("The model returned an invalid response.");
    }
    const toolCalls = Array.isArray(message.tool_calls)
      ? message.tool_calls.map(parseToolCall).filter((call: ChatToolCall | null): call is ChatToolCall => call !== null)
      : [];
    return {
      content: typeof message.content === "string" ? message.content.trim() : "",
      toolCalls,
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : undefined,
    };
  }
}

function parseToolCall(value: unknown): ChatToolCall | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const functionValue = record.function;
  if (!functionValue || typeof functionValue !== "object") return null;
  const fn = functionValue as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof fn.name !== "string") return null;
  return {
    id: record.id,
    name: fn.name,
    arguments: typeof fn.arguments === "string" ? fn.arguments : "{}",
  };
}

export function validateModelEndpoint(value: string) {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("Model base URL is invalid.");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(local && endpoint.protocol === "http:")) {
    throw new Error("Use HTTPS for remote model endpoints.");
  }
  return endpoint.toString().replace(/\/$/, "");
}
