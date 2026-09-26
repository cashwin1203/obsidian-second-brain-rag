import { searchBrainResultSchema, type EvidenceRecord, type RetrievalMode } from "./contracts.js";
import type { AgentModelClient, ChatMessage } from "./model-client.js";
import { AGENT_PROMPT, CITATION_REPAIR_PROMPT } from "./prompts.js";
import { findPromptInjectionSignals, validateAnswer, type AnswerQuality } from "./quality.js";
import { executeTool, toOpenAITools, type ToolDefinition } from "./tools.js";
import type { RunTraceRecorder } from "./run-history.js";

const REFUSAL = "I cannot answer that from the available vault evidence.";

export type AgentStep =
  | { type: "model"; step: number; toolCalls: string[]; content: string }
  | { type: "tool"; step: number; toolName: string; status: "success" | "error"; error?: string };

export interface AgentResult {
  answer: string;
  evidence: EvidenceRecord[];
  retrievalMode?: RetrievalMode;
  steps: AgentStep[];
  refused: boolean;
  quality: AnswerQuality;
  prompt: { id: string; version: string; hash: string };
  injectionSignals: string[];
}

export interface AgentRunOptions {
  question: string;
  client: AgentModelClient;
  tools: ToolDefinition[];
  maxSteps?: number;
  trace?: RunTraceRecorder;
}

export async function runAgent(options: AgentRunOptions): Promise<AgentResult> {
  const maxSteps = Math.min(10, Math.max(1, options.maxSteps ?? 6));
  const messages: ChatMessage[] = [
    { role: "system", content: AGENT_PROMPT.content },
    { role: "user", content: options.question },
  ];
  const openAITools = toOpenAITools(options.tools);
  const steps: AgentStep[] = [];
  const allowedSourcePaths = new Set<string>();
  const injectionSignals = new Set<string>();
  let evidence: EvidenceRecord[] = [];
  let retrievalMode: RetrievalMode | undefined;
  let repairAttempted = false;

  const finish = (answer: string, refused: boolean): AgentResult => ({
    answer,
    evidence,
    retrievalMode,
    steps,
    refused,
    quality: validateAnswer(answer, evidence),
    prompt: { id: AGENT_PROMPT.id, version: AGENT_PROMPT.version, hash: AGENT_PROMPT.hash },
    injectionSignals: [...injectionSignals],
  });

  for (let step = 1; step <= maxSteps; step += 1) {
    const turn = await options.client.complete(messages, openAITools);
    steps.push({ type: "model", step, toolCalls: turn.toolCalls.map((call) => call.name), content: turn.content });

    if (turn.toolCalls.length) {
      messages.push({
        role: "assistant",
        content: turn.content || null,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      for (const call of turn.toolCalls) {
        try {
          let args: unknown;
          try {
            args = JSON.parse(call.arguments);
          } catch {
            options.trace?.recordToolCall({
              toolName: call.name,
              status: "failure",
              latencyMs: 0,
              errorCategory: "tool_validation",
            });
            throw new Error("Tool arguments were not valid JSON.");
          }
          let result = await executeTool(options.tools, call.name, args, { allowedSourcePaths, trace: options.trace });
          const search = searchBrainResultSchema.safeParse(result);
          if (call.name === "search_brain" && search.success) {
            const known = new Map(evidence.map((source) => [evidenceKey(source), source]));
            const current = search.data.evidence.map((source) => {
              const key = evidenceKey(source);
              const existing = known.get(key);
              if (existing) return existing;
              const added = { ...source, id: `S${evidence.length + 1}` };
              evidence.push(added);
              known.set(key, added);
              return added;
            });
            retrievalMode = search.data.retrievalMode;
            current.forEach((source) => {
              allowedSourcePaths.add(source.path);
              findPromptInjectionSignals(source.excerpt).forEach((signal) => injectionSignals.add(signal));
            });
            result = { ...search.data, evidence: current };
          } else if (call.name === "read_source" && result && typeof result === "object" && "text" in result) {
            findPromptInjectionSignals(String(result.text)).forEach((signal) => injectionSignals.add(signal));
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
          steps.push({ type: "tool", step, toolName: call.name, status: "success" });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Tool execution failed.";
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: message }) });
          steps.push({ type: "tool", step, toolName: call.name, status: "error", error: message });
        }
      }
      continue;
    }

    if (!evidence.length) {
      options.trace?.recordError("insufficient_evidence", "answer_validation");
      return finish(REFUSAL, true);
    }
    const quality = validateAnswer(turn.content, evidence);
    if (quality.acceptable) return finish(turn.content, quality.refusal);
    if (!repairAttempted && step < maxSteps) {
      repairAttempted = true;
      options.trace?.recordQualityRepair();
      options.trace?.recordError("citation_invalid", "answer_validation");
      messages.push({ role: "assistant", content: turn.content });
      messages.push({ role: "user", content: CITATION_REPAIR_PROMPT });
      continue;
    }
    options.trace?.recordError("citation_invalid", "answer_validation");
    return finish(REFUSAL, true);
  }

  options.trace?.recordError("max_steps", "agent_loop");
  return finish("I stopped because the agent reached its maximum step limit without a supported answer.", true);
}

function evidenceKey(source: EvidenceRecord) {
  return `${source.path}\0${source.heading}\0${source.page ?? ""}`;
}
