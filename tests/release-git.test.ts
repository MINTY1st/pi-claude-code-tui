import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("実際のgit履歴でmain上のコミットを許可し、main外のコミットは拒否する", () => {
  const root = mkdtempSync(join(tmpdir(), "release-guard-"));
  const origin = join(root, "origin.git");
  const repositoryDirectory = join(root, "repo");
  const git = (...commandArguments: string[]) => execFileSync("git", ["-C", repositoryDirectory, ...commandArguments], { stdio: "pipe" });
  try {
    execFileSync("git", ["init", "--bare", origin], { stdio: "pipe" });
    execFileSync("git", ["clone", origin, repositoryDirectory], { stdio: "pipe" });
    git("checkout", "-b", "main");
    git("config", "user.name", "Release test");
    git("config", "user.email", "release@example.invalid");
    writeFileSync(join(repositoryDirectory, "package.json"), JSON.stringify({ version: "1.2.3" }));
    writeFileSync(join(repositoryDirectory, "package-lock.json"), JSON.stringify({ version: "1.2.3", packages: { "": { version: "1.2.3" } } }));
    git("add", ".");
    git("commit", "-m", "initial");
    git("push", "origin", "main");
    const guard = fileURLToPath(new URL("../scripts/release-guard.mjs", import.meta.url));
    const environment = { ...process.env, GITHUB_REF: "refs/tags/v1.2.3", GITHUB_ACTOR: "owner", GITHUB_REPOSITORY_OWNER: "owner" };
    const run = () => spawnSync(process.execPath, [guard], { cwd: repositoryDirectory, env: environment, encoding: "utf8" });
    assert.equal(run().status, 0);
    git("checkout", "-b", "unmerged");
    git("commit", "--allow-empty", "-m", "not on main");
    const rejected = run();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /release commit must be on main/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
