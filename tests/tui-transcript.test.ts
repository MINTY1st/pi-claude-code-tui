import assert from "node:assert/strict";
import test from "node:test";
import { replaceTranscript } from "../src/tui-transcript.ts";
import type { NativeFrame } from "../src/native-types.ts";

const reminder = { type: "text", text: "<system-reminder>\naccount context\n</system-reminder>" };
const environment = { role: "system", content: [{ type: "text", text: "# Environment", cache_control: { type: "ephemeral", ttl: "1h" } }] };

// /clear の直後に TUI が送る本文の形（スパイクの実測から）
function tuiBody(extra: Record<string, unknown> = {}) {
  return {
    model: "claude-haiku-5-5",
    system: [{ type: "text", text: "x-anthropic-billing-header: cc_version=2.1.316.e0c; cc_entrypoint=cli;" }],
    tools: [{ name: "mcp__pi__bash" }],
    messages: [
      {
        role: "user",
        content: [
          reminder,
          { type: "text", text: "<local-command-caveat>The command below was run directly</local-command-caveat>" },
          { type: "text", text: "<command-name>/clear</command-name>" },
          { type: "text", text: "<local-command-stdout></local-command-stdout>\n" },
          { type: "text", text: "pasted trigger" },
        ],
      },
      environment,
    ],
    ...extra,
  };
}

const userFrame = (text: string): NativeFrame => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const assistantFrame = (content: unknown[]): NativeFrame => ({ type: "assistant", message: { role: "assistant", content } });

function rewrite(body: unknown, frames: NativeFrame[]) {
  return JSON.parse(replaceTranscript(Buffer.from(JSON.stringify(body)), frames).toString("utf8"));
}

test("先頭 user の system-reminder を残し、貼り付けた文と /clear の痕跡を Pi の最初の発言に置き換える", () => {
  const result = rewrite(tuiBody(), [userFrame("Pi の最初の発言")]);
  assert.deepEqual(result.messages[0].content.map((block: { text: string }) => block.text), [reminder.text, "Pi の最初の発言"]);
});

test("環境の system メッセージを先頭 user の直後に残し、Pi の2件目以降をそのまま続ける", () => {
  const toolUse = { type: "tool_use", id: "toolu_1", name: "mcp__pi__bash", input: { command: "ls" } };
  const toolResult: NativeFrame = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "a.txt" }] } };
  const result = rewrite(tuiBody(), [userFrame("一覧して"), assistantFrame([toolUse]), toolResult]);
  assert.deepEqual(result.messages.map((message: { role: string }) => message.role), ["user", "system", "assistant", "user"]);
  assert.equal(result.messages[1].content[0].text, "# Environment");
  assert.deepEqual(result.messages[2].content, [toolUse]);
  assert.equal(result.messages[3].content[0].tool_use_id, "toolu_1");
});

test("messages 以外（請求ラベルの system、tools、model）には触らない", () => {
  const body = tuiBody();
  const result = rewrite(body, [userFrame("hi")]);
  assert.deepEqual(result.system, body.system);
  assert.deepEqual(result.tools, body.tools);
  assert.equal(result.model, body.model);
});

test("末尾に付く動く system（<total_tokens> など）は落とす", () => {
  const body = tuiBody();
  body.messages.push({ role: "system", content: [{ type: "text", text: "<total_tokens>15000000 tokens left</total_tokens>" }] });
  const result = rewrite(body, [userFrame("hi")]);
  assert.deepEqual(result.messages.map((message: { role: string }) => message.role), ["user", "system"]);
  assert.equal(result.messages[1].content[0].text, "# Environment");
});


const marked = (message: { content: Array<{ cache_control?: unknown }> }) => message.content.some((block) => block.cache_control);

test("最後のメッセージの最後のブロックに 1h のキャッシュ区切りを付ける", () => {
  const result = rewrite(tuiBody(), [userFrame("一つ目"), assistantFrame([{ type: "text", text: "はい" }]), userFrame("二つ目")]);
  assert.deepEqual(result.messages.at(-1).content.at(-1).cache_control, { type: "ephemeral", ttl: "1h" });
});

test("user が3件以上なら直前の user にも区切りを付け、環境 system の区切りは外す（messages 側は2つまで）", () => {
  const frames = [userFrame("1"), assistantFrame([{ type: "text", text: "a" }]), userFrame("2"), assistantFrame([{ type: "text", text: "b" }]), userFrame("3")];
  const result = rewrite(tuiBody(), frames);
  assert.deepEqual(result.messages.map(marked), [false, false, false, true, false, true]);
});

test("Pi の会話に元から付いていた cache_control は外す", () => {
  const stale = { type: "text", text: "old", cache_control: { type: "ephemeral" } };
  const frames = [{ type: "user", message: { role: "user", content: [stale] } } as NativeFrame, assistantFrame([{ type: "text", text: "a" }]), userFrame("now")];
  const result = rewrite(tuiBody(), frames);
  assert.equal(result.messages[0].content.at(-1).cache_control, undefined);
  assert.equal(frames[0]!.message.content[0], stale);
});

test("本文の先頭が user でなければエラーにする", () => {
  assert.throws(() => rewrite({ ...tuiBody(), messages: [environment] }, [userFrame("hi")]), /initial user message/);
});

test("Pi の会話が空、または先頭が user でなければエラーにする", () => {
  assert.throws(() => rewrite(tuiBody(), []), /must start with a user message/);
  assert.throws(() => rewrite(tuiBody(), [assistantFrame([{ type: "text", text: "a" }])]), /must start with a user message/);
});

