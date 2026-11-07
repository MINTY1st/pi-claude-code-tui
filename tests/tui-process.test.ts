import assert from "node:assert/strict";
import * as http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { closeTuiProcesses, oldestIdleSession, runTuiRequest, tuiArgs, tuiEnvironment, tuiModeEnabled } from "../src/tui-process.ts";
import type { RunClaudeInput } from "../src/claude-cli.ts";
import type { NativeContentBlock } from "../src/native-types.ts";
import { TuiSession } from "../src/pty-session.ts";

const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

test("tuiModeEnabled は既定で真、PI_CLAUDE_CODE_TUI=0 のときだけ -p に戻す", () => {
  assert.equal(tuiModeEnabled({}), true);
  assert.equal(tuiModeEnabled({ PI_CLAUDE_CODE_TUI: "0" }), false);
  assert.equal(tuiModeEnabled({ PI_CLAUDE_CODE_TUI: "1" }), true);
});

test("tuiArgs は -p 系のフラグを使わず、Pi のツールだけを許可する", () => {
  const args = tuiArgs({ model: "claude-x", mcpConfig: "{}", settingsPath: "/t.json" });
  for (const flag of ["-p", "--input-format", "--output-format", "--max-turns", "--no-session-persistence", "--disable-slash-commands"]) {
    assert.ok(!args.includes(flag), flag);
  }
  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), ["--permission-mode", "default"]);
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__pi");
  assert.ok(!args.includes("--system-prompt-file"));
});

test("tuiEnvironment は entrypoint を変える親の変数を消す（対話 TUI 既定の cli にさせるため）", () => {
  const env = tuiEnvironment({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CODE_SESSION_ID: "x", CLAUDE_PID: "1", PATH: "/bin" });
  assert.deepEqual(env, { PATH: "/bin" });
});

interface Upstream { url: string; bodies: string[]; close: () => void }

interface Reply { content?: NativeContentBlock; status?: number; complete?: boolean; eventDelayMs?: number }

async function fakeUpstream(headers: Record<string, string> = {}, reply: Reply = {}): Promise<Upstream> {
  const bodies: string[] = [];
  const usage = { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const events = [
    { type: "message_start", message: { id: "m1", role: "assistant", content: [], usage } },
    { type: "content_block_start", index: 0, content_block: reply.content ?? { type: "text", text: "" } },
    ...(!reply.content ? [{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }] : []),
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: reply.content?.type === "tool_use" ? "tool_use" : "end_turn" }, usage },
    ...(reply.complete === false ? [] : [{ type: "message_stop" }]),
  ];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(body);
    response.writeHead(reply.status ?? 200, { "content-type": "text/event-stream", ...headers });
    if (!reply.eventDelayMs) {
      response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
      return;
    }
    for (const event of events) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, reply.eventDelayMs));
    }
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, bodies, close: () => server.close() };
}

