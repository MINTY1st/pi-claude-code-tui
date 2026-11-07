import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";
import { ALLOW_USAGE_CREDITS_ENV, guardUsageCredits, usageCreditsChargeError, type RateLimitInfo } from "../src/billing.ts";
import type { NativeMessage, NativeUsage } from "../src/native-types.ts";
import { incompleteUpstreamMessage, relayFailure } from "../src/relay-failure.ts";
import { capturedMessage, completeUsage, type CapturedOutcome } from "../src/response-checks.ts";

const message: NativeMessage = { role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };

function outcome(overrides: Partial<CapturedOutcome> = {}, upstreamText = ""): CapturedOutcome {
  return { status: 200, denied: 0, capture: { complete: true, message }, errorText: () => upstreamText, ...overrides };
}

function thrown(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  assert.fail("例外が投げられなかった");
}

function retryable(text: string): boolean {
  return isRetryableAssistantError({ stopReason: "error", errorMessage: text } as AssistantMessage);
}

test("capturedMessage は 200 で最後まで受け取った応答の message を、そのまま（同じ参照で）返す", () => {
  assert.equal(capturedMessage(outcome()), message);
});

test("capturedMessage は 200 でも message_stop まで届いていなければ、incompleteUpstreamMessage の文言で投げる", () => {
  const partial = outcome({ capture: { complete: false, message } });
  assert.equal(thrown(() => capturedMessage(partial)).message, "Incomplete Claude Code upstream response (status 200, capture incomplete)");
});

test("capturedMessage は 4xx を受け取り終えていても投げ、上流の文言を載せる", () => {
  const rejected = outcome({ status: 400 }, "prompt is too long");
  assert.equal(
    thrown(() => capturedMessage(rejected)).message,
    "Incomplete Claude Code upstream response (status 400, capture complete, upstream said: prompt is too long)",
  );
});

test("境界値: capturedMessage は complete でも message が無ければ投げる", () => {
  const empty = outcome({ capture: { complete: true } });
  assert.equal(thrown(() => capturedMessage(empty)).message, "Incomplete Claude Code upstream response (status 200, capture complete)");
});

test("境界値: capturedMessage は status が無い（上流へ届かなかった）とき status unknown として投げる", () => {
  const unsent = outcome({ status: undefined, capture: { complete: false } });
  assert.match(thrown(() => capturedMessage(unsent)).message, /\(status unknown, capture incomplete\)/u);
});

test("capturedMessage の文言は incompleteUpstreamMessage と同じで、接続失敗なら Pi が再試行する文言になる", () => {
  const refused = outcome({ status: undefined, capture: { complete: false }, failure: relayFailure("connect", new Error("ECONNREFUSED")) });
  const text = thrown(() => capturedMessage(refused)).message;
  assert.equal(text, incompleteUpstreamMessage(refused));
  assert.ok(text.startsWith("Claude Code upstream connection error: "));
  assert.equal(retryable(text), true);
});

test("4xx でデータが変わらない: capturedMessage は投げても渡された結果を書き換えない", () => {
  const rejected = outcome({ status: 400, denied: 2, capture: { complete: true, message } }, "bad request");
  const before = structuredClone({ status: rejected.status, denied: rejected.denied, capture: rejected.capture });
  thrown(() => capturedMessage(rejected));
  assert.deepEqual({ status: rejected.status, denied: rejected.denied, capture: rejected.capture }, before);
});

test("completeUsage は input_tokens と output_tokens が数なら、同じ usage をそのまま返す", () => {
  const usage: NativeUsage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 };
  assert.equal(completeUsage(usage), usage);
});

test("completeUsage は usage が無ければ投げる", () => {
  assert.equal(thrown(() => completeUsage(undefined)).message, "Claude Code response did not include complete token usage");
});

test("completeUsage は input_tokens か output_tokens の片方が欠けているか数でなければ投げる", () => {
  const missingOutput = { input_tokens: 1 } as unknown as NativeUsage;
  const textInput = { input_tokens: "1", output_tokens: 1 } as unknown as NativeUsage;
  assert.equal(thrown(() => completeUsage(missingOutput)).message, "Claude Code response did not include complete token usage");
  assert.equal(thrown(() => completeUsage(textInput)).message, "Claude Code response did not include complete token usage");
});

test("境界値: completeUsage は 0 トークンを欠けとみなさずに通す", () => {
  const zero: NativeUsage = { input_tokens: 0, output_tokens: 0 };
  assert.equal(completeUsage(zero), zero);
});

test("guardUsageCredits は rateLimit が無いか、プラン枠の内なら何もしない", () => {
  assert.doesNotThrow(() => guardUsageCredits(undefined, {}));
  assert.doesNotThrow(() => guardUsageCredits({ status: "allowed", isUsingOverage: false }, {}));
});

test("guardUsageCredits は使用量クレジットで払われた応答を、再試行されない billing の文言で止める", () => {
  const charged: RateLimitInfo = { status: "allowed_warning", rateLimitType: "five_hour", isUsingOverage: true };
  const error = thrown(() => guardUsageCredits(charged, {}));
  assert.equal(error.message, usageCreditsChargeError(charged).message);
  assert.equal(retryable(error.message), false);
});

test("権限: guardUsageCredits は許可の環境変数が有効なら止めず、0 なら止める", () => {
  const charged: RateLimitInfo = { status: "allowed_warning", isUsingOverage: true };
  assert.doesNotThrow(() => guardUsageCredits(charged, { [ALLOW_USAGE_CREDITS_ENV]: "1" }));
  assert.throws(() => guardUsageCredits(charged, { [ALLOW_USAGE_CREDITS_ENV]: "0" }), /Claude Code billing/u);
});

test("境界値: guardUsageCredits は isUsingOverage が true そのもののときだけ止める", () => {
  assert.doesNotThrow(() => guardUsageCredits({ isUsingOverage: "true" as unknown as boolean }, {}));
});

test("反例: guardUsageCredits は process.env を読まず、渡された env だけで決める", () => {
  const saved = process.env[ALLOW_USAGE_CREDITS_ENV];
  process.env[ALLOW_USAGE_CREDITS_ENV] = "1";
  try {
    assert.throws(() => guardUsageCredits({ isUsingOverage: true }, {}), /Claude Code billing/u);
  } finally {
    if (saved === undefined) delete process.env[ALLOW_USAGE_CREDITS_ENV];
    else process.env[ALLOW_USAGE_CREDITS_ENV] = saved;
  }
});
