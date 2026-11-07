import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const publishWorkflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

function pinnedActions(source: string): Map<string, string> {
  const actions = new Map<string, string>();
  for (const match of source.matchAll(/uses: ([^@\s]+)@(\S+)/g)) actions.set(match[1]!, match[2]!);
  return actions;
}

test("CIはpull_requestとmainへのpushだけを起点にする", () => {
  assert.match(workflow, /^on:\n  pull_request:\n  push:\n    branches:\n      - main\n/m);
  assert.doesNotMatch(workflow, /tags:|workflow_dispatch|pull_request_target|schedule:/);
});

test("CIは読み取り権限だけで動き、資格情報を参照しない", () => {
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.equal(workflow.match(/permissions:/g)?.length, 1);
  assert.doesNotMatch(workflow, /write|id-token|secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN|GH_TOKEN/);
  assert.match(workflow, /persist-credentials: false/);
});

test("CIは所有者に限定せず外部からのPRも検査する", () => {
  assert.doesNotMatch(workflow, /github\.actor|repository_owner/);
});

test("CIはNode 24.22.2でnpm ci --ignore-scripts、npm test、npm run checkの順に実行する", () => {
  assert.match(workflow, /node-version: '24\.22\.2'/);
  const positions = ["checkout@", "setup-node@", "npm ci --ignore-scripts", "npm test", "npm run check"].map(
    (step) => workflow.indexOf(step),
  );
  for (const position of positions) assert.notEqual(position, -1);
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index]! > positions[index - 1]!);
  }
});

test("CIは公開用の手順を含まない", () => {
  assert.doesNotMatch(workflow, /release-guard|npm pack|npm publish|upload-artifact|gh release/);
});

test("CIはジョブtestを1つだけ持ち、10分で打ち切る", () => {
  assert.match(workflow, /^jobs:\n  test:\n/m);
  assert.deepEqual(workflow.split("\njobs:\n")[1]!.match(/^  [a-z-]+:$/gm), ["  test:"]);
  assert.match(workflow, /timeout-minutes: 10/);
});

test("CIの外部ActionsはコミットSHAに固定し、publish.ymlと同じSHAを使う", () => {
  const pinned = pinnedActions(workflow);
  assert.equal(pinned.size, 2);
  for (const [name, ref] of pinned) {
    assert.match(ref, /^[a-f0-9]{40}$/);
    assert.match(name, /^actions\/[a-z-]+$/);
    assert.equal(pinnedActions(publishWorkflow).get(name), ref);
  }
});
