import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const config = readFileSync(new URL("../.github/release.yml", import.meta.url), "utf8");

type Category = { title: string; labels: string[] };

function readCategories(source: string): Category[] {
  return source
    .split("\n    - title: ")
    .slice(1)
    .map((block) => {
      const [firstLine, ...rest] = block.split("\n");
      const labels = [...rest.join("\n").matchAll(/^        - (\S+)$/gm)].map((match) => match[1]!);
      return { title: firstLine!.trim(), labels };
    });
}

test("リリースノートはfix・feature・docs・ci/choreの順に4区分で分類する", () => {
  assert.deepEqual(readCategories(config), [
    { title: "Bug fixes", labels: ["fix"] },
    { title: "Features", labels: ["feature"] },
    { title: "Documentation", labels: ["docs"] },
    { title: "CI and maintenance", labels: ["ci", "chore"] },
  ]);
});

test("各ラベルはただ1つの区分に属する", () => {
  const labels = readCategories(config).flatMap((category) => category.labels);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(labels.length, 5);
});

test("依頼に無い除外設定とその他区分を持たない", () => {
  assert.match(config, /^changelog:\n  categories:\n/);
  assert.doesNotMatch(config, /exclude:|"\*"|'\*'/);
});

test("readCategoriesは区分が無い文字列から空配列を返す", () => {
  assert.deepEqual(readCategories("changelog:\n  categories:\n"), []);
});
