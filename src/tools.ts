import * as z from "zod/v4";
import {
  readSourceArgsSchema,
  readSourceResultSchema,
  searchBrainArgsSchema,
  searchBrainResultSchema,
  type ReadSourceArgs,
  type ReadSourceResult,
  type SearchBrainArgs,
  type SearchBrainResult,
  type ToolPermission,
} from "./contracts.js";
import type { ErrorCategory, RunTraceRecorder } from "./run-history.js";

export class ToolExecutionError extends Error {
  constructor(public readonly code: "unknown_tool" | "invalid_arguments" | "permission_denied" | "invalid_result", message: string) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

export interface ToolDefinition {
  name: string;
  description: string;
  permission: ToolPermission;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  execute: (args: never) => Promise<unknown>;
}

export interface ToolCapabilities {
  searchBrain: (args: SearchBrainArgs) => Promise<SearchBrainResult>;
  readSource: (args: ReadSourceArgs) => Promise<ReadSourceResult>;
}

export interface ToolExecutionContext {
  allowedSourcePaths?: ReadonlySet<string>;
  approveWrite?: (request: { toolName: string; args: unknown }) => Promise<boolean>;
  trace?: RunTraceRecorder;
}

export function createReadOnlyTools(capabilities: ToolCapabilities): ToolDefinition[] {
  return [
    {
      name: "search_brain",
      description: "Search the Obsidian vault. Search corpus=wiki first for reviewed memory, then corpus=sources when raw evidence is absent or needs verification. Use corpus=all only for broad retrieval.",
      permission: "read",
      inputSchema: searchBrainArgsSchema,
      outputSchema: searchBrainResultSchema,
      execute: capabilities.searchBrain as (args: never) => Promise<unknown>,
    },
    {
      name: "read_source",
      description: "Read an allowlisted source inside the configured vault. In an agent run, search_brain must return the source path before it can be read.",
      permission: "read",
      inputSchema: readSourceArgsSchema,
      outputSchema: readSourceResultSchema,
      execute: capabilities.readSource as (args: never) => Promise<unknown>,
    },
  ];
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.inputSchema, { target: "draft-7" }),
    },
  }));
}

export async function executeTool(
  tools: ToolDefinition[],
  toolName: string,
  rawArgs: unknown,
  context: ToolExecutionContext = {},
) {
  const started = performance.now();
  try {
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new ToolExecutionError("unknown_tool", `Unknown tool: ${toolName}`);

    const parsed = tool.inputSchema.safeParse(rawArgs);
    if (!parsed.success) throw new ToolExecutionError("invalid_arguments", z.prettifyError(parsed.error));

    if (tool.permission === "write") {
      const approved = context.approveWrite ? await context.approveWrite({ toolName, args: parsed.data }) : false;
      if (!approved) throw new ToolExecutionError("permission_denied", `Write tool ${toolName} requires human approval.`);
    }

    if (tool.name === "read_source" && context.allowedSourcePaths) {
      const sourcePath = (parsed.data as ReadSourceArgs).sourcePath;
      if (!context.allowedSourcePaths.has(sourcePath)) {
        throw new ToolExecutionError("permission_denied", "read_source may only open paths returned by search_brain in this run.");
      }
    }

    const result = await tool.execute(parsed.data as never);
    const checked = tool.outputSchema.safeParse(result);
    if (!checked.success) throw new ToolExecutionError("invalid_result", `Tool ${toolName} returned invalid data.`);
    context.trace?.recordToolCall({ toolName, status: "success", latencyMs: performance.now() - started });
    return checked.data;
  } catch (error) {
    context.trace?.recordToolCall({
      toolName,
      status: "failure",
      latencyMs: performance.now() - started,
      errorCategory: toolErrorCategory(error),
    });
    throw error;
  }
}

function toolErrorCategory(error: unknown): ErrorCategory {
  if (!(error instanceof ToolExecutionError)) return "tool_failure";
  if (error.code === "permission_denied") return "tool_permission";
  if (error.code === "invalid_arguments" || error.code === "unknown_tool") return "tool_validation";
  return "tool_failure";
}
