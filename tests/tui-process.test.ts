import assert from "node:assert/strict";
import * as http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { closeTuiProcesses, runTuiRequest, tuiArgs, tuiEnvironment, tuiModeEnabled } from "../src/tui-process.ts";
import type { RunClaudeInput } from "../src/claude-cli.ts";

const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

test("tuiModeEnabled は既定で真、PI_CLAUDE_CODE_TUI=0 のときだけ -p に戻す", () => {
  assert.equal(tuiModeEnabled({}), true);
  assert.equal(tuiModeEnabled({ PI_CLAUDE_CODE_TUI: "0" }), false);
  assert.equal(tuiModeEnabled({ PI_CLAUDE_CODE_TUI: "1" }), true);
});

test("tuiArgs は -p 系のフラグを使わず、Pi のツールだけを許可する", () => {
  const args = tuiArgs({ model: "claude-x", mcpConfig: "{}", systemPath: "/s.md", settingsPath: "/t.json" });
  for (const flag of ["-p", "--input-format", "--output-format", "--max-turns", "--no-session-persistence", "--disable-slash-commands"]) {
    assert.ok(!args.includes(flag), flag);
  }
  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), ["--permission-mode", "default"]);
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__pi");
  assert.equal(args[args.indexOf("--system-prompt-file") + 1], "/s.md");
});

test("tuiEnvironment は entrypoint を変える親の変数を消す（対話 TUI 既定の cli にさせるため）", () => {
  const env = tuiEnvironment({ CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "sdk-cli", CLAUDE_CODE_SESSION_ID: "x", CLAUDE_PID: "1", PATH: "/bin" });
  assert.deepEqual(env, { PATH: "/bin" });
});

interface Upstream { url: string; bodies: string[]; close: () => void }

async function fakeUpstream(headers: Record<string, string> = {}): Promise<Upstream> {
  const bodies: string[] = [];
  const usage = { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const events = [
    { type: "message_start", message: { id: "m1", role: "assistant", content: [], usage } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage },
    { type: "message_stop" },
  ];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    bodies.push(body);
    response.writeHead(200, { "content-type": "text/event-stream", ...headers });
    response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, bodies, close: () => server.close() };
}

async function withFixture(headers: Record<string, string>, body: (upstream: Upstream, input: (text: string) => RunClaudeInput, log: () => Promise<string[]>) => Promise<void>) {
  const upstream = await fakeUpstream(headers);
  const root = await mkdtemp(join(tmpdir(), "tui-process-"));
  const logPath = join(root, "input.log");
  const input = (text: string): RunClaudeInput => ({
    model: "claude-test",
    cwd: root,
    frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text }] } }],
    systemPrompt: "pi system",
    manifest: [],
    extraBody: {},
    toolNames: new Set(),
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

test("使用量クレジットで払われた応答は billing エラーで止める", async () => {
  const overage = { "anthropic-ratelimit-unified-status": "rejected", "anthropic-ratelimit-unified-overage-status": "allowed" };
  await withFixture(overage, async (_upstream, input) => {
    await assert.rejects(runTuiRequest(input("hi")), /billing/i);
  });
});
