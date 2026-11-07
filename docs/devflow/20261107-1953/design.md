# 設計: src/claude-cli.ts を関心事ごとのファイルへ移す（R1: 移すだけ）

## 結論

`src/claude-cli.ts`（1,146行。依頼文の 1,142行は HEAD `933f4fe` の実測では 1,146行）の最上位の文 52個を、関心事ごとの新しい6ファイルへ1文字も変えずに移す。`src/claude-cli.ts` は、元のファイルが export していた17個の名前を再 export するだけの13行の入口にする。ほかの `src/` のファイルとテストは1行も変えない。

移す作業は `examples/move-statements.mjs` を1回実行して行う。手で切り貼りしない。1,146行を手で写すと先頭コメントの取りこぼしや空行のずれが起きやすく、それを機械で防ぐためである。移した後に `examples/verify-move.mts` で「中身が1文字も変わっていないこと」と「依存の向き」を確かめる。

設計時に一時の作業木（HEAD `933f4fe`）で `move-statements.mjs` を実行し、次を実測した。

| 確認 | 結果 |
| --- | --- |
| `npm run check` | 合格 |
| `npm test` | 214件中214件合格（変更前も214件合格） |
| `verify-move.mts` | `ok: 52 文を照合し、17 個の名前の再 export を確かめた` |
| `git diff --stat` | 7 files changed, 1178 insertions(+), 1146 deletions(-) |
| `tsc --noEmit --noUnusedLocals` | 新しいファイルに未使用の import は無い |

追加が削除より32行多いのは、6つのファイルそれぞれに import 文が要るためである。

## 目的

`src/claude-cli.ts` には、実行ファイルの解決、モデル一覧の取得、プロセスの起動と終了、初回リクエストの書き換え、-p 経路のプロセス管理という5つの関心事が1ファイルに混ざっている。次の依頼（関数の分割や重複の共通化）で差分を関心事ごとに読めるように、先に置き場所だけを分ける。

## 範囲

範囲に入るもの:

- `src/claude-cli.ts` の書き換え（再 export だけの入口にする）
- 新しい6ファイルの追加: `src/claude-spawn.ts`・`src/claude-executable.ts`・`src/claude-models.ts`・`src/initial-request.ts`・`src/claude-print-process.ts`・`src/claude-print-cache.ts`
- 別のファイルから使われるようになる9個の名前に `export` を付けること

範囲に入らないもの（この依頼では行わない）:

- 関数・クラス・型・定数の中身、名前、引数、コメントの変更
- 関数の分割、重複の共通化（次の依頼で行う）
- `src/claude-cli.ts` 以外の `src/` のファイルの変更（`src/index.ts`・`src/provider.ts`・`src/stream.ts`・`src/tui-process.ts`・`src/tui-transcript.ts` の import は `./claude-cli.ts` のまま残す）
- `tests/` の変更
- `examples/move-statements.mjs`・`examples/verify-move.mts` をリポジトリの `scripts/` へ入れること（1回限りの道具のため）

## 変更前と変更後

| 観点 | 変更前 | 変更後 |
| --- | --- | --- |
| `src/claude-cli.ts` | 1,146行。import 24行と最上位の文 52個 | 13行。`export { ... } from "./..."` の文だけ |
| 最上位の文の置き場所 | すべて `src/claude-cli.ts` | structure.md「移す先の表」の6ファイル |
| 外から `./claude-cli.ts` で import できる名前 | 17個（下の表） | 同じ17個 |
| 新たに export される名前 | なし | 9個（structure.md「export を足す名前」）。入口からは再 export しない |
| 未使用の import `dirname`（`node:path`） | `src/claude-cli.ts` 5行目にある | どのファイルにも書かない（どの文も使っていないため。実行時の振る舞いは変わらない） |
| モジュールの状態（`readyStatusCache`・`processCache`・`managerTail`） | `src/claude-cli.ts` に1つずつ | 移した先のファイルに1つずつ。ESM のモジュールは1回だけ評価されるため、入口から読んでも新しいファイルから直接読んでも同じ1つを共有する |
| `registerSessionResourceCleanup(...)` の呼び出し | `src/claude-cli.ts` の読み込み時に1回 | `src/claude-print-cache.ts` の読み込み時に1回。入口が `runClaudeRequest` などを再 export するため、入口を読めば必ず評価される |
| `inert-mcp.mjs` のパス（`new URL("./inert-mcp.mjs", import.meta.url)`） | `src/` 基準 | `src/claude-print-process.ts` も `src/` 直下のため同じパスになる |

