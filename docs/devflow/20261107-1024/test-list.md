# PR 用 CI とリリースノート自動作成のテストリスト

各項目の太字がテスト名（`test("...")` の第 1 引数）で、その下が 1 テスト内で行う検査である。1 項目を 1 つの `test` にする。検査の書き方は [structure.md](structure.md) 3 章に従う。

## 1. `tests/ci-workflow.test.ts`（新規）

### 起点（正常系と禁止）

- [ ] **CIはpull_requestとmainへのpushだけを起点にする**
  - `assert.match(workflow, /^on:\n  pull_request:\n  push:\n    branches:\n      - main\n/m)`
  - `assert.doesNotMatch(workflow, /tags:|workflow_dispatch|pull_request_target|schedule:/)`

### 権限・資格情報

- [ ] **CIは読み取り権限だけで動き、資格情報を参照しない**
  - `assert.match(workflow, /^permissions:\n  contents: read\n/m)`
  - `permissions:` の出現が 1 回だけ（ジョブ単位の昇格が無い）: `workflow.match(/permissions:/g)?.length` が `1`
  - `assert.doesNotMatch(workflow, /write|id-token|secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN|GH_TOKEN/)`
  - `assert.match(workflow, /persist-credentials: false/)`
- [ ] **CIは所有者に限定せず外部からのPRも検査する**
  - `assert.doesNotMatch(workflow, /github\.actor|repository_owner/)`

### 実行内容

- [ ] **CIはNode 24.22.2でnpm ci --ignore-scripts、npm test、npm run checkの順に実行する**
  - `assert.match(workflow, /node-version: '24\.22\.2'/)`
  - `checkout@`・`setup-node@`・`npm ci --ignore-scripts`・`npm test`・`npm run check` の `indexOf` がすべて `-1` でなく、この順に単調増加する
- [ ] **CIは公開用の手順を含まない**
  - `assert.doesNotMatch(workflow, /release-guard|npm pack|npm publish|upload-artifact|gh release/)`
- [ ] **CIはジョブtestを1つだけ持ち、10分で打ち切る**
  - `assert.match(workflow, /^jobs:\n  test:\n/m)`
  - 2 スペース字下げのキー行（`/^  [a-z-]+:$/gm`）のうち `jobs:` 直後のものが `test:` の 1 件だけ: `workflow.split("\njobs:\n")[1]!.match(/^  [a-z-]+:$/gm)` が `["  test:"]`
  - `assert.match(workflow, /timeout-minutes: 10/)`

### Action の固定（境界）

- [ ] **CIの外部ActionsはコミットSHAに固定し、publish.ymlと同じSHAを使う**
  - `pinnedActions(workflow)` の件数が `2`
  - 各 ref が `/^[a-f0-9]{40}$/` に一致し、各 name が `/^actions\/[a-z-]+$/` に一致する（タグ名 `v4` や 39 桁・41 桁を通さない）
  - 各 name について `pinnedActions(publishWorkflow).get(name)` と ref が等しい

## 2. `tests/release-workflow.test.ts` の `release` ジョブ（追加）

### 既存テストの更新

- [ ] **公開はタグpushだけを起点とし、所有者とバージョン・mainの検査を経由する**（既存・変更）
  - 件数の期待値だけを `2` から `3` に変える。他の検査は変えない
- [ ] 既存の残り 3 テストが文字列を変えずに成功する（分割を変えた後の `publishing` が `release` ジョブを含まないことの確認を兼ねる）

### 状態遷移の禁止（順序）

- [ ] **リリースjobは公開jobの成功後に所有者だけが実行する**
  - `assert.ok(releasing)`（`release` ジョブが存在する）
  - `assert.match(releasing!, /^    needs: publish$/m)`
  - `assert.match(releasing!, /^    if: github\.actor == github\.repository_owner$/m)`
  - `workflow.indexOf("\n  release:\n")` が `workflow.indexOf("\n  publish:\n")` より大きい

### 権限

- [ ] **contents: writeはリリースjobだけに与え、OIDC権限は与えない**
  - `assert.match(releasing!, /permissions:\n      contents: write\n/)`
  - `workflow.match(/contents: write/g)?.length` が `1`
  - `assert.doesNotMatch(verification!, /contents: write/)`、`assert.doesNotMatch(publishing!, /contents: write/)`
  - `assert.doesNotMatch(releasing!, /id-token/)`
  - `assert.match(workflow, /^permissions:\n  contents: read\n/m)`（ワークフロー既定が読み取りのまま）

### 実行内容

- [ ] **リリースjobはタグ名で生成ノート付きのReleaseを作り、タグの存在を確かめる**
  - `assert.match(releasing!, /run: gh release create "\$GITHUB_REF_NAME" --generate-notes --verify-tag$/m)`
  - `assert.doesNotMatch(releasing!, /\$\{\{ github\.ref_name \}\}/)`（式展開をコマンドに埋め込まない）
- [ ] **リリースjobはcheckoutせず、GH_REPOとGH_TOKENでリポジトリを指定する**
  - `assert.match(releasing!, /GH_TOKEN: \$\{\{ github\.token \}\}/)`
  - `assert.match(releasing!, /GH_REPO: \$\{\{ github\.repository \}\}/)`
  - `assert.doesNotMatch(releasing!, /uses:|npm /)`
- [ ] **リリースjobは5分で打ち切る**
  - `assert.match(releasing!, /timeout-minutes: 5/)`

### 同時実行

- [ ] **公開とリリースは同じconcurrencyグループで直列に実行する**
  - `assert.match(workflow, /concurrency:\n  group: npm-release\n  cancel-in-progress: false/)`
  - `concurrency:` の出現が 1 回だけ（ジョブ単位で別グループを作らない）

## 3. `tests/release-notes-config.test.ts`（新規）

- [ ] **リリースノートはfix・feature・docs・ci/choreの順に4区分で分類する**
  - `assert.deepEqual(readCategories(config), [`
    `{ title: "Bug fixes", labels: ["fix"] },`
    `{ title: "Features", labels: ["feature"] },`
    `{ title: "Documentation", labels: ["docs"] },`
    `{ title: "CI and maintenance", labels: ["ci", "chore"] }])`
- [ ] **各ラベルはただ1つの区分に属する**
  - `readCategories(config).flatMap((c) => c.labels)` を `new Set` にした件数が元の配列の件数（`5`）と等しい
- [ ] **依頼に無い除外設定とその他区分を持たない**
  - `assert.match(config, /^changelog:\n  categories:\n/)`
  - `assert.doesNotMatch(config, /exclude:|"\*"|'\*'/)`
- [ ] **readCategoriesは区分が無い文字列から空配列を返す**（ヘルパー自身の境界）
  - `assert.deepEqual(readCategories("changelog:\n  categories:\n"), [])`

## 4. 全体の確認（テストコードにしない手順）

- [ ] `npm test` が全件成功する
- [ ] `npm run check` が成功する
- [ ] `git diff --stat main` に `src/`・`scripts/` が含まれない
- [ ] PR 作成後、`gh pr checks` で `CI / test` が成功する

## 5. 本テストリストで扱わない観点

依頼文の観点のうち、次の 2 つは本変更に該当する対象が無い。

- 4xx でデータが変わらないこと: HTTP API を持たない。対応する観点として、公開失敗時に Release を作らないこと（`needs: publish`）と、タグ不在時に作らないこと（`--verify-tag`）を 2 章で固定している。
- 実行時の同時実行の再現テスト: GitHub Actions の実行基盤を手元で再現できないため、`concurrency` 定義の文字列検査で代える。

---

更新履歴: 2026-11-07 初版（devflow/20261107-1024）
