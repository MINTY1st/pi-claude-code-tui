import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function validateRelease(input) {
  if (!input.owner || input.actor !== input.owner) throw new Error("only the repository owner can release");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(input.version)) throw new Error("only stable versions are supported");
  if (input.ref !== `refs/tags/v${input.version}`) throw new Error("tag version mismatch");
  if (input.lockVersion !== input.version || input.rootVersion !== input.version) throw new Error("lock version mismatch");
  if (!input.onMain) throw new Error("release commit must be on main");
}

export function checkRelease() {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  // Fetch the branch explicitly: a tag checkout need not have a remote main ref.
  execFileSync("git", ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  validateRelease({
    ref: process.env.GITHUB_REF, actor: process.env.GITHUB_ACTOR,
    owner: process.env.GITHUB_REPOSITORY_OWNER, version: manifest.version,
    lockVersion: lock.version, rootVersion: lock.packages?.[""]?.version,
    onMain: spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", "refs/remotes/origin/main"]).status === 0,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) checkRelease();

