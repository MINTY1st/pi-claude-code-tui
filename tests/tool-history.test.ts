import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, Message, ToolCall } from "@earendil-works/pi-ai";
import { repairToolHistory } from "../src/tool-history.ts";

function assistant(stopReason: AssistantMessage["stopReason"], calls: string[]): AssistantMessage {
  return {
    role: "assistant", provider: "openai", api: "openai-responses", model: "example",
    content: calls.map((id): ToolCall => ({ type: "toolCall", id, name: "read", arguments: {} })),
    usage: {
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason, timestamp: 1,
  };
}

const user = (content: string): Message => ({ role: "user", content, timestamp: 0 });
const result = (id: string): Message => ({
  role: "toolResult", toolCallId: id, toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 2,
});

test("中断・失敗したアシスタント応答は履歴から除く", () => {
  const repaired = repairToolHistory([user("a"), assistant("aborted", ["call_a"]), assistant("error", ["call_e"]), user("b")]);
  assert.deepEqual(repaired.map((message) => message.role), ["user", "user"]);
});

test("結果のないツール呼び出しには次のユーザー発言の前にエラー結果を補う", () => {
  const repaired = repairToolHistory([user("a"), assistant("toolUse", ["call_1", "call_2"]), result("call_1"), user("b")]);
  assert.deepEqual(repaired.map((message) => message.role), ["user", "assistant", "toolResult", "toolResult", "user"]);
  const synthetic = repaired[3] as Extract<Message, { role: "toolResult" }>;
  assert.equal(synthetic.toolCallId, "call_2");
  assert.equal(synthetic.isError, true);
});

test("整合している履歴はそのまま残し、入力も変更しない", () => {
  const messages = [user("a"), assistant("toolUse", ["call_1"]), result("call_1"), user("b")];
  const before = structuredClone(messages);
  assert.deepEqual(repairToolHistory(messages), before);
  assert.deepEqual(messages, before);
});