async function withFixture(headers: Record<string, string>, body: (upstream: Upstream, input: (text: string) => RunClaudeInput, log: () => Promise<string[]>) => Promise<void>, reply: Reply = {}) {
  const upstream = await fakeUpstream(headers, reply);
  const root = await mkdtemp(join(tmpdir(), "tui-process-"));
  const logPath = join(root, "input.log");
  const input = (text: string): RunClaudeInput => ({
    model: "claude-test",
    cwd: root,
    frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text }] } }],
    systemPrompt: "pi system",
    manifest: [],
    extraBody: {},
    upstreamUrl: upstream.url,
    sessionId: "session-1",
    timeoutMs: 10_000,
    env: { PI_CLAUDE_CODE_COMMAND: fakeClaude, PI_CLAUDE_CODE_TUI_TRUST: "1", FAKE_LOG: logPath },
  });
  try {
    await body(upstream, input, async () => (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string));
  } finally {
    await closeTuiProcesses();
    upstream.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("runTuiRequest は貼り付けで1回リクエストを起こし、本文の messages を Pi の会話に差し替えて応答を返す", async () => {
  await withFixture({}, async (upstream, input) => {
    const events: string[] = [];
    const output = await runTuiRequest({ ...input("Pi の発言"), onEvent: (event) => events.push(event.type) });
    assert.deepEqual(output.message.content, [{ type: "text", text: "hello" }]);
    assert.equal(output.usage.input_tokens, 3);
    assert.equal(output.relay.upstreamRequests, 1);
    const sent = JSON.parse(upstream.bodies[0]!);
    assert.equal(sent.messages[0].content.at(-1).text, "Pi の発言");
    assert.equal(sent.messages[0].content.at(-2).text, "pi system");
    assert.ok(!JSON.stringify(sent.system).includes("pi system"));
    assert.match(sent.system[0].text, /cc_entrypoint=cli/);
    assert.ok(events.includes("message_start"));
  });
});

test("同じ Pi セッションの次のターンは、/clear してから同じ Claude Code を使い回す", async () => {
  await withFixture({}, async (upstream, input, log) => {
    await runTuiRequest(input("一つ目"));
    await runTuiRequest(input("二つ目"));
    const received = await log();
    assert.equal(received.filter((text) => text === "started").length, 1);
    assert.ok(received.includes("/clear"));
    assert.equal(JSON.parse(upstream.bodies[1]!).messages[0].content.at(-1).text, "二つ目");
  });
});

test("最初の前置きを返して Pi のセッションに残させ、保存分を渡されたら上流へもそれを送る", async () => {
  await withFixture({}, async (upstream, input) => {
    const first = await runTuiRequest(input("一つ目"));
    assert.deepEqual(first.initialUserPrefix, [{ type: "text", text: "<system-reminder>\nfake\n</system-reminder>" }]);
    assert.deepEqual(first.initialSystemMessages, [{ role: "system", content: [{ type: "text", text: "# Environment" }] }]);
    const pinnedPrefix = [{ type: "text", text: "<system-reminder>\npinned\n</system-reminder>" }];
    const pinnedSystem = [{ role: "system", content: [{ type: "text", text: "# Environment at start" }] }];
    const second = await runTuiRequest({ ...input("二つ目"), initialUserPrefix: pinnedPrefix, initialSystemMessages: pinnedSystem });
    const sent = JSON.parse(upstream.bodies[1]!);
    assert.equal(sent.messages[0].content[0].text, pinnedPrefix[0]!.text);
    assert.equal(sent.messages[1].content[0].text, "# Environment at start");
    assert.deepEqual(second.initialUserPrefix, pinnedPrefix);
    assert.deepEqual(second.initialSystemMessages, pinnedSystem);
  });
});

test("待機15分のタイマーでプロセスを破棄し、次の要求では新しく起動する", async (context) => {
  const original = globalThis.setTimeout;
  let expire: (() => void) | undefined;
  context.mock.method(globalThis, "setTimeout", (callback: (...args: unknown[]) => void, milliseconds?: number, ...args: unknown[]) => {
    if (milliseconds === 15 * 60 * 1_000) expire = () => callback(...args);
    return original(callback, milliseconds, ...args);
  });
  await withFixture({}, async (_upstream, input, log) => {
    await runTuiRequest(input("一つ目"));
    assert.equal(typeof expire, "function");
    expire!();
    await runTuiRequest(input("二つ目"));
    assert.equal((await log()).filter((text) => text === "started").length, 2);
  });
});

test("タイムアウト設定が変わったら、古い relay の制限を引き継がずプロセスを作り直す", async () => {
  await withFixture({}, async (_upstream, input, log) => {
    await runTuiRequest(input("一つ目"));
    await runTuiRequest({ ...input("二つ目"), timeoutMs: 20_000 });
    assert.equal((await log()).filter((text) => text === "started").length, 2);
  });
});

test("応答受信中の中断後は壊れたプロセスを再利用せず、次の要求は新しく起動する", async () => {
  await withFixture({}, async (_upstream, input, log) => {
    const controller = new AbortController();
    await assert.rejects(runTuiRequest({ ...input("中断"), signal: controller.signal, onEvent: () => controller.abort() }));
    const next = await runTuiRequest(input("再開"));
    assert.equal(next.message.stop_reason, "end_turn");
    assert.equal((await log()).filter((text) => text === "started").length, 2);
  });
});

test("反例: 起動待ちで中断されたら、プロンプトが出ても上流には送信しない", async () => {
  await withFixture({}, async (upstream, input) => {
    const controller = new AbortController();
    const request = runTuiRequest({ ...input("送らない"), signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await assert.rejects(request);
      assert.equal(upstream.bodies.length, 0);
    } finally {
      clearTimeout(timer);
    }
  });
});

test("反例: ready 待機中のセッション破棄は、その要求の送信と登録を止める", async (context) => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const original = TuiSession.prototype.ready;
  context.mock.method(TuiSession.prototype, "ready", async function (this: TuiSession, signal?: AbortSignal) {
    entered.resolve();
    await gate.promise;
    return original.call(this, signal);
  });
  await withFixture({}, async (upstream, input) => {
    const request = input("破棄する");
    const outcome = runTuiRequest(request).then(() => "fulfilled", () => "rejected");
    await entered.promise;
    const closing = closeTuiProcesses(request.sessionId);
    gate.resolve();
    await closing;
    assert.equal(await outcome, "rejected");
    assert.equal(upstream.bodies.length, 0);
  });
});

test("反例: セッション破棄は、キャッシュ外の並行 worker も中断して清掃する", async (context) => {
  await withFixture({}, async (upstream, input) => {
    await runTuiRequest(input("準備"));
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const original = TuiSession.prototype.submit;
    let count = 0;
    context.mock.method(TuiSession.prototype, "submit", async function (this: TuiSession, text: string) {
      if (++count === 2) entered.resolve();
      await gate.promise;
      return original.call(this, text);
    });
    const requests = ["A", "B"].map((text) => runTuiRequest(input(text)).then(() => "fulfilled", () => "rejected"));
    await entered.promise;
    const closing = closeTuiProcesses(input("").sessionId);
    gate.resolve();
    await closing;
    assert.deepEqual(await Promise.all(requests), ["rejected", "rejected"]);
    assert.equal(upstream.bodies.length, 1);
  });
});

test("同じセッションへの並行要求でも、それぞれの会話を別のプロセスで処理する", async () => {
  await withFixture({}, async (upstream, input, log) => {
    const outputs = await Promise.all([runTuiRequest(input("会話 A")), runTuiRequest(input("会話 B"))]);
    assert.deepEqual(outputs.map((output) => output.relay.upstreamRequests), [1, 1]);
    assert.deepEqual(upstream.bodies.map((body) => JSON.parse(body).messages[0].content.at(-1).text).sort(), ["会話 A", "会話 B"]);
    assert.equal((await log()).filter((text) => text === "started").length, 2);
  });
});

test("tool_use を Pi へ返し、Claude Code が続けて送る2本の回復要求をすべて拒否する", async () => {
  const tool: NativeContentBlock = { type: "tool_use", id: "toolu_read", name: "mcp__pi__read", input: { path: "/tmp/example" } };
  await withFixture({}, async (upstream, input) => {
    const request = input("読む");
    const output = await runTuiRequest({ ...request, env: { ...request.env, FAKE_RECOVERY_REQUESTS: "2" } });
    assert.deepEqual(output.message.content, [tool]);
    assert.equal(output.message.stop_reason, "tool_use");
    assert.equal(output.relay.upstreamRequests, 1);
    assert.equal(output.relay.blockedRequests, 2);
    assert.equal(upstream.bodies.length, 1);
  }, { content: tool });
});

test("Pi に登録されていないツールを返す応答も、例外にせず tool_use のまま Pi へ返す（Pi の agent loop がツールの無いことをモデルへ返すため）", async () => {
  for (const name of ["mcp__pi__unknown", "write"]) {
    const tool: NativeContentBlock = { type: "tool_use", id: "t", name, input: {} };
    await withFixture({}, async (_upstream, input) => {
      const output = await runTuiRequest(input("読む"));
      assert.deepEqual(output.message.content, [tool]);
      assert.equal(output.message.stop_reason, "tool_use");
    }, { content: tool });
  }
});

test("途中で切れた SSE や HTTP 400 は成功結果にせずエラーにする", async () => {
  for (const reply of [{ complete: false }, { status: 400 }]) {
    await withFixture({}, async (_upstream, input) => {
      await assert.rejects(runTuiRequest(input("hi")), /Incomplete.*upstream/s);
    }, reply);
  }
});

test("使用量クレジットで払われた応答は billing エラーで止める", async () => {
  const overage = { "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-overage-status": "allowed" };
  await withFixture(overage, async (_upstream, input) => {
    await assert.rejects(runTuiRequest(input("hi")), /billing/i);
  });
});

test("上流が少しずつ返し続ける長いターンは、ターン全体が timeoutMs を超えても時間切れにしない（2026-11-04 に reviewer が 300 秒で切れた）", async () => {
  await withFixture({}, async (_upstream, input) => {
    const startedAt = performance.now();
    const output = await runTuiRequest({ ...input("長い審査"), timeoutMs: 1_500 });
    assert.deepEqual(output.message.content, [{ type: "text", text: "hello" }]);
    assert.ok(performance.now() - startedAt > 1_500, "ターン全体は timeoutMs より長くかかっている");
  }, { eventDelayMs: 400 });
});

test("終了行を描かない TUI でも、応答を受け取り終えたら補助判定でターンを終える（2026-11-06 に 300 秒待って失敗した）", async () => {
  await withFixture({}, async (_upstream, input) => {
    const request = input("終了行なし");
    const startedAt = Date.now();
    const output = await runTuiRequest({ ...request, env: { ...request.env, FAKE_TURN_LINE: "0" } });
    assert.deepEqual(output.message.content, [{ type: "text", text: "hello" }]);
    assert.ok(Date.now() - startedAt < 10_000);
  });
});

test("反例: message_stop が届かない応答は、終了行が無く入力欄が出ていても補助判定で終えず、時間切れにする", async () => {
  await withFixture({}, async (_upstream, input) => {
    const request = input("途中で切れる");
    // 補助判定の待ち時間（3秒）より長い締め切りにして、補助判定が先に働かないことを確かめる
    await assert.rejects(runTuiRequest({ ...request, timeoutMs: 5_000, env: { ...request.env, FAKE_TURN_LINE: "0" } }), /timed out/);
  }, { complete: false });
});

const thinkingOn = (effort: string) => ({ thinking: { type: "adaptive", display: "summarized" }, output_config: { effort } });
const sentKeys = (body: string) => {
  const sent = JSON.parse(body) as Record<string, unknown>;
  return { thinking: sent.thinking, output_config: sent.output_config, context_management: sent.context_management };
};

test("effort だけを変えた次のターンは Claude Code を作り直さず、そのターンの output_config を上流へ送る", async () => {
  await withFixture({}, async (upstream, input, log) => {
    await runTuiRequest({ ...input("一つ目"), extraBody: thinkingOn("high") });
    await runTuiRequest({ ...input("二つ目"), extraBody: thinkingOn("low") });
    await runTuiRequest({ ...input("三つ目"), extraBody: thinkingOn("high") });
    assert.equal((await log()).filter((text) => text === "started").length, 1);
    assert.deepEqual(upstream.bodies.map((body) => (JSON.parse(body) as { output_config?: unknown }).output_config), [{ effort: "high" }, { effort: "low" }, { effort: "high" }]);
  });
});

test("起動時の settings には起動したターンの output_config を残し、effort を変えても書き直さない", async () => {
  await withFixture({}, async (_upstream, input) => {
    const settingsLog = join(input("").cwd!, "settings.log");
    const requestEnv = { ...input("").env, FAKE_SETTINGS_LOG: settingsLog };
    await runTuiRequest({ ...input("一つ目"), env: requestEnv, extraBody: thinkingOn("high") });
    await runTuiRequest({ ...input("二つ目"), env: requestEnv, extraBody: thinkingOn("low") });
    const launched = (await readFile(settingsLog, "utf8")).trim().split("\n").map((line) => JSON.parse(JSON.parse(line) as string) as unknown);
    assert.deepEqual(launched, [thinkingOn("high")]);
  });
});

test("起動時の settings には thinking のオン・オフによらず showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY は extraBody の JSON のまま渡す", async () => {
  await withFixture({}, async (_upstream, input) => {
    const settingsDocLog = join(input("").cwd!, "settings-doc.log");
    const requestEnv = { ...input("").env, FAKE_SETTINGS_DOC_LOG: settingsDocLog };
    const thinkingOff = { thinking: { type: "disabled" }, context_management: { edits: [] } };
    await runTuiRequest({ ...input("一つ目"), env: requestEnv, extraBody: thinkingOn("high") });
    await runTuiRequest({ ...input("二つ目"), env: requestEnv, extraBody: thinkingOff });
    const launched = (await readFile(settingsDocLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as unknown);
    assert.deepEqual(launched, [
      { env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(thinkingOn("high")) }, showThinkingSummaries: true },
      { env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(thinkingOff) }, showThinkingSummaries: true },
    ]);
  });
});

