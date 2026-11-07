import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { lazyStream, normalizeContext, type Model } from "@earendil-works/pi-ai";
import { CLAUDE_CODE_MODELS } from "../src/model-catalog.ts";
import { createClaudeCodeProvider } from "../src/provider.ts";
import { TuiSession } from "../src/pty-session.ts";
import { streamClaudeCode } from "../src/stream.ts";
import { closeTuiProcesses } from "../src/tui-process.ts";

const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const model = CLAUDE_CODE_MODELS[0] as Model<any>;
const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 1 }] });
const authContext = { env: async () => undefined, fileExists: async () => false };

function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}

test("Pi が中断済みの signal で要求を始めても、aborted・This operation was aborted として記録する（2026-11-07 に error と記録された）", async () => {
  const signal = abortedSignal();
  const provider = createClaudeCodeProvider();
  // pi-ai の ModelRuntime.streamSimple と同じく、認証の解決を lazyStream の setup の中で行う
  const stream = lazyStream(model, async () => {
    await provider.auth.apiKey!.resolve!({ ctx: authContext, signal } as never);
    return streamClaudeCode(model, context, { signal });
  });
  const message = await stream.result();
  assert.equal(message.stopReason, "aborted");
  assert.equal(message.errorMessage, "This operation was aborted");
});

test("Pi の signal で中断した要求は aborted として記録する", async () => {
  const message = await streamClaudeCode(model, context, { signal: abortedSignal() }).result();
  assert.equal(message.stopReason, "aborted");
});

// stream.ts は upstreamUrl を渡さないため、貼り付けを TUI に届ける前に片付けて、本物の API へ要求を出さない
async function abortDuring(testContext: TestContext, method: "ready" | "submit", sessionId: string) {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const original = TuiSession.prototype[method] as (this: TuiSession, argument?: never) => Promise<void>;
  testContext.mock.method(TuiSession.prototype, method, async function (this: TuiSession, argument?: never) {
    entered.resolve();
    await gate.promise;
    return original.call(this, argument);
  });
  const signal = new AbortController().signal;
  const environment = { PI_CLAUDE_CODE_COMMAND: fakeClaude, PI_CLAUDE_CODE_TUI_TRUST: "1" };
  const result = streamClaudeCode(model, context, { signal, sessionId, env: environment } as never).result();
  await entered.promise;
  const closing = closeTuiProcesses(sessionId);
  gate.resolve();
  await closing;
  return { signal, message: await result };
}

test("Pi の signal が生きたまま起動中にセッションを片付けた要求も、aborted として記録する", async (testContext) => {
  const { signal, message } = await abortDuring(testContext, "ready", "stream-abort-ready");
  assert.equal(signal.aborted, false);
  assert.equal(message.stopReason, "aborted");
  assert.equal(message.errorMessage, "Claude Code TUI session was closed");
});

test("Pi の signal が生きたままターン中にセッションを片付けた要求も、「Claude Code ended」ではなく aborted として記録する", async (testContext) => {
  const { signal, message } = await abortDuring(testContext, "submit", "stream-abort-turn");
  assert.equal(signal.aborted, false);
  assert.equal(message.stopReason, "aborted");
  assert.equal(message.errorMessage, "Claude Code TUI session was closed");
});

test("反例: 中断でない失敗（Claude Code が見つからない）は error のまま記録する", async () => {
  const environment = { PI_CLAUDE_CODE_COMMAND: "/nonexistent/claude" };
  const message = await streamClaudeCode(model, context, { signal: new AbortController().signal, env: environment } as never).result();
  assert.equal(message.stopReason, "error");
  assert.match(message.errorMessage ?? "", /not installed/);
});
