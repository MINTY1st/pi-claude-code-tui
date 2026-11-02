import assert from "node:assert/strict";
import test from "node:test";
import { rateLimitFromHeaders } from "../src/rate-limit-headers.ts";

const H = "anthropic-ratelimit-unified-";

// 2026-11-03 に対話 TUI 経由で実測したヘッダー（抜粋）
const observed = {
  [H + "status"]: "allowed_warning",
  [H + "representative-claim"]: "five_hour",
  [H + "reset"]: "1793645400",
  [H + "overage-status"]: "rejected",
  [H + "overage-disabled-reason"]: "org_level_disabled",
  [H + "5h-utilization"]: "0.93",
};

test("実測したヘッダーを rate_limit_event と同じ形に直す（allowed_warning は allowed に丸める）", () => {
  assert.deepEqual(rateLimitFromHeaders(observed), {
    status: "allowed",
    resetsAt: 1793645400,
    rateLimitType: "five_hour",
    overageStatus: "rejected",
    overageDisabledReason: "org_level_disabled",
    isUsingOverage: false,
  });
});

test("プラン枠が rejected で overage が allowed なら、使用量クレジットを使っている（Claude Code 2.1.316 と同じ式）", () => {
  const info = rateLimitFromHeaders({ [H + "status"]: "rejected", [H + "overage-status"]: "allowed" });
  assert.equal(info?.isUsingOverage, true);
  assert.equal(rateLimitFromHeaders({ [H + "status"]: "rejected", [H + "overage-status"]: "allowed_warning" })?.isUsingOverage, true);
});

test("プラン枠が rejected でも overage が rejected なら、使用量クレジットは使っていない", () => {
  assert.equal(rateLimitFromHeaders({ [H + "status"]: "rejected", [H + "overage-status"]: "rejected" })?.isUsingOverage, false);
});

test("unified 系のヘッダーが1つも無ければ undefined", () => {
  assert.equal(rateLimitFromHeaders({ "content-type": "text/event-stream" }), undefined);
});

test("配列で届いたヘッダーは先頭の値を使う", () => {
  assert.equal(rateLimitFromHeaders({ [H + "status"]: ["rejected", "x"], [H + "overage-status"]: ["allowed"] })?.isUsingOverage, true);
});
