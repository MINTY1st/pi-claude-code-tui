// Windows の CI はこのファイルだけを動かす。Python や ps に頼る検査はここに置かない
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cmdCommandLine } from "../src/claude/claude-spawn.ts";
import { startNodePty, windowsPtyCommand } from "../src/tui/node-pty-process.ts";
import { defaultPtyBackend } from "../src/tui/pty-process.ts";
import { TuiSession, type TuiSessionOptions } from "../src/tui/pty-session.ts";

const fakeClaude = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

test("Windows では node-pty（ConPTY）、それ以外では Python の補助スクリプトを既定にする", () => {
  assert.equal(defaultPtyBackend("win32"), "node-pty");
  assert.equal(defaultPtyBackend("linux"), "python");
  assert.equal(defaultPtyBackend("darwin"), "python");
});

test("cmdCommandLine は各引数を二重引用符で囲み、中の二重引用符を重ねる", () => {
  assert.equal(cmdCommandLine("C:\\npm\\claude.cmd", ["--tools", "", '{"a":1}']), '"C:\\npm\\claude.cmd" "--tools" "" "{""a"":1}"');
});

test("Windows の .exe はそのまま起動し、引数の引用は node-pty に任せる", () => {
  assert.deepEqual(windowsPtyCommand("C:\\bin\\claude.exe", ["--model", "haiku"], "C:\\Windows\\cmd.exe"), {
    file: "C:\\bin\\claude.exe",
    commandLine: ["--model", "haiku"],
  });
});

test("Windows の .cmd と .bat は cmd.exe /d /s /c で起動し、組み立てたコマンド行をそのまま渡す", () => {
  for (const command of ["C:\\npm\\claude.cmd", "C:\\npm\\CLAUDE.BAT"]) {
    assert.deepEqual(windowsPtyCommand(command, ["--tools", ""], "C:\\Windows\\cmd.exe"), {
      file: "C:\\Windows\\cmd.exe",
      commandLine: `/d /s /c "${cmdCommandLine(command, ["--tools", ""])}"`,
    });
  }
});

test("node-pty を読み込めなければ、起動の失敗として終了を知らせる", async () => {
  const pty = startNodePty({ command: "claude", commandArguments: [], cwd: tmpdir(), environment: {}, columns: 80, rows: 24 }, () => {
    throw new Error("Cannot find module '@lydell/node-pty'");
  });
  const failure = await new Promise<Error | undefined>((resolve) => pty.onExit(resolve));
  assert.match(failure?.message ?? "", /node-pty.*Cannot find module/);
  assert.doesNotThrow(() => pty.write("x"));
  assert.doesNotThrow(() => pty.close());
});

async function withNodePtySession(
  overrides: Partial<TuiSessionOptions> & { screen?: string },
  body: (session: TuiSession, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pty-backend-"));
  const listedMarker = join(root, "listed");
  await writeFile(listedMarker, "");
  const session = TuiSession.start({
    command: process.execPath,
    args: [fakeClaude],
    cwd: root,
    env: { ...process.env, FAKE_SCREEN: overrides.screen ?? "prompt", FAKE_LOG: join(root, "input.log") },
    listedMarker,
    trustFolder: true,
    readyTimeoutMs: 10_000,
    backend: "node-pty",
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

test("node-pty 経由でも、入力欄が描かれれば ready が終わり、貼り付けたターンの終わりを検知できる", async () => {
  await withNodePtySession({}, async (session, root) => {
    await session.ready();
    await session.submit("continue");
    await session.waitIdle(10_000);
    const received = await inputs(root);
    assert.ok(received.includes("\x1b[200~continue\x1b[201~"), JSON.stringify(received));
    assert.ok(received.lastIndexOf("\r") > received.indexOf("\x1b[200~continue\x1b[201~"));
  });
});

test("node-pty 経由でも、フォルダ信頼確認に ↓ と Enter で答えられる", async () => {
  await withNodePtySession({ screen: "trust" }, async (session, root) => {
    await session.ready();
    const received = await inputs(root);
    assert.ok(received.indexOf("\x1b[B") < received.indexOf("\r"));
  });
});

test("node-pty 経由でも、clear で /clear を送って入力待ちに戻るまで待つ", async () => {
  await withNodePtySession({}, async (session, root) => {
    await session.ready();
    await session.clear(10_000);
    assert.ok((await inputs(root)).includes("/clear"));
  });
});

test("node-pty 経由の close で子プロセスを終わらせる", async () => {
  await withNodePtySession({}, async (session) => {
    await session.ready();
    await session.close();
    assert.equal(session.isAlive(), false);
  });
});

test("node-pty 経由で起動できないコマンドは、ready のエラーとして返す", async () => {
  await withNodePtySession({ command: join(tmpdir(), "no-such-claude-command"), args: [] }, async (session) => {
    await assert.rejects(session.ready(), /Claude Code ended|Unable to start/);
  });
});
