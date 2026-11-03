import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

test("派生版の名前と GitHub URL を使い npm への誤公開を防ぐ", () => {
  assert.equal(manifest.name, "pi-claude-code-tui");
  assert.equal(manifest.repository.url, "git+https://github.com/MINTY1st/pi-claude-code-tui.git");
  assert.equal(manifest.private, true);
  assert.equal(manifest.publishConfig, undefined);
});

test("ロックファイルと動作条件がパッケージ定義に一致する", () => {
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.packages[""].name, manifest.name);
  assert.equal(manifest.engines.node, ">=24.21.0");
  assert.deepEqual(lock.packages[""].engines, manifest.engines);
});

test("配布対象に設計書の参照する docs と元の MIT ライセンスを含める", () => {
  assert.ok(manifest.files.includes("docs"));
  assert.ok(manifest.files.includes("LICENSE"));
  assert.equal(manifest.license, "MIT");
  const license = readFileSync(new URL("../LICENSE", import.meta.url), "utf8");
  assert.match(license, /Copyright \(c\) 2026 Armin Ronacher/);
});
