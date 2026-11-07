# PR 用 CI とリリースノート自動作成の設計

## 1. 結論

次の 3 ファイルを追加し、1 ファイルを変更する。本体コード（`src/`）は変更しない。

| 種別 | パス | 内容 |
| --- | --- | --- |
| 追加 | `.github/workflows/ci.yml` | PR と main への push で `npm ci --ignore-scripts`・`npm test`・`npm run check` を Node 24.22.2 で実行する |
| 変更 | `.github/workflows/publish.yml` | `publish` ジョブの後に `release` ジョブを足し、`gh release create` で GitHub Release を作る |
| 追加 | `.github/release.yml` | 自動生成リリースノートのラベル別分類（fix・feature・docs・ci/chore）を定義する |
| 追加 | `tests/ci-workflow.test.ts` | `ci.yml` の構成を固定する |
| 追加 | `tests/release-notes-config.test.ts` | `.github/release.yml` の分類を固定する |
| 変更 | `tests/release-workflow.test.ts` | `release` ジョブの構成を固定し、既存の分割とアサートを 3 ジョブ構成に合わせる |
| 変更 | `README.md` | Development 節と Publishing 節に CI とリリースノートの説明を足す |

ファイルの完成形とテストの書き方は [structure.md](structure.md)、テスト項目は [test-list.md](test-list.md) に記す。

## 2. 目的

現状、テストと型検査はタグ push 時の `publish.yml` の `verify` ジョブでしか走らない。このため PR の段階では CI で壊れたコードを検出できず、リリース直前に初めて失敗が分かる。`ci.yml` を足すことで PR ごとに同じ検査を走らせる。

また、npm 公開後の GitHub Release は手作業で作る必要がある。`release` ジョブを足すことで、公開に成功したタグについて GitHub Release を自動生成し、PR のラベルで分類した変更一覧をリリースノートに載せる。

## 3. 範囲

### 3.1 範囲内

- `ci.yml` の新設
- `publish.yml` への `release` ジョブの追加
- `.github/release.yml` の新設
- 上記の構成を固定するテスト（YAML パーサーは導入せず、既存の `tests/release-workflow.test.ts` と同じく `readFileSync` と正規表現で検査する）
- README の該当節の追記

### 3.2 範囲外

- GitHub 上のラベル（`fix`・`feature`・`docs`・`ci`・`chore`）の作成。2026-11-07 時点の実測では、リポジトリにあるラベルは GitHub 既定の `bug`・`documentation`・`enhancement` 等だけで、上記 5 つは存在しない。また直近のマージ済み PR（#19〜#28）にはラベルが付いていない（`gh pr list --state merged --json labels` で確認）。
- ブランチ保護ルール（CI を必須チェックにする設定）
- `scripts/release-guard.mjs` と `verify` ジョブ・`publish` ジョブの既存の振る舞い
- 依存パッケージの追加（YAML パーサー等は足さない）

## 4. 変更前と変更後

| 観点 | 変更前 | 変更後 |
| --- | --- | --- |
| PR 時の検査 | なし | `ci.yml` の `test` ジョブがテストと型検査を実行する |
| main への push 時の検査 | なし | `ci.yml` の `test` ジョブがテストと型検査を実行する |
| `publish.yml` のジョブ | `verify` → `publish` の 2 つ | `verify` → `publish` → `release` の 3 つ |
| GitHub Release | 手作業 | `release` ジョブが `--generate-notes` で作る |
| リリースノートの分類 | なし | `.github/release.yml` がラベル別に 4 区分へ分類する |
| `contents: write` を持つジョブ | なし | `publish.yml` の `release` ジョブだけ |
| `publish.yml` の `if: github.actor == github.repository_owner` | 2 か所 | 3 か所（`release` にも付ける） |
| 外部 Action の `uses:` 件数（`publish.yml`） | 5 | 5（`release` ジョブは Action を使わない） |

## 5. 振る舞いの仕様

### 5.1 `ci.yml`

1. 起点は `pull_request`（branches・types の絞り込みなし）と `push` の `branches: [main]` の 2 つだけとする。タグ push・`workflow_dispatch`・`pull_request_target` は起点にしない。
2. ワークフロー全体の `permissions` は `contents: read` だけとする。ジョブ単位の `permissions` は書かない。
3. ジョブは `test` の 1 つだけとする。`runs-on: ubuntu-latest`、`timeout-minutes: 10`（`publish.yml` の `verify` と同じ値）。
4. ステップの順序は次のとおり固定する。
   1. `actions/checkout`（`publish.yml` と同じ SHA、`persist-credentials: false`）
   2. `actions/setup-node`（`publish.yml` と同じ SHA、`node-version: '24.22.2'`）
   3. `npm ci --ignore-scripts`
   4. `npm test`
   5. `npm run check`
5. 所有者チェック（`if: github.actor == ...`）は付けない。外部からの PR も検査するためである。
6. シークレット・トークン（`secrets.`、`NPM_TOKEN`、`NODE_AUTH_TOKEN`、`id-token`）は参照しない。
7. `release-guard.mjs`・`npm pack`・artifact のアップロードは行わない。これらは公開時だけの手順である。

