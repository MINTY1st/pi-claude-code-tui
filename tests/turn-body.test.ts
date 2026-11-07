import assert from "node:assert/strict";
import test from "node:test";
import { applyTurnBody, launchIdentity, turnBodyOf } from "../src/turn-body.ts";

const thinkingOn = { tools: [], max_tokens: 4096, thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "high" } };
const thinkingOff = { tools: [], thinking: { type: "disabled" }, context_management: { edits: [] } };

function sent(body: Record<string, unknown>, turn: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(applyTurnBody(Buffer.from(JSON.stringify(body)), turn).toString("utf8")) as Record<string, unknown>;
}

test("turnBodyOf は output_config と context_management だけを取り出し、ほかのキーは含めない", () => {
  assert.deepEqual(turnBodyOf(thinkingOn), { output_config: { effort: "high" } });
  assert.deepEqual(turnBodyOf(thinkingOff), { context_management: { edits: [] } });
  assert.deepEqual(turnBodyOf({ tools: [], max_tokens: 1 }), {});
});

test("境界値: 値が undefined のキーは無いものとして扱う（settings.json の JSON に出ないため）", () => {
  assert.deepEqual(turnBodyOf({ output_config: undefined, context_management: undefined }), {});
  assert.deepEqual(launchIdentity({ output_config: undefined }).turnKeys, []);
});

test("turnBodyOf の戻り値は extraBody と参照を共有しない", () => {
  const extraBody = { output_config: { effort: "high" } };
  const turn = turnBodyOf(extraBody);
  extraBody.output_config.effort = "low";
  assert.deepEqual(turn, { output_config: { effort: "high" } });
});

test("launchIdentity は2つのキーの値を外し、キーの有無だけを turnKeys に残す", () => {
  assert.deepEqual(launchIdentity(thinkingOn), { body: { tools: [], max_tokens: 4096, thinking: { type: "adaptive", display: "summarized" } }, turnKeys: ["output_config"] });
  assert.deepEqual(launchIdentity(thinkingOff), { body: { tools: [], thinking: { type: "disabled" } }, turnKeys: ["context_management"] });
});

test("effort だけが違う extraBody は launchIdentity が一致し、thinking や max_tokens が違えば一致しない", () => {
  const low = { ...thinkingOn, output_config: { effort: "low" } };
  assert.deepEqual(launchIdentity(low), launchIdentity(thinkingOn));
  assert.notDeepEqual(launchIdentity({ ...thinkingOn, thinking: { type: "disabled" } }), launchIdentity(thinkingOn));
  assert.notDeepEqual(launchIdentity({ ...thinkingOn, max_tokens: 8192 }), launchIdentity(thinkingOn));
});

test("反例: output_config の有無が違えば、値を外しても launchIdentity は一致しない", () => {
  const { output_config: _omitted, ...without } = thinkingOn;
  assert.notDeepEqual(launchIdentity(without), launchIdentity(thinkingOn));
});

test("launchIdentity は引数の extraBody を書き換えない", () => {
  const extraBody = structuredClone(thinkingOn);
  launchIdentity(extraBody);
  assert.deepEqual(extraBody, thinkingOn);
});

test("applyTurnBody は Claude Code が付けた同名のキーを中身を混ぜずに丸ごと置き換える", () => {
  const body = { model: "m", output_config: { effort: "xhigh", format: { type: "json" } }, context_management: { edits: [{ type: "clear_thinking_20251015" }] } };
  const result = sent(body, { output_config: { effort: "low" }, context_management: { edits: [] } });
  assert.deepEqual(result.output_config, { effort: "low" });
  assert.deepEqual(result.context_management, { edits: [] });
});

test("applyTurnBody はターンに無いキーと messages・thinking・max_tokens・model には触らない", () => {
  const body = { model: "m", max_tokens: 32000, thinking: { type: "adaptive" }, messages: [{ role: "user", content: "x" }], output_config: { effort: "high" }, context_management: { edits: [{ type: "clear_thinking_20251015" }] } };
  const result = sent(body, { output_config: { effort: "medium" } });
  assert.deepEqual(result, { ...body, output_config: { effort: "medium" } });
});

test("反例: Claude Code が本文から落としたキーは足さない（変更前も上流へ送っていなかった）", () => {
  const body = { model: "m", messages: [] };
  assert.deepEqual(sent(body, { output_config: { effort: "low" }, context_management: { edits: [] } }), body);
});

test("ターンに書くキーが無ければ、本文を解析せず同じ Buffer をそのまま返す", () => {
  const body = Buffer.from("not json");
  assert.equal(applyTurnBody(body, {}), body);
});

test("本文が JSON のオブジェクトでなければエラーにする", () => {
  for (const text of ["[]", "null", "1"]) {
    assert.throws(() => applyTurnBody(Buffer.from(text), { output_config: { effort: "low" } }), /must be a JSON object/);
  }
  assert.throws(() => applyTurnBody(Buffer.from("{"), { output_config: { effort: "low" } }), SyntaxError);
});

test("applyTurnBody はターンの値と参照を共有せず、続けて呼んでも前の本文の値が混ざらない", () => {
  const turn = { output_config: { effort: "low" } };
  const first = sent({ model: "m", output_config: { effort: "xhigh" } }, turn);
  turn.output_config.effort = "high";
  const second = sent({ model: "m", output_config: { effort: "xhigh" } }, turn);
  assert.deepEqual([first.output_config, second.output_config], [{ effort: "low" }, { effort: "high" }]);
});
