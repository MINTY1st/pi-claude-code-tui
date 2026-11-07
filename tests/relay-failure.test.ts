import assert from "node:assert/strict";
import test from "node:test";
import { isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";
import { describeUsageCreditsRejection, usageCreditsChargeError } from "../src/billing.ts";
import {
  CaptureError,
  describeError,
  incompleteUpstreamMessage,
  isTransientRelayFailure,
  relayFailure,
  type RelayFailure,
  type RelayOutcome,
} from "../src/relay-failure.ts";
import { normalizeError } from "../src/stream.ts";

// Pi 本体（AgentSession._isRetryableError）と同じ判定を、stream.ts が作る errorMessage に対して行う
function retryable(message: string): boolean {
  return isRetryableAssistantError({ stopReason: "error", errorMessage: normalizeError(new Error(message)) } as AssistantMessage);
}

function coded(message: string, code: string | number): Error {
  return Object.assign(new Error(message), { code });
}

function outcome(input: { status?: number; failure?: RelayFailure; denied?: number; errorText?: string; complete?: boolean }): RelayOutcome {
  return {
    status: input.status,
    failure: input.failure,
    denied: input.denied ?? 0,
    capture: { complete: input.complete ?? false },
    errorText: () => input.errorText ?? "",
  };
}

const refused = Object.assign(
  new AggregateError(
    [coded("connect ECONNREFUSED 160.79.104.10:443", "ECONNREFUSED"), coded("connect ECONNREFUSED 2607:6bc0::10:443", "ECONNREFUSED")],
    "",
  ),
  { code: "ECONNREFUSED" },
);

test("describeError は name・code・message を残す", () => {
  assert.equal(describeError(coded("aborted", "ECONNRESET")), "Error [ECONNRESET]: aborted");
  assert.equal(describeError(coded("bad", 42)), "Error [42]: bad");
  assert.equal(describeError(new TypeError("")), "TypeError");
  assert.equal(describeError("boom"), "boom");
});

test("describeError は AggregateError の中の errors を1段だけ並べる", () => {
  assert.equal(
    describeError(refused),
    "AggregateError [ECONNREFUSED] (errors: Error [ECONNREFUSED]: connect ECONNREFUSED 160.79.104.10:443; Error [ECONNREFUSED]: connect ECONNREFUSED 2607:6bc0::10:443)",
  );
  assert.equal(describeError(new AggregateError([], "none")), "AggregateError: none");
});

test("describeError は1000文字で切り、超えたときだけ末尾に … を付ける", () => {
  const exact = new Error("x".repeat(1_000 - "Error: ".length));
  assert.equal(describeError(exact).length, 1_000);
  assert.ok(!describeError(exact).endsWith("…"));
  const long = describeError(new Error("x".repeat(2_000)));
  assert.equal(long.length, 1_001);
  assert.ok(long.endsWith("…"));
});

test("CaptureError は元の例外を cause に持ち、message に元の記述を含める", () => {
  const original = new Error("Claude Code returned unavailable tool foo");
  const error = new CaptureError(original);
  assert.equal(error.name, "CaptureError");
  assert.equal(error.cause, original);
  assert.equal(error.message, "Claude Code stream handling failed: Error: Claude Code returned unavailable tool foo");
});

test("relayFailure は summary に name と code、detail に全文を入れる", () => {
  assert.deepEqual(relayFailure("connect", refused), {
    kind: "connect",
    summary: "AggregateError [ECONNREFUSED]",
    detail: describeError(refused),
  });
  assert.deepEqual(relayFailure("request", "boom"), { kind: "request", summary: "UnknownError", detail: "boom" });
});

test("接続失敗は connection error を付け、Pi が再試行する", () => {
  const message = incompleteUpstreamMessage(outcome({ failure: relayFailure("connect", refused) }));
  assert.equal(
    message,
    `Claude Code upstream connection error: Incomplete Claude Code upstream response (status unknown, capture incomplete, relay failure ${describeError(refused)})`,
  );
  assert.equal(retryable(message), true);
});

test("status 200 と 5xx の切断は connection lost を付け、Pi が再試行する", () => {
  for (const status of [200, 500, 529]) {
    const message = incompleteUpstreamMessage(outcome({ status, failure: relayFailure("disconnect", coded("aborted", "ECONNRESET")) }));
    assert.ok(message.startsWith(`Claude Code upstream connection lost: Incomplete Claude Code upstream response (status ${status}, `));
    assert.match(message, /relay failure Error \[ECONNRESET\]: aborted/);
    assert.equal(retryable(message), true);
  }
});

test("4xx の本文読み取り中の切断は、message を出さず Pi も再試行しない", () => {
  for (const status of [400, 499]) {
    const message = incompleteUpstreamMessage(
      outcome({ status, failure: relayFailure("disconnect", coded("socket hang up", "ECONNRESET")), errorText: "prompt is invalid" }),
    );
    assert.equal(
      message,
      `Incomplete Claude Code upstream response (status ${status}, capture incomplete, relay failure Error [ECONNRESET], upstream said: prompt is invalid)`,
    );
    assert.equal(retryable(message), false);
  }
});

test("4xx の応答は文言を変えず Pi も再試行しない。429 は既存どおり再試行する", () => {
  const invalid = incompleteUpstreamMessage(outcome({ status: 400, errorText: "messages: text content blocks must be non-empty" }));
  assert.equal(invalid, "Incomplete Claude Code upstream response (status 400, capture incomplete, upstream said: messages: text content blocks must be non-empty)");
  assert.equal(retryable(invalid), false);
  assert.equal(retryable(incompleteUpstreamMessage(outcome({ status: 429, errorText: "Number of requests has exceeded your limit" }))), true);
});

test("onEvent と解析の例外は元の message を残し、Pi は再試行しない", () => {
  let parseError: unknown;
  try {
    JSON.parse('{"a":1,');
  } catch (error) {
    parseError = error;
  }
  for (const cause of [new Error("Claude Code returned unavailable tool foo"), parseError]) {
    const failure = relayFailure("capture", new CaptureError(cause));
    const message = incompleteUpstreamMessage(outcome({ status: 200, failure }));
    assert.ok(message.includes(describeError(cause)));
    assert.equal(isTransientRelayFailure({ status: 200, failure }), false);
    assert.equal(retryable(message), false);
  }
});

test("上流へ出す前の例外は元の message を残し、Pi は再試行しない", () => {
  const message = incompleteUpstreamMessage(outcome({ failure: relayFailure("request", new Error("PI_CLAUDE_CODE_BAD_TRANSCRIPT")) }));
  assert.equal(message, "Incomplete Claude Code upstream response (status unknown, capture incomplete, relay failure Error: PI_CLAUDE_CODE_BAD_TRANSCRIPT)");
  assert.equal(retryable(message), false);
});

test("失敗の記録が無い不完全応答は文言を変えない", () => {
  const message = incompleteUpstreamMessage(outcome({ status: 200 }));
  assert.equal(message, "Incomplete Claude Code upstream response (status 200, capture incomplete)");
  assert.equal(retryable(message), false);
  assert.equal(isTransientRelayFailure({ status: 200 }), false);
});

test("再送の拒否回数を出し、上流の本文は500文字で切る", () => {
  const message = incompleteUpstreamMessage(outcome({ status: 400, denied: 2, errorText: "y".repeat(600), complete: true }));
  assert.equal(message, `Incomplete Claude Code upstream response (status 400, capture complete, native retries denied 2, upstream said: ${"y".repeat(500)})`);
});

test("課金とツール一覧外の文言は Pi が再試行しない", () => {
  assert.equal(retryable(usageCreditsChargeError({ status: "allowed_warning", isUsingOverage: true }).message), false);
  assert.equal(retryable(describeUsageCreditsRejection("You're out of extra usage. Add more at claude.ai/settings/usage and keep going.")!), false);
  assert.equal(retryable("Claude Code returned a tool outside Pi's current tool inventory"), false);
});