test("thinking オフのターンは context_management を上流の本文の最上位に書く", async () => {
  await withFixture({}, async (upstream, input) => {
    await runTuiRequest({ ...input("一つ目"), extraBody: { thinking: { type: "disabled" }, context_management: { edits: [] } } });
    assert.deepEqual(sentKeys(upstream.bodies[0]!), { thinking: { type: "disabled" }, output_config: undefined, context_management: { edits: [] } });
  });
});

test("thinking のオン・オフを切り替えたターンは Claude Code を作り直す", async () => {
  await withFixture({}, async (upstream, input, log) => {
    await runTuiRequest({ ...input("一つ目"), extraBody: thinkingOn("high") });
    await runTuiRequest({ ...input("二つ目"), extraBody: { thinking: { type: "disabled" }, context_management: { edits: [] } } });
    assert.equal((await log()).filter((text) => text === "started").length, 2);
    assert.deepEqual(sentKeys(upstream.bodies[1]!), { thinking: { type: "disabled" }, output_config: undefined, context_management: { edits: [] } });
  });
});

test("反例: Claude Code が本文から落とした output_config は、ターンの値があっても上流へ足さない", async () => {
  await withFixture({}, async (upstream, input) => {
    const request = input("一つ目");
    await runTuiRequest({ ...request, env: { ...request.env, FAKE_DROP_BODY_KEYS: "output_config" }, extraBody: thinkingOn("low") });
    assert.deepEqual(sentKeys(upstream.bodies[0]!), { thinking: { type: "adaptive", display: "summarized" }, output_config: undefined, context_management: undefined });
  });
});

