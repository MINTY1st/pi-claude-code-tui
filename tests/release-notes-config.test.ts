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

// The repository does not label pull requests. GitHub drops pull requests that match no category,
// so v0.2.0's generated notes were empty. A single catch-all category lists every merged pull request.
test("release notes list every merged pull request in a single catch-all category", () => {
  assert.deepEqual(readCategories(config), [{ title: "What's changed", labels: ['"*"'] }]);
});

test("release notes exclude no pull requests", () => {
  assert.match(config, /^changelog:\n  categories:\n/);
  assert.doesNotMatch(config, /exclude:/);
});

test("readCategories returns an empty list when there are no categories", () => {
  assert.deepEqual(readCategories("changelog:\n  categories:\n"), []);
});
