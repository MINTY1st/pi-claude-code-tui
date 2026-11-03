import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { prepareFrames } from "../src/transcript.ts";

function history(ids: string[]): Message[] {
  return [
    { role: "user", content: "inspect", timestamp: 0 },
    {
      role: "assistant", provider: "openai", api: "openai-responses", model: "example",
      content: ids.map((id) => ({ type: "toolCall", id, name: "read", arguments: { path: "example.txt" } })),
      usage: {
        input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse", timestamp: 1,
    } satisfies AssistantMessage,
    ...ids.map((id): Message => ({
      role: "toolResult", toolCallId: id, toolName: "read",
      content: [{ type: "text", text: "ok" }], isError: false, timestamp: 2,
    })),
  ];
}

function wireIds(messages: Message[]) {
  const blocks = prepareFrames(messages).flatMap((frame) => frame.message.content) as Array<Record<string, unknown>>;
  return {
    calls: blocks.filter((block) => block.type === "tool_use").map((block) => block.id),
    results: blocks.filter((block) => block.type === "tool_result").map((block) => block.tool_use_id),
  };
}

test("GPT由来のIDをAnthropic形式へ変換し、結果の参照先も一致させる", () => {
  const messages = history(["call_example|ctc_example"]);
  const before = structuredClone(messages);
  const { calls, results } = wireIds(messages);
  assert.match(String(calls[0]), /^[a-zA-Z0-9_-]+$/);
  assert.deepEqual(results, calls);
  assert.deepEqual(messages, before, "保存済みの履歴を変更しない");
});

test("異なるIDは変換後も衝突せず、有効な既存IDは変更しない", () => {
  const messages = history(["a|b", "a?b", "a_b"]);
  const { calls, results } = wireIds(messages);
  assert.equal(new Set(calls).size, 3);
  assert.equal(calls[2], "a_b");
  assert.deepEqual(results, calls);
  assert.deepEqual(wireIds(messages).calls, calls, "再送しても同じIDにする");
});

test("変換先と同じ既存IDが履歴の後ろにあっても衝突しない", () => {
  const invalid = "call_reserved|ctc_reserved";
  const reserved = String(wireIds(history([invalid])).calls[0]);
  const messages = history([invalid, reserved]);
  const { calls, results } = wireIds(messages);
  assert.equal(calls[1], reserved);
  assert.notEqual(calls[0], reserved);
  assert.deepEqual(results, calls);
});

for (const id of ["", "日本語/ID", "x".repeat(65), "call_" + "x".repeat(150) + "|ctc_tail"]) {
  test(`空文字・非ASCII・長いIDを有効なIDへ変換する: ${id.slice(0, 20)}`, () => {
    const { calls, results } = wireIds(history([id]));
    assert.match(String(calls[0]), /^[a-zA-Z0-9_-]{1,64}$/);
    assert.deepEqual(results, calls);
  });
}
