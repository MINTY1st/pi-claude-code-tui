# 実装ノート: src/claude-cli.ts を関心事ごとのファイルへ移す（R1: 移すだけ）

## 実施結果

設計の手順どおり、`docs/devflow/20261107-1953/examples/move-statements.mjs` を1回だけ実行して移設した。ファイルを手で編集していない。

| 検証 | 結果 |
| --- | --- |
| 変更前の `npm test` | 214件中214件合格 |
| 変更前の `npm run check` | 合格 |
| 移設前の `verify-move.mts`（Red の確認） | 終了コード 1。「ファイルが無い: src/claude-spawn.ts」ほか6件と、入口に再 export 以外の文がある旨を出力 |
| 移設後の `npm run check` | 合格 |
| 移設後の `verify-move.mts` | `ok: 52 文を照合し、17 個の名前の再 export を確かめた` |
| 移設後の `npm test` | 214件中214件合格（変更前と同数） |
| `git diff --stat` | 7 files changed, 1178 insertions(+), 1146 deletions(-) |
| `npx tsc --noEmit --noUnusedLocals` | 新しい6ファイルに未使用の import は無い。唯一の指摘は未変更の `src/turn-relay.ts`（`NativeContentBlock`） |

`git diff --stat` の増減は設計の実測（+1178 / -1146）と一致した。差の32行は6ファイル分の import 文である。

## test-list.md の確認結果

- 入口 `src/claude-cli.ts` は13行で、`export ... from` の6文だけを持つ。宣言・import 文・副作用のある文は無い。
- 入口の再 export は元の export 17個と一致し、増減は無い。`ClaudeStatus`・`RunClaudeInput`・`RunClaudeOutput` は `type` 付きで再 export する。
- 新しい6ファイルはどれも `./claude-cli.ts` を import しない。新しいファイルどうしの import は structure.md「依存の向き」の表の向きだけである（`verify-move.mts` が確認）。
- `processCache`・`managerTail`・`withManagerLock` は `src/claude-print-cache.ts` の19〜25行にまとまり、どれも export していない。
- `readyStatusCache` は `src/claude-executable.ts` の117行に1つだけあり、export していない。
- `registerSessionResourceCleanup(...)` の呼び出しは `src/claude-print-cache.ts` の115行に1回だけある（`src/tui-process.ts` の呼び出しは元からある別の用途）。
- `git diff --stat` に出たファイルは `src/claude-cli.ts` と新しい6ファイルだけであり、`tests/` とほかの `src/` のファイルは含まれない。

## fast-guard（Jev 静的 lint）の差し戻しについて

移設直後に fast-guard が24件の指摘を返した。実測すると、いずれも移設前の `HEAD:src/claude-cli.ts` に存在していた違反である。

- 移設前の `HEAD:src/claude-cli.ts` と移設後の6ファイルに同じ lint をかけ、規則と名前の組で集計した。
- 結果は `diff` で完全一致した。内訳は `env` 11件、`args` 4件、`fn` 1件、関数長3件（`discoverClaudeModels`・`create`・`run`）、循環複雑度6件（`run`・`discoverClaudeModels`・`removeRepeatedUserReminders`・`resolveClaudeExecutable`・`rewriteInitialRequest`・`<anonymous>`）。
- `jev-static-lint` は「既定ブランチとの分岐点にある同じパスのファイル」を基準に新しい違反だけを報告する。新しいファイルには基準になる内容が無いため、移設前からある違反がすべて新規違反として報告された。

この依頼は「関数の中身・名前・引数を変えず、移して import と export を直すだけ」であり、structure.md も「50行を超える既存の関数もそのまま移す。分割は次の依頼で行う」と定めている。識別子の改名や関数の分割を行うと依頼の範囲を超えるため、R1 では修正していない。R2（関数の分割と重複の共通化）で、この24件をあわせて解消する。

## 設計文書との差異

なし。設計文書は変更していない。

## 独立レビュー（reviewer）の結果

【APPROVE】。指摘は次の2件で、いずれも [参考] のため R1 では対応せず、ここに記録する。

- [参考] `src/claude-print-cache.ts` だけ文の並びが元と変わる。`MAX_CACHED_CLAUDE_PROCESSES`（元641行目）と `AcquiredProcess`（元1014行目）をファイル先頭に寄せたため。structure.md の「写し方の決まり」が元の隣接を保つのは隣り合っていた文だけと定めているため、この並びになる。振る舞いは変わらない。
- [参考] 元の5行目にあった未使用の import `dirname` をどのファイルにも書いていない。design.md「変更前と変更後」に記載済みで、どの文も使っていないため実行時の振る舞いは変わらない。