test("反例: output_config の有無だけが変わったターンは、値を指紋から外していても Claude Code を作り直す", async () => {
  await withFixture({}, async (upstream, input, log) => {
    await runTuiRequest({ ...input("一つ目"), extraBody: {} });
    await runTuiRequest({ ...input("二つ目"), extraBody: { output_config: { effort: "low" } } });
    assert.equal((await log()).filter((text) => text === "started").length, 2);
    assert.equal((JSON.parse(upstream.bodies[0]!) as { output_config?: unknown }).output_config, undefined);
  });
});

test("反例: max_tokens が変わったターンは、これまでどおり Claude Code を作り直す", async () => {
  await withFixture({}, async (_upstream, input, log) => {
    await runTuiRequest({ ...input("一つ目"), extraBody: { ...thinkingOn("high"), max_tokens: 4096 } });
    await runTuiRequest({ ...input("二つ目"), extraBody: { ...thinkingOn("high"), max_tokens: 8192 } });
    assert.equal((await log()).filter((text) => text === "started").length, 2);
  });
});

test("同時実行: 同じセッションへ effort の違う要求が並んでも、それぞれの本文にそれぞれの effort を書く", async () => {
  await withFixture({}, async (upstream, input) => {
    await Promise.all([
      runTuiRequest({ ...input("会話 A"), extraBody: thinkingOn("high") }),
      runTuiRequest({ ...input("会話 B"), extraBody: thinkingOn("low") }),
    ]);
    const pairs = upstream.bodies.map((body) => {
      const sent = JSON.parse(body) as { messages: Array<{ content: Array<{ text: string }> }>; output_config?: { effort?: string } };
      return [sent.messages[0]!.content.at(-1)!.text, sent.output_config?.effort];
    });
    assert.deepEqual(pairs.sort(), [["会話 A", "high"], ["会話 B", "low"]]);
  });
});

