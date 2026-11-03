import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));

test("所有スコープの公開候補名と public な npm レジストリ設定を使う", () => {
  assert.equal(manifest.name, "@minty1st/pi-claude-code-tui");
  assert.equal(manifest.repository.url, "git+https://github.com/MINTY1st/pi-claude-code-tui.git");
  assert.notEqual(manifest.private, true);
  assert.deepEqual(manifest.publishConfig, { access: "public", registry: "https://registry.npmjs.org/" });
});

test("ロックファイルと動作条件がパッケージ定義に一致する", () => {
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.packages[""].name, manifest.name);
  assert.equal(manifest.engines.node, ">=24.21.0");
  assert.deepEqual(lock.packages[""].engines, manifest.engines);
});

test("配布物に文書と派生元・magpie の MIT 表示を含める", () => {
  assert.deepEqual(manifest.files, ["src", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]);
  assert.equal(manifest.license, "MIT");
  const license = readFileSync(new URL("../LICENSE", import.meta.url), "utf8");
  const notices = readFileSync(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  assert.match(license, /Copyright \(c\) 2026 Armin Ronacher/);
  assert.match(notices, /Copyright \(c\) 2026 yetone/);
  const permissionAndDisclaimer = license.split("\n\n").slice(2).join("\n\n").trim();
  assert.ok(permissionAndDisclaimer.length > 800);
  assert.ok(notices.includes(permissionAndDisclaimer));
});

test("Pi ギャラリー向けのキーワード・拡張定義・ホスト依存を保持する", () => {
  for (const keyword of ["pi-package", "provider", "tui", "pty"]) assert.ok(manifest.keywords.includes(keyword), keyword);
  assert.deepEqual(manifest.pi.extensions, ["./src/index.ts"]);
  for (const dependency of ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"]) {
    assert.equal(manifest.peerDependencies[dependency], "*");
    assert.equal(manifest.dependencies?.[dependency], undefined);
  }
});

test("公開する Markdown 文書をすべて英語で記載する", () => {
  for (const file of ["README.md", "THIRD_PARTY_NOTICES.md"]) {
    const content = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(content, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u, file);
  }
});
