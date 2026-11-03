import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TuiSession, type TuiSessionOptions } from "../src/pty-session.ts";

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
