import assert from "node:assert/strict";
import test from "node:test";
import { OpenAICompatibleModelClient } from "../src/model-client.js";
import { RunTraceRecorder, summarizeRuns } from "../src/run-history.js";

test("run traces aggregate metrics without retaining private input", () => {
  const privateQuestion = "What did I write about the confidential acquisition?";
  const trace = new RunTraceRecorder("answer", privateQuestion, {
    id: "agent-system",
    version: "1",
    hash: "prompt-hash",
  });

  trace.recordRetrieval(12, "bm25_fallback");
  trace.recordToolCall({ toolName: "search_brain", status: "success", latencyMs: 4 });
  trace.recordModelCall({
    kind: "chat",
    model: "local-model",
    status: "success",
    request: { hash: "request-hash", length: 10 },
    response: { hash: "response-hash", length: 12 },
    latencyMs: 20,
    retryCount: 1,
    usage: { input: 100, output: 25, total: 125, source: "reported" },
    costUsd: 0,
  });
  const run = trace.finish("success");

  assert.equal(run.inputLength, privateQuestion.length);
  assert.equal(run.retrievalMode, "bm25_fallback");
  assert.equal(run.fallbackUsed, true);
  assert.deepEqual(run.usage, { input: 100, output: 25, total: 125, source: "reported" });
  assert.equal(run.retries, 1);
  assert.equal(run.costUsd, 0);
  assert.equal(run.costStatus, "complete");
  assert.ok(!JSON.stringify(run).includes(privateQuestion));
  assert.deepEqual(summarizeRuns([run]), { total: 1, failureRate: 0, fallbackRate: 1, retryRate: 1 });
});

test("model client traces retry, tokens, latency, and configured cost", async () => {
  let attempts = 0;
  const trace = new RunTraceRecorder("answer", "private prompt");
  const client = new OpenAICompatibleModelClient({
    baseUrl: "https://example.test/v1",
    model: "paid-model",
    maxRetries: 1,
    retryDelayMs: 0,
    pricing: { "paid-model": { inputPerMillionUsd: 1, outputPerMillionUsd: 2 } },
    trace,
    fetchImpl: (async () => {
      attempts += 1;
      if (attempts === 1) return new Response("temporary", { status: 500 });
      return Response.json({
        choices: [{ message: { content: "Grounded answer [S1]." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    }) as typeof fetch,
  });

  const result = await client.complete([{ role: "user", content: "private prompt" }], []);
  const run = trace.finish("success");

  assert.equal(result.content, "Grounded answer [S1].");
  assert.equal(attempts, 2);
  assert.equal(run.calls[0]?.retryCount, 1);
  assert.equal(run.calls[0]?.request.length > 0, true);
  assert.equal(run.calls[0]?.response?.length > 0, true);
  assert.deepEqual(run.usage, { input: 10, output: 5, total: 15, source: "reported" });
  assert.equal(run.costUsd, 0.00002);
  assert.ok((run.calls[0]?.latencyMs ?? -1) >= 0);
  assert.ok(!JSON.stringify(run).includes("private prompt"));
});
