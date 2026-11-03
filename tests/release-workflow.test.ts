import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
const [verification, publishing] = workflow.split("\n  publish:\n");

test("公開はタグpushだけを起点とし、所有者とバージョン・mainの検査を経由する", () => {
  assert.match(workflow, /push:\s+tags:\s+- 'v\*'/);
  assert.doesNotMatch(workflow, /pull_request|workflow_dispatch|branches:/);
  assert.equal(workflow.match(/if: github.actor == github.repository_owner/g)?.length, 2);
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