test("反例: 上流が 400 を返したターンのあとも、次のターンは自分の effort で送り、前のターンの値を引き継がない", async () => {
  await withFixture({}, async (upstream, input) => {
    await assert.rejects(runTuiRequest({ ...input("一つ目"), extraBody: thinkingOn("high") }));
    await assert.rejects(runTuiRequest({ ...input("二つ目"), extraBody: thinkingOn("low") }));
    assert.deepEqual(upstream.bodies.map((body) => (JSON.parse(body) as { output_config?: unknown }).output_config), [{ effort: "high" }, { effort: "low" }]);
  }, { status: 400 });
});

test("oldestIdleSession は使用中でない worker のうち、最後に使ったのが最も古いセッションを選ぶ", () => {
  assert.equal(oldestIdleSession([["A", { busy: false, lastUsed: 20 }], ["B", { busy: false, lastUsed: 10 }], ["C", { busy: false, lastUsed: 30 }]]), "B");
});

test("oldestIdleSession は使用中の worker を、最も古くても選ばない", () => {
  assert.equal(oldestIdleSession([["A", { busy: true, lastUsed: 10 }], ["B", { busy: false, lastUsed: 20 }]]), "B");
});

test("境界値: oldestIdleSession は最後に使った時刻が同じなら先に入ったセッションを選ぶ", () => {
  assert.equal(oldestIdleSession([["A", { busy: false, lastUsed: 10 }], ["B", { busy: false, lastUsed: 10 }]]), "A");
});

