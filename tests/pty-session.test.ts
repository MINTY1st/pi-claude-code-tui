import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";
import { type FallbackHold, promptFallbackReached, TuiSession, type TuiSessionOptions } from "../src/pty-session.ts";

const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

async function withSession(
  overrides: Partial<TuiSessionOptions> & { screen?: string; listed?: boolean },
  body: (session: TuiSession, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pty-session-"));
  const listedMarker = join(root, "listed");
  if (overrides.listed !== false) await writeFile(listedMarker, "");
  const session = TuiSession.start({
    command: process.execPath,
    args: [fakeClaude],
    cwd: root,
    env: { ...process.env, FAKE_SCREEN: overrides.screen ?? "prompt", FAKE_LOG: join(root, "input.log") },
    listedMarker,
    trustFolder: true,
    readyTimeoutMs: 3_000,
    ...overrides,
  });
  try {
    await body(session, root);
  } finally {
    await session.close();
    await rm(root, { recursive: true, force: true });
  }
}

const inputs = async (root: string) => (await readFile(join(root, "input.log"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as string);

test("端末の問い合わせに答え、入力欄とツール一覧取得の印がそろえば ready が終わる", async () => {
  await withSession({}, async (session, root) => {
    await session.ready();
    const received = await inputs(root);
    assert.ok(received.some((text) => text.includes("\x1b[1;1R")));
  });
});

test("ツール一覧取得の印が無いままなら、時間切れで画面の末尾を含むエラーにする", async () => {
  await withSession({ listed: false, readyTimeoutMs: 800 }, async (session) => {
    await assert.rejects(session.ready(), /tool list.*❯/s);
  });
});

test("フォルダ信頼確認では ↓ で Yes を選んでから Enter を押す", async () => {
  await withSession({ screen: "trust" }, async (session, root) => {
    await session.ready();
    const received = await inputs(root);
    assert.ok(received.indexOf("\x1b[B") < received.indexOf("\r"));
  });
});

test("trustFolder が false で信頼確認が出たらエラーにする", async () => {
  await withSession({ screen: "trust", trustFolder: false }, async (session) => {
    await assert.rejects(session.ready(), /trust/);
  });
});

test("ログインを求める画面が出たらエラーにする", async () => {
  await withSession({ screen: "sign-in" }, async (session) => {
    await assert.rejects(session.ready(), /claude auth login/);
  });
});

test("submit で貼り付けて Enter を押し、waitIdle で入力待ちに戻るまで待つ", async () => {
  await withSession({}, async (session, root) => {
    await session.ready();
    await session.submit("continue");
    await session.waitIdle(3_000);
    const received = await inputs(root);
    assert.ok(received.includes("\x1b[200~continue\x1b[201~"));
    assert.ok(received.lastIndexOf("\r") > received.indexOf("\x1b[200~continue\x1b[201~"));
  });
});

test("waitIdle は上流から届くたびに締め切りを延ばし、timeoutMs より長いターンでも最後まで待つ", async () => {
  await withSession({ env: { ...process.env, FAKE_SCREEN: "prompt", FAKE_TURN_MS: "1200" } }, async (session) => {
    await session.ready();
    await session.submit("long");
    await assert.doesNotReject(session.waitIdle(500, () => Date.now()));
  });
});

test("waitIdle は上流から何も届かないまま timeoutMs が過ぎたら、ターンが終わっていなくてもエラーにする", async () => {
  await withSession({ env: { ...process.env, FAKE_SCREEN: "prompt", FAKE_TURN_MS: "3000" } }, async (session) => {
    await session.ready();
    await session.submit("stuck");
    const startedAt = Date.now();
    await assert.rejects(session.waitIdle(500, () => startedAt), /did not finish its turn within 500ms/);
    assert.ok(Date.now() - startedAt < 2_000);
  });
});

test("waitIdle の無応答の打ち切りは timed out で始まり、Pi が再試行する文言にする", async () => {
  await withSession({ env: { ...process.env, FAKE_SCREEN: "prompt", FAKE_TURN_MS: "3000" } }, async (session) => {
    await session.ready();
    await session.submit("stuck");
    const startedAt = Date.now();
    const error = await session.waitIdle(500, () => startedAt).then(() => assert.fail("waitIdle must time out"), (reason: unknown) => reason);
    assert.ok(error instanceof Error);
    assert.ok(error.message.startsWith("Claude Code timed out: it did not finish its turn within 500ms: "));
    assert.equal(isRetryableAssistantError({ stopReason: "error", errorMessage: error.message } as AssistantMessage), true);
  });
});

test("clear で /clear を送り、入力待ちに戻るまで待つ", async () => {
  await withSession({}, async (session, root) => {
    await session.ready();
    await session.clear(3_000);
    assert.ok((await inputs(root)).includes("/clear"));
  });
});

test("Python が無い環境でも未処理の例外にせず、ready のエラーとして返して close できる", () => {
  const modulePath = new URL("../src/pty-session.ts", import.meta.url).href;
  const script = `
    import { TuiSession } from ${JSON.stringify(modulePath)};
    const session = TuiSession.start({ command: "claude", args: [], cwd: ${JSON.stringify(tmpdir())}, env: { PATH: "" }, listedMarker: "", trustFolder: false, readyTimeoutMs: 300 });
    try { await session.ready(); process.exitCode = 2; }
    catch (error) { console.log(error.message); }
    finally { await session.close(); }
  `;
  const result = spawnSync(process.execPath, ["--experimental-transform-types", "--input-type=module", "-e", script], { encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Python.*ENOENT/i);
});

test("close で子プロセスを終わらせる", async () => {
  await withSession({}, async (session) => {
    await session.ready();
    await session.close();
    assert.equal(session.isAlive(), false);
  });
});

const withoutTurnLine = (extra: Record<string, string> = {}): Partial<TuiSessionOptions> => ({
  env: { ...process.env, FAKE_SCREEN: "prompt", FAKE_TURN_LINE: "0", ...extra },
  promptFallbackMs: 300,
});

test("promptFallbackReached は条件が holdMs 続いたときだけ真になり、途切れたら数え直す", () => {
  const hold: FallbackHold = {};
  assert.equal(promptFallbackReached(hold, true, 1_000, 300), false);
  assert.equal(promptFallbackReached(hold, true, 1_299, 300), false);
  assert.equal(promptFallbackReached(hold, true, 1_300, 300), true);
  assert.equal(promptFallbackReached(hold, false, 1_301, 300), false);
  assert.equal(hold.since, undefined);
  assert.equal(promptFallbackReached(hold, true, 1_302, 300), false);
  assert.equal(promptFallbackReached(hold, true, 1_602, 300), true);
});

test("境界値: holdMs が 0 なら、条件が成り立った最初の確認で真になる", () => {
  assert.equal(promptFallbackReached({}, true, 5, 0), true);
  assert.equal(promptFallbackReached({}, false, 5, 0), false);
});

test("反例: 応答中（スピナーの描き直し中）の画面は、受信が終わっていても終了とみなさない", async () => {
  await withSession(withoutTurnLine({ FAKE_SPIN_MS: "50", FAKE_TURN_MS: "1500" }), async (session) => {
    await session.ready();
    await session.submit("busy");
    const startedAt = Date.now();
    await session.waitIdle(5_000, undefined, () => true);
    assert.ok(Date.now() - startedAt >= 1_500, "fake が入力欄を描き直す前に終えてはならない");
  });
});

test("反例: 応答中の表示の後ろに入力欄が描かれていても、受信が終わるまでは終了とみなさない", async () => {
  await withSession(withoutTurnLine({ FAKE_PROMPT_WHILE_BUSY: "1", FAKE_SPIN_MS: "50", FAKE_TURN_MS: "3000" }), async (session) => {
    await session.ready();
    await session.submit("busy");
    const startedAt = Date.now();
    await session.waitIdle(5_000, undefined, () => Date.now() - startedAt >= 1_000);
    assert.ok(Date.now() - startedAt >= 1_300, "受信完了から promptFallbackMs 経つ前に終えてはならない");
  });
});

test("反例: 終了行が無く受信も終わっていなければ、入力欄があっても timeoutMs で打ち切る", async () => {
  await withSession(withoutTurnLine({ FAKE_TURN_MS: "200" }), async (session) => {
    await session.ready();
    await session.submit("stalled");
    const startedAt = Date.now();
    await assert.rejects(session.waitIdle(800, () => startedAt, () => false), /timed out: it did not finish its turn within 800ms/);
  });
});

test("反例: responseComplete を渡さない呼び出しは、終了行が無ければ従来どおり打ち切る", async () => {
  await withSession(withoutTurnLine({ FAKE_TURN_MS: "200" }), async (session) => {
    await session.ready();
    await session.submit("legacy");
    const startedAt = Date.now();
    await assert.rejects(session.waitIdle(800, () => startedAt), /timed out/);
  });
});

test("終了行を取りこぼしても、受信完了と入力欄が promptFallbackMs 続けばターンを終える", async () => {
  await withSession(withoutTurnLine({ FAKE_TURN_MS: "200" }), async (session) => {
    await session.ready();
    await session.submit("done");
    const startedAt = Date.now();
    await session.waitIdle(5_000, undefined, () => true);
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 300 && elapsed < 3_000, String(elapsed));
  });
});

test("終了行がある通常のターンは、補助判定を待たずに終える", async () => {
  await withSession({ promptFallbackMs: 2_000 }, async (session) => {
    await session.ready();
    await session.submit("normal");
    const startedAt = Date.now();
    await session.waitIdle(5_000, undefined, () => false);
    assert.ok(Date.now() - startedAt < 1_500);
  });
});
