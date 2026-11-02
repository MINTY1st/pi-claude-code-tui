import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const inertMcp = fileURLToPath(new URL("../src/inert-mcp.mjs", import.meta.url));

async function exchange(args: string[], requests: object[]): Promise<object[]> {
  const child = spawn(process.execPath, [inertMcp, ...args], { stdio: ["pipe", "pipe", "inherit"] });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stdin.end(requests.map((request) => JSON.stringify(request)).join("\n") + "\n");
  await new Promise((resolve) => child.on("close", resolve));
  return output.trim().split("\n").map((line) => JSON.parse(line));
}

test("tools/list に答えたあと、渡された印のファイルを作る（TUI が入力待ちを出してもツール一覧の取得前であることがあるため）", async () => {
  const root = await mkdtemp(join(tmpdir(), "inert-mcp-"));
  try {
    const manifest = join(root, "tools.json");
    const marker = join(root, "listed");
    await writeFile(manifest, JSON.stringify([{ name: "bash", inputSchema: { type: "object" } }]));
    const responses = await exchange([manifest, marker], [{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    assert.equal((responses[0] as { result: { tools: unknown[] } }).result.tools.length, 1);
    assert.ok(existsSync(marker));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("印のファイルを渡さなければ、従来どおり何も作らない", async () => {
  const root = await mkdtemp(join(tmpdir(), "inert-mcp-"));
  try {
    const manifest = join(root, "tools.json");
    await writeFile(manifest, "[]");
    const responses = await exchange([manifest], [{ jsonrpc: "2.0", id: 1, method: "tools/list" }]);
    assert.deepEqual((responses[0] as { result: unknown }).result, { tools: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
