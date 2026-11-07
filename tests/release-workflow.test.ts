import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
const [verification, afterVerification] = workflow.split("\n  publish:\n");
const [publishing, releasing] = afterVerification!.split("\n  release:\n");

test("公開はタグpushだけを起点とし、所有者とバージョン・mainの検査を経由する", () => {
  assert.match(workflow, /push:\s+tags:\s+- 'v\*'/);
  assert.doesNotMatch(workflow, /pull_request|workflow_dispatch|branches:/);
  assert.equal(workflow.match(/if: github.actor == github.repository_owner/g)?.length, 3);
  assert.match(verification!, /node scripts\/release-guard.mjs/);
  assert.match(publishing!, /needs: verify/);
});

test("検証jobはOIDC権限なしでテストし、公開jobは検証済みtarballだけを公開する", () => {
  assert.doesNotMatch(verification!, /id-token:|NODE_AUTH_TOKEN|NPM_TOKEN/);
  assert.match(verification!, /npm ci --ignore-scripts/);
  assert.match(verification!, /npm test/);
  assert.match(verification!, /npm run check/);
  assert.match(verification!, /upload-artifact@/);
  assert.match(publishing!, /id-token: write/);
  assert.match(publishing!, /download-artifact@/);
  assert.doesNotMatch(publishing!, /checkout@|npm ci|npm install|npm test/);
  assert.match(publishing!, /npm publish .*--access public --provenance --ignore-scripts/);
});

test("公開するtarballは./付きで指定し、npmにGitHubのowner/repo省略形と解釈させない", () => {
  assert.match(publishing!, /packages=\(\.\/release\/\*\.tgz\)/);
});

test("外部ActionsはコミットSHAに固定する", () => {
  const actions = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1]!);
  assert.equal(actions.length, 5);
  for (const action of actions) assert.match(action, /^actions\/[a-z-]+@[a-f0-9]{40}$/);
});

test("リリースjobは公開jobの成功後に所有者だけが実行する", () => {
  assert.ok(releasing);
  assert.match(releasing!, /^    needs: publish$/m);
  assert.match(releasing!, /^    if: github\.actor == github\.repository_owner$/m);
  assert.ok(workflow.indexOf("\n  release:\n") > workflow.indexOf("\n  publish:\n"));
});

test("contents: writeはリリースjobだけに与え、OIDC権限は与えない", () => {
  assert.match(releasing!, /permissions:\n      contents: write\n/);
  assert.equal(workflow.match(/contents: write/g)?.length, 1);
  assert.doesNotMatch(verification!, /contents: write/);
  assert.doesNotMatch(publishing!, /contents: write/);
  assert.doesNotMatch(releasing!, /id-token/);
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
});

test("リリースjobはタグ名で生成ノート付きのReleaseを作り、タグの存在を確かめる", () => {
  assert.match(releasing!, /run: gh release create "\$GITHUB_REF_NAME" --generate-notes --verify-tag$/m);
  assert.doesNotMatch(releasing!, /\$\{\{ github\.ref_name \}\}/);
});

test("リリースjobはcheckoutせず、GH_REPOとGH_TOKENでリポジトリを指定する", () => {
  assert.match(releasing!, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(releasing!, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.doesNotMatch(releasing!, /uses:|npm /);
});

test("リリースjobは5分で打ち切る", () => {
  assert.match(releasing!, /timeout-minutes: 5/);
});

test("公開とリリースは同じconcurrencyグループで直列に実行する", () => {
  assert.match(workflow, /concurrency:\n  group: npm-release\n  cancel-in-progress: false/);
  assert.equal(workflow.match(/concurrency:/g)?.length, 1);
});