test("境界値: oldestIdleSession は空か、すべて使用中なら undefined を返す", () => {
  assert.equal(oldestIdleSession([]), undefined);
  assert.equal(oldestIdleSession([["A", { busy: true, lastUsed: 10 }], ["B", { busy: true, lastUsed: 20 }]]), undefined);
});

const startedCount = async (log: () => Promise<string[]>) => (await log()).filter((text) => text === "started").length;

test("キャッシュが2つで埋まっていたら、使われていない最も古いセッションの Claude Code を閉じて、3つ目のセッションを残す", async (context) => {
  const sessions: TuiSession[] = [];
  const start = TuiSession.start;
  context.mock.method(TuiSession, "start", (options: Parameters<typeof TuiSession.start>[0]) => {
    const session = start.call(TuiSession, options);
    sessions.push(session);
    return session;
  });
  await withFixture({}, async (_upstream, input, log) => {
    const turn = (sessionId: string, text: string) => runTuiRequest({ ...input(text), sessionId });
    await turn("A", "A1");
    await turn("B", "B1");
    await turn("C", "C1");
    assert.deepEqual(sessions.map((session) => session.isAlive()), [false, true, true]);
    await turn("C", "C2");
    await turn("B", "B2");
    assert.equal(await startedCount(log), 3, "B と C は使い回す");
    await turn("A", "A2");
    assert.equal(await startedCount(log), 4, "追い出した A は起動し直す");
  });
});