元のファイルが export していた17個の名前:

`INSTALL_HINT`・`LOGIN_HINT`・`ClaudeStatus`（型）・`RunClaudeInput`（型）・`RunClaudeOutput`（型）・`resolveClaudeExecutable`・`getClaudeStatus`・`readyClaudeCommand`・`discoverClaudeModels`・`killProcessTree`・`claudeSettingsJson`・`processEnvironment`・`injectNativeSystemMessages`・`rewriteInitialRequest`・`closeClaudeProcesses`・`cachedClaudeProcessCount`・`runClaudeRequest`

このうち `INSTALL_HINT`・`ClaudeStatus`・`resolveClaudeExecutable`・`killProcessTree` の4個は、今はリポジトリの中のどこからも `./claude-cli.ts` 経由で import されていない。それでも入口から再 export する。npm に `src` ごと公開しているため、外部の利用者が `src/claude-cli.ts` から import している可能性を消せず、消すと振る舞いの変更になるからである。

## API・画面・業務ルール・設定・エラー

- API: 公開する関数・型の名前、引数、戻り値は変えない。
- 画面: 変えない。
- 業務ルール: 足さない、変えない。
- 設定: 環境変数（`CLAUDE_CODE_*`・`PI_CLAUDE_CODE_*` など）の読み方は文ごと移すため変わらない。
- エラー: 投げる例外の型と文言（`INSTALL_HINT`・`LOGIN_HINT` など）は文ごと移すため変わらない。

## 実装の手順

1. リポジトリの直下で `node docs/devflow/20261107-1953/examples/move-statements.mjs` を1回実行する。`wrote 6 files and rewrote src/claude-cli.ts` と出る。
2. `npm run check` を実行し、合格することを確かめる。
3. `npm test` を実行し、全件合格することを確かめる（出力は一時ファイルに逃がし、`ℹ tests`・`ℹ pass`・`ℹ fail` の行だけを見る）。
4. `node --experimental-transform-types docs/devflow/20261107-1953/examples/verify-move.mts` を実行し、`ok: 52 文を照合し、17 個の名前の再 export を確かめた` と出ることを確かめる。基準は HEAD の `src/claude-cli.ts` のため、コミットする前に実行する。コミットした後に確かめるときは引数に変更前のコミット（`933f4fe`）を渡す。
5. `git add -N` で新しいファイルを追跡に入れてから `git diff --stat` を実行し、変わったファイルが `src/claude-cli.ts` と新しい6ファイルの7個だけで、追加がおよそ1,178行、削除が1,146行であることを確かめる。
6. 手順2〜5のどれかが失敗したら、`src/` を `git checkout -- src/claude-cli.ts` と新しい6ファイルの削除で元に戻し、原因を `move-statements.mjs` の表（structure.md の表と同じ内容）の側で直してから手順1からやり直す。新しいファイルを手で直さない。

`move-statements.mjs` を2回目に実行すると、入口に移す文が無いため `元のファイルに無い表の名前` のエラーで止まり、何も書き出さない。やり直すときは必ず先に元へ戻す。

## 受け入れ条件

- `npm run check` が合格する。
- `npm test` が全件合格する（設計時の実測は214件）。
- `verify-move.mts` が `ok` を出す。
- `git diff --stat` で変わったファイルが `src/claude-cli.ts` と新しい6ファイルだけであり、`tests/` と他の `src/` のファイルが含まれない。
- 追加の行数と削除の行数の差が import 文の分（設計時の実測で32行）程度に収まる。
- 新しいファイルのどれも `./claude-cli.ts` を import しない。
- 新しいファイルどうしの import が structure.md「依存の向き」の矢印だけである。

## 未決事項

なし。依頼文の「外から import されている名前を再 export する」は、上の理由で「元のファイルが export していた17個すべて」と読んで決めた。この読み方が依頼の意図と違う場合は、入口の再 export から4個を外すだけで済む（`verify-move.mts` の照合も合わせて直す必要がある）。
