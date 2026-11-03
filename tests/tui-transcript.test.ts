import assert from "node:assert/strict";
import test from "node:test";
import { initialContext, replaceTranscript } from "../src/tui-transcript.ts";
import type { NativeFrame } from "../src/native-types.ts";
import type { NativeSystemInjection } from "../src/transcript.ts";

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

function rewrite(body: unknown, frames: NativeFrame[], systemPrompt = "", injections: NativeSystemInjection[] = [], pinned = {}) {
  return JSON.parse(replaceTranscript(Buffer.from(JSON.stringify(body)), frames, systemPrompt, injections, pinned).toString("utf8"));
}

test("反例: /clear のたびに git status が変わっても、保存済みの前置きと環境を使ってキャッシュの接頭辞を保つ", () => {
  const startReminder = { type: "text", text: "<system-reminder>\n# gitStatus\nRecent commits: aaa\n</system-reminder>" };
  const startEnvironment = { role: "system", content: [{ type: "text", text: "# Environment at start" }] };
  const body = tuiBody();
  body.messages[0]!.content[0] = { type: "text", text: "<system-reminder>\n# gitStatus\nRecent commits: bbb aaa\n</system-reminder>" };
  const pinned = { userPrefix: [startReminder], systemMessages: [startEnvironment] };
  const before = structuredClone(pinned);
  const result = rewrite(body, [userFrame("質問")], "Pi instructions", [], pinned);
  assert.deepEqual(result.messages[0].content.map((block: { text: string }) => block.text), [startReminder.text, "Pi instructions", "質問"]);
  assert.deepEqual(result.messages.map((message: { role: string }) => message.role), ["user", "system"]);
  assert.equal(result.messages[1].content[0].text, "# Environment at start");
  assert.deepEqual(pinned, before);
});

test("initialContext は先頭 user の system-reminder と環境 system を区切りなしで取り出す", () => {
  const context = initialContext(Buffer.from(JSON.stringify(tuiBody())));
  assert.deepEqual(context.userPrefix, [reminder]);
  assert.deepEqual(context.systemMessages, [{ role: "system", content: [{ type: "text", text: "# Environment" }] }]);
});

test("Pi のプロンプトは先頭 user の会話より前に一度だけ置き、上流 system は変更しない", () => {
  const body = tuiBody();
  const frames = [userFrame("質問"), assistantFrame([{ type: "text", text: "回答" }]), userFrame("続き")];
  const result = rewrite(body, frames, "Pi instructions");
  assert.deepEqual(result.messages[0].content.map((block: { text: string }) => block.text), [reminder.text, "Pi instructions", "質問"]);
  assert.deepEqual(result.system, body.system);
  assert.equal(JSON.stringify(result.messages).split("Pi instructions").length - 1, 1);
  assert.equal(frames[0]!.message.content.length, 1);
});

test("ツールの追加・削除と途中の system 指示は元の assistant 境界に復元する", () => {
  const frames = [userFrame("最初"), assistantFrame([{ type: "text", text: "回答" }]), userFrame("続き")];
  const injections: NativeSystemInjection[] = [
    { beforeAssistant: 0, content: [{ type: "text", text: "途中の指示" }] },
    { beforeAssistant: null, content: [{ type: "tool_removal", tool: { type: "tool_reference", name: "mcp__pi__old" } }] },
  ];
  const result = rewrite(tuiBody(), frames, "Pi instructions", injections);
  assert.deepEqual(result.messages.map((message: { role: string }) => message.role), ["user", "system", "system", "assistant", "user", "system"]);
  assert.equal(result.messages[2].content[0].text, "途中の指示");
  assert.equal(result.messages.at(-1).content[0].type, "tool_removal");
  assert.equal(injections[1]!.content[0]!.cache_control, undefined);
});

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

const cacheCount = (value: unknown): number => {
  if (!value || typeof value !== "object") return 0;
  return Object.entries(value).reduce((total, [key, child]) => total + (key === "cache_control" ? 1 : cacheCount(child)), 0);
};

test("反例: system に2個・tools に1個あるツール往復でも、キャッシュ区切りは合計4個以内に収める", () => {
  const body = tuiBody({
    system: ["Claude Code", "instructions"].map((text) => ({ type: "text", text, cache_control: { type: "ephemeral" } })),
    tools: [{ name: "mcp__pi__bash", cache_control: { type: "ephemeral" } }],
  });
  const frames = [userFrame("実行"), assistantFrame([{ type: "tool_use", id: "t1", name: "mcp__pi__bash", input: {} }]), userFrame("結果")];
  const result = rewrite(body, frames, "Pi instructions");
  assert.equal(cacheCount(result), 4);
  assert.deepEqual(result.system, body.system);
  assert.deepEqual(result.tools, body.tools);
  assert.deepEqual(result.messages.at(-1).content.at(-1).cache_control, { type: "ephemeral", ttl: "1h" });
});

test("system と tools が4個の区切りを使い切ったら messages に追加せず、上流本来の設定は保つ", () => {
  const system = Array.from({ length: 4 }, (_, index) => ({ type: "text", text: String(index), cache_control: { type: "ephemeral" } }));
  const result = rewrite(tuiBody({ system }), [userFrame("hi")]);
  assert.equal(cacheCount(result), 4);
  assert.deepEqual(result.system, system);
  assert.ok(result.messages.every((message: unknown) => cacheCount(message) === 0));
});

test("上流本来の区切りだけで4個を超える本文は、改変して送らずにエラーにする", () => {
  const system = Array.from({ length: 5 }, () => ({ type: "text", text: "x", cache_control: { type: "ephemeral" } }));
  assert.throws(() => rewrite(tuiBody({ system }), [userFrame("hi")]), /cache breakpoint limit/);
});

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

test("反例: ツール引数とツール定義内の cache_control は利用者データとして保持し、区切りに数えない", () => {
  const input = { cache_control: "private", nested: { cache_control: "max-age=0" }, content: [{ cache_control: "data" }] };
  const tool = { type: "tool_use", id: "t", name: "mcp__pi__bash", input, cache_control: { type: "ephemeral" } };
  const body = tuiBody({ tools: [{ name: "mcp__pi__bash", input_schema: { properties: { cache_control: { type: "string" } } } }] });
  const frames = [userFrame("実行"), assistantFrame([tool]), userFrame("結果")];
  const before = structuredClone(frames);
  const result = rewrite(body, frames);
  assert.deepEqual(result.messages[2].content[0].input, input);
  assert.equal(result.messages[2].content[0].cache_control, undefined);
  assert.deepEqual(result.messages.at(-1).content.at(-1).cache_control, { type: "ephemeral", ttl: "1h" });
  assert.deepEqual(result.tools, body.tools);
  assert.deepEqual(frames, before);
});

test("Pi の会話が空、または先頭が user でなければエラーにする", () => {
  assert.throws(() => rewrite(tuiBody(), []), /must start with a user message/);
  assert.throws(() => rewrite(tuiBody(), [assistantFrame([{ type: "text", text: "a" }])]), /must start with a user message/);
});

