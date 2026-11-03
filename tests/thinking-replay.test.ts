import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { withoutForeignThinking } from "../src/thinking-replay.ts";

function withThinking(api: string): AssistantMessage {
  return {
    role: "assistant", provider: "example", api, model: "example",
    content: [{ type: "thinking", thinking: "reasoning", thinkingSignature: "signature" }, { type: "text", text: "answer" }],
    usage: {
      input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop", timestamp: 1,
  };
}

test("Anthropicの思考ブロックは署名ごと残す", () => {
  const message = withThinking("anthropic-messages");
  assert.equal(withoutForeignThinking(message), message);
});

test("他社APIの思考ブロックだけを除き、元のメッセージは変更しない", () => {
  const message = withThinking("openai-responses");
  const before = structuredClone(message);
  assert.deepEqual(withoutForeignThinking(message).content, [{ type: "text", text: "answer" }]);
  assert.deepEqual(message, before);
});