### 5.2 `publish.yml` の `release` ジョブ

1. `needs: publish` とする。npm 公開に失敗したタグでは Release を作らない。
2. `if: github.actor == github.repository_owner` を付ける。既存 2 ジョブと同じ所有者限定を保つ。
3. `permissions` はジョブ単位で `contents: write` だけを与える。`id-token` は与えない。ワークフロー全体の `permissions: contents: read` は変えない。
4. `runs-on: ubuntu-latest`、`timeout-minutes: 5`。
5. ステップは 1 つだけとし、Action（`uses:`）は使わない。checkout・setup-node・npm の各コマンドも使わない。ステップは次のコマンドを実行する。

   ```sh
   gh release create "$GITHUB_REF_NAME" --generate-notes --verify-tag
   ```

6. 環境変数として `GH_TOKEN: ${{ github.token }}` と `GH_REPO: ${{ github.repository }}` を渡す。checkout しないため、`gh` はカレントディレクトリからリポジトリを判定できない。`GH_REPO` はその判定の代わりになる。
7. `--verify-tag` により、リモートにタグが無い場合 `gh` は Release を作らずに失敗する。
8. 既存の `concurrency: group: npm-release`（ワークフロー単位）はそのまま残す。`release` ジョブはこのワークフロー内で動くため、別タグの公開と並行しない。

### 5.3 `.github/release.yml`

`changelog.categories` に次の 4 区分をこの順で定義する。区分名は README・コミット文と揃えて英語にする。

| 順 | `title` | `labels` |
| --- | --- | --- |
| 1 | `Bug fixes` | `fix` |
| 2 | `Features` | `feature` |
| 3 | `Documentation` | `docs` |
| 4 | `CI and maintenance` | `ci`, `chore` |

`exclude` と `"*"`（その他）区分は定義しない。依頼に無い分類を足さないためである。いずれのラベルも付いていない PR は、GitHub の仕様により `Other Changes` 見出しの下に出る（GitHub の公開文書に基づく知識であり、本リポジトリでは未実測）。

### 5.4 エラーと失敗時の扱い

| 事象 | 結果 |
| --- | --- |
| PR でテストまたは型検査が失敗 | `ci.yml` の `test` ジョブが失敗する。リポジトリの状態は変わらない |
| `verify` または `publish` が失敗 | `release` は `needs` によりスキップされ、Release は作られない |
| 所有者以外がタグを push | 3 ジョブとも `if` によりスキップされ、npm にも Release にも何も作られない |
| リモートにタグが無い | `--verify-tag` により `gh` が失敗し、Release は作られない |
| 同名の Release が既にある | `gh release create` が失敗する。既存 Release は変更されない |
| `release` だけが失敗 | npm 公開は完了済みのまま残る。GitHub の「Re-run failed jobs」で `release` だけを再実行できる（`publish` は成功済みのため再実行されない） |

## 6. 受け入れ条件

1. `npm test` が全件成功する（新設 2 ファイルと変更後の `tests/release-workflow.test.ts` を含む）。
2. `npm run check` が成功する。
3. `.github/workflows/ci.yml`・`.github/workflows/publish.yml`・`.github/release.yml` の内容が [structure.md](structure.md) の完成形と一致する（コメント行を除く）。
4. `publish.yml` 内で `contents: write` は `release` ジョブに 1 回だけ現れる。
5. `ci.yml` と `publish.yml` の外部 Action はすべて 40 桁のコミット SHA で固定され、同じ Action は両ファイルで同じ SHA を使う。
6. `src/` と `scripts/` に差分が無い。
7. PR を作成すると `ci.yml` の `test` ジョブが走り、成功する（PR 作成後に `gh pr checks` で確認する）。

## 7. 未決事項

1. **ラベルの作成**: `fix`・`feature`・`docs`・`ci`・`chore` の 5 ラベルはリポジトリに存在しない。作らないと全 PR が `Other Changes` に入る。誰がいつ作るか（`gh label create` を手で実行するか、既定ラベル `bug`・`enhancement`・`documentation` を分類に含めるか）は渡部さんが決める。本設計では作成しない。
2. **PR へのラベル付け運用**: PR タイトルの接頭辞（`fix:` 等）からラベルを自動付与する仕組みは依頼に無いため設計しない。手で付けるか、別途自動化するかは未決とする。
3. **`ci.yml` の `concurrency`**: 同じ PR への連続 push で古い実行を取り消す設定（`cancel-in-progress: true`）は依頼に無いため入れない。必要なら別依頼とする。
4. **Release 作成の冪等化**: 同名 Release がある場合に成功扱いにする処理（`gh release view` で事前確認する等）は依頼に無いため入れない。現状は失敗し、手作業で対処する。
5. **`release.yml` の参照元**: `--generate-notes` がどのコミットの `.github/release.yml` を読むか（既定ブランチかタグのコミットか）は未実測である。本変更を main にマージした後の最初のタグで分類が効いているかを確認する。
6. **README の言語**: README は英語で書かれているため、追記も英語とする（[structure.md](structure.md) に文面を示す）。

---

更新履歴: 2026-11-07 初版（devflow/20261107-1024）
