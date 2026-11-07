import assert from "node:assert/strict";
import * as http from "node:http";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { agentLoop, type AgentContext, type AgentTool } from "@earendil-works/pi-agent-core";
import { normalizeContext, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { CLAUDE_CODE_MODELS } from "../src/model-catalog.ts";
import type { NativeContentBlock } from "../src/native-types.ts";
import { streamClaudeCode } from "../src/stream.ts";
import { piToolName } from "../src/tool-config.ts";
import { closeTuiProcesses } from "../src/tui-process.ts";
import { TurnRelay } from "../src/turn-relay.ts";

const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const model = CLAUDE_CODE_MODELS[0] as Model<any>;
const environment = { PI_CLAUDE_CODE_COMMAND: fakeClaude, PI_CLAUDE_CODE_TUI_TRUST: "1" };
const usage = { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

const readTool: AgentTool = {
  name: "read",
  label: "read",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } } },
  execute: async () => ({ content: [{ type: "text", text: "read result" }], details: {} }),
};

interface Upstream { bodies: Array<Record<string, any>>; close: () => void }

function sse(block: NativeContentBlock): string {
  const events = [
    { type: "message_start", message: { id: "m1", role: "assistant", content: [], usage } },
    { type: "content_block_start", index: 0, content_block: block.type === "text" ? { type: "text", text: "" } : block },
    ...(block.type === "text" ? [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: block.text } }] : []),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: block.type === "tool_use" ? "tool_use" : "end_turn" }, usage },
    { type: "message_stop" },
  ];
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

// stream.ts は upstreamUrl を渡さないため、TurnRelay の上流をこのフェイクへ向け、本物の API へ要求を出さない
async function fakeUpstream(testContext: TestContext, replies: NativeContentBlock[]): Promise<Upstream> {
  const bodies: Array<Record<string, any>> = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(sse(replies[Math.min(bodies.length, replies.length) - 1]!));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = new URL(`http://127.0.0.1:${(server.address() as { port: number }).port}`);
  const original = TurnRelay.prototype.start;
  testContext.mock.method(TurnRelay.prototype, "start", function (this: TurnRelay) {
    (this as unknown as { upstream: URL }).upstream = url;
    return original.call(this);
  });
  return { bodies, close: () => server.close() };
}

function piContext(tools: AgentTool[]) {
  return normalizeContext({ messages: [{ role: "user", content: "書いて", timestamp: 1 }], tools });
}

async function streamOnce(testContext: TestContext, block: NativeContentBlock, sessionId: string): Promise<AssistantMessage> {
  const upstream = await fakeUpstream(testContext, [block]);
  try {
    return await streamClaudeCode(model, piContext([readTool]), { sessionId, env: environment } as never).result();
  } finally {
    await closeTuiProcesses();
    upstream.close();
  }
}

function toolCallNames(message: AssistantMessage): string[] {
  return message.content.flatMap((block) => (block.type === "toolCall" ? [block.name] : []));
}

test("境界値: piToolName は先頭の mcp__pi__ を1回だけ外し、それ以外の名前は大文字小文字も含めてそのまま返す", () => {
  assert.equal(piToolName("mcp__pi__read"), "read");
  assert.equal(piToolName("write"), "write");
  assert.equal(piToolName("Write"), "Write");
  assert.equal(piToolName("mcp__other__x"), "mcp__other__x");
  assert.equal(piToolName("x_mcp__pi__read"), "x_mcp__pi__read");
  assert.equal(piToolName("mcp__pi__mcp__pi__x"), "mcp__pi__x");
  assert.equal(piToolName("mcp__pi__"), "");
  assert.equal(piToolName(""), "");
});

test("接頭辞 mcp__pi__ の無いツール名（2026-11-07 の実測では write）は、例外にせずその名前の toolCall として返す", async (testContext) => {
  const message = await streamOnce(testContext, { type: "tool_use", id: "toolu_write", name: "write", input: { path: "a.md" } }, "unknown-tool-bare");
  assert.equal(message.stopReason, "toolUse");
  assert.equal(message.errorMessage, undefined);
  assert.deepEqual(toolCallNames(message), ["write"]);
});

test("Pi のツール一覧に無いツール名は、接頭辞を外した名前の toolCall として返す", async (testContext) => {
  const message = await streamOnce(testContext, { type: "tool_use", id: "toolu_unknown", name: "mcp__pi__unknown", input: {} }, "unknown-tool-missing");
  assert.equal(message.stopReason, "toolUse");
  assert.deepEqual(toolCallNames(message), ["unknown"]);
});

test("Pi のツール一覧にあるツール名の扱いは変わらない", async (testContext) => {
  const message = await streamOnce(testContext, { type: "tool_use", id: "toolu_read", name: "mcp__pi__read", input: { path: "a.md" } }, "unknown-tool-known");
  assert.equal(message.stopReason, "toolUse");
  const call = message.content.find((block) => block.type === "toolCall");
  assert.deepEqual(call && { id: call.id, name: call.name, arguments: call.arguments }, { id: "toolu_read", name: "read", arguments: { path: "a.md" } });
});

test("Pi の agent loop を通すと、一覧に無いツールはエラーのツール結果になり、次の要求でモデルに渡る", async (testContext) => {
  const upstream = await fakeUpstream(testContext, [
    { type: "tool_use", id: "toolu_write", name: "write", input: { path: "a.md" } },
    { type: "text", text: "わかった" },
  ]);
  try {
    const context: AgentContext = { messages: [{ role: "user", content: "書いて", timestamp: 1 }], tools: [readTool] };
    const config = { model, convertToLlm: (messages: never[]) => messages, sessionId: "unknown-tool-loop", env: environment };
    const messages = await agentLoop([], context, config as never, undefined, streamClaudeCode).result();
    const toolResult = messages.find((message) => message.role === "toolResult");
    assert.deepEqual(toolResult && { name: toolResult.toolName, isError: toolResult.isError, content: toolResult.content }, {
      name: "write",
      isError: true,
      content: [{ type: "text", text: "Tool write not found" }],
    });
    assert.equal(upstream.bodies.length, 2);
    const sent = upstream.bodies[1]!.messages.flatMap((message: { content: unknown }) => (Array.isArray(message.content) ? message.content : []));
    const result = sent.find((block: { type?: string }) => block.type === "tool_result");
    assert.equal(result?.tool_use_id, "toolu_write");
    assert.equal(result?.is_error, true);
    assert.match(JSON.stringify(result?.content), /Tool write not found/);
    assert.equal((messages.at(-1) as AssistantMessage).stopReason, "stop");
  } finally {
    await closeTuiProcesses();
    upstream.close();
  }
});
