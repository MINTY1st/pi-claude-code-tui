import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { TuiSession } from "../src/pty-session.ts";

const stubbornClaude = fileURLToPath(new URL("./fixtures/stubborn-claude.mjs", import.meta.url));
const running = (pid: number): boolean => {
  const result = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  return result.status === 0 && !result.stdout.trim().startsWith("Z");
};

for (const shutdown of ["close", "helper-sigterm", "leader-sigterm", "leader-with-pty"]) {
  test(`反例: ${shutdown} 後に SIGHUP を無視する Claude と同じグループの孫が残らない`, async () => {
  const root = await mkdtemp(join(tmpdir(), "pty-cleanup-"));
  const listedMarker = join(root, "listed");
  const pidPath = join(root, "pids.json");
  await writeFile(listedMarker, "");
  const session = TuiSession.start({ command: process.execPath, args: [stubbornClaude, pidPath, ...(shutdown === "leader-with-pty" ? ["--inherit-pty"] : [])], cwd: root, env: process.env, listedMarker, trustFolder: false, readyTimeoutMs: 5_000 });
  let pids: number[] = [];
  try {
    await session.ready();
    pids = JSON.parse(await readFile(pidPath, "utf8"));
    assert.deepEqual(pids.map(running), [true, true]);
    if (shutdown === "close") await session.close();
    else {
      const helperPid = Number(spawnSync("ps", ["-o", "ppid=", "-p", String(pids[0])], { encoding: "utf8" }).stdout.trim());
      assert.ok(helperPid > 1);
      process.kill(shutdown === "helper-sigterm" ? helperPid : pids[0]!, "SIGTERM");
      const deadline = Date.now() + 5_000;
      while (session.isAlive() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.equal(session.isAlive(), false);
    assert.deepEqual(pids.map(running), [false, false]);
  } finally {
    for (const pid of [...pids].reverse()) {
      if (running(pid)) process.kill(pid, "SIGKILL");
    }
    await session.close();
    await rm(root, { recursive: true, force: true });
  }
  });
}