test("最後に使った時刻で選ぶ: 先に起動しても直前に使ったセッションは残し、その次に古いセッションを追い出す", async () => {
  await withFixture({}, async (_upstream, input, log) => {
    const turn = (sessionId: string, text: string) => runTuiRequest({ ...input(text), sessionId });
    await turn("A", "A1");
    await turn("B", "B1");
    await turn("A", "A2");
    await turn("C", "C1");
    assert.equal(await startedCount(log), 3);
    await turn("A", "A3");
    await turn("C", "C2");
    assert.equal(await startedCount(log), 3, "A と C は使い回す");
    await turn("B", "B2");
    assert.equal(await startedCount(log), 4, "追い出した B は起動し直す");
  });
});

/** 貼り付け（continue）を holdCount 回目まで止める。/clear は止めない */
function holdSubmits(context: { mock: { method: typeof import("node:test").mock.method } }, holdCount: number) {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const original = TuiSession.prototype.submit;
  let count = 0;
  context.mock.method(TuiSession.prototype, "submit", async function (this: TuiSession, text: string) {
    if (text === "continue" && ++count <= holdCount) {
      if (count === holdCount) entered.resolve();
      await gate.promise;
    }
    return original.call(this, text);
  });
  return { entered: entered.promise, release: () => gate.resolve() };
}

test("反例: 応答を待っているセッションの Claude Code は、最も古くても追い出さない", async (context) => {
  await withFixture({}, async (_upstream, input, log) => {
    const turn = (sessionId: string, text: string) => runTuiRequest({ ...input(text), sessionId });
    await turn("A", "A1");
    await turn("B", "B1");
    const hold = holdSubmits(context, 1);
    const running = turn("A", "A2");
    await hold.entered;
    await turn("C", "C1");
    hold.release();
    await running;
    await turn("A", "A3");
    await turn("C", "C2");
    assert.equal(await startedCount(log), 3, "A と C は使い回す");
    await turn("B", "B2");
    assert.equal(await startedCount(log), 4, "追い出した B は起動し直す");
  });
});

test("反例: キャッシュがすべて応答待ちなら何も追い出さず、3つ目のセッションは使い捨てで受ける", async (context) => {
  await withFixture({}, async (_upstream, input, log) => {
    const turn = (sessionId: string, text: string) => runTuiRequest({ ...input(text), sessionId });
    await turn("A", "A1");
    await turn("B", "B1");
    const hold = holdSubmits(context, 2);
    const running = [turn("A", "A2"), turn("B", "B2")];
    await hold.entered;
    await turn("C", "C1");
    hold.release();
    await Promise.all(running);
    await turn("A", "A3");
    await turn("B", "B3");
    assert.equal(await startedCount(log), 3, "A と B は残っている");
    await turn("C", "C2");
    assert.equal(await startedCount(log), 4, "C は残していない");
  });
});

test("反例: セッション ID の無い要求と、同じセッションへの並行要求は、使い捨てで受けて何も追い出さない", async () => {
  await withFixture({}, async (_upstream, input, log) => {
    const turn = (sessionId: string | undefined, text: string) => runTuiRequest({ ...input(text), sessionId });
    await turn("A", "A1");
    await turn("B", "B1");
    await turn(undefined, "ID なし");
    await Promise.all([turn("A", "A2"), turn("A", "A3")]);
    assert.equal(await startedCount(log), 4);
    await turn("A", "A4");
    await turn("B", "B2");
    assert.equal(await startedCount(log), 4, "A と B は残っている");
  });
});

test("同時実行: 新しいセッション2つが並んで起動しても、空きを二重に数えず両方を残し、古い2つを追い出す", async () => {
  await withFixture({}, async (_upstream, input, log) => {
    const turn = (sessionId: string, text: string) => runTuiRequest({ ...input(text), sessionId });
    await turn("A", "A1");
    await turn("B", "B1");
    await Promise.all([turn("C", "C1"), turn("D", "D1")]);
    await turn("C", "C2");
    await turn("D", "D2");
    assert.equal(await startedCount(log), 4, "C と D は使い回す");
    await turn("A", "A2");
    await turn("B", "B2");
    assert.equal(await startedCount(log), 6, "A と B は起動し直す");
  });
});
