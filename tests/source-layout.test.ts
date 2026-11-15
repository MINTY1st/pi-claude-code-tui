import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

/** 層ごとに import してよい層。直下（"."）の組み立て役だけが経路を選ぶ */
const allowedLayers: Record<string, string[]> = {
  ".": [".", "shared", "request", "relay", "claude", "tui", "print"],
  shared: ["shared"],
  request: ["shared", "request"],
  relay: ["shared", "relay"],
  claude: ["shared", "claude"],
  tui: ["shared", "request", "relay", "claude", "tui"],
  print: ["shared", "request", "relay", "claude", "print"],
};

const rootFiles = ["index.ts", "provider.ts", "stream.ts"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

function layerOf(path: string): string {
  const parts = relative(sourceRoot, path).split("/");
  return parts.length === 1 ? "." : parts[0];
}

function relativeSpecifiers(content: string): string[] {
  return [...content.matchAll(/(?:from\s+|import\(\s*|new URL\(\s*)["'](\.{1,2}\/[^"']+)["']/g)].map((match) => match[1]);
}

test("直下に置くのは組み立て役のファイルだけ", () => {
  const unexpected = sourceFiles(sourceRoot)
    .filter((path) => layerOf(path) === ".")
    .map((path) => relative(sourceRoot, path))
    .filter((name) => !rootFiles.includes(name));
  assert.deepEqual(unexpected, []);
});

test("どのファイルも決めた層のどれかに入っている", () => {
  const unknown = sourceFiles(sourceRoot)
    .map(layerOf)
    .filter((layer) => !(layer in allowedLayers));
  assert.deepEqual(unknown, []);
});

test("import は決めた向きにだけ向いている", () => {
  const violations = sourceFiles(sourceRoot).flatMap((path) => {
    const from = layerOf(path);
    return relativeSpecifiers(readFileSync(path, "utf8"))
      .map((specifier) => resolve(dirname(path), specifier))
      .filter((target) => !(allowedLayers[from] ?? []).includes(layerOf(target)))
      .map((target) => `${relative(sourceRoot, path)} -> ${relative(sourceRoot, target)}`);
  });
  assert.deepEqual(violations, []);
});
