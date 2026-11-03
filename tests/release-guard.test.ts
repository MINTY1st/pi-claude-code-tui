import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Release tooling runs directly under Node.
import { validateRelease } from "../scripts/release-guard.mjs";

const valid = {
  ref: "refs/tags/v0.1.3", actor: "owner", owner: "owner",
  version: "0.1.3", lockVersion: "0.1.3", rootVersion: "0.1.3", onMain: true,
};

test("公開タグは所有者による安定版で、manifestとlockが一致しmainに含まれるものだけ許可する", () => {
  assert.throws(() => validateRelease({ ...valid, version: "0.1.2" }), /version/);
  assert.doesNotThrow(() => validateRelease(valid));
});

for (const [label, patch, pattern] of [
  ["他の利用者", { actor: "someone-else" }, /owner/],
  ["mainにないコミット", { onMain: false }, /main/],
  ["lock最上位の不一致", { lockVersion: "0.1.2" }, /version/],
  ["lockルートの不一致", { rootVersion: "0.1.2" }, /version/],
  ["ブランチ", { ref: "refs/heads/main" }, /tag/],
  ["プレリリース", { version: "0.1.3-beta.1", ref: "refs/tags/v0.1.3-beta.1" }, /stable/],
  ["先頭ゼロ", { version: "01.1.3", ref: "refs/tags/v01.1.3" }, /stable/],
  ["空の所有者", { owner: "", actor: "" }, /owner/],
] as const) {
  test(`反例: ${label}では公開を拒否する`, () => {
    assert.throws(() => validateRelease({ ...valid, ...patch }), pattern);
  });
}
