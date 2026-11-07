# テストリスト: src/claude-cli.ts を関心事ごとのファイルへ移す

この依頼はテストコードを変えない。振る舞いが変わらないことは既存のテスト全件と、`examples/verify-move.mts` による機械的な照合で確かめる。新しいテストは足さない。

## 振る舞いが変わらないこと（既存のテストで確かめる）

- [ ] `npm test` が全件合格する（設計時の実測は 214件中214件。変更前と同じ件数であること）
- [ ] `npm run check`（`tsc --noEmit`）が合格する
- [ ] `tests/claude-cli.test.ts` が `../src/claude-cli.ts` から `cachedClaudeProcessCount`・`claudeSettingsJson`・`closeClaudeProcesses`・`discoverClaudeModels`・`rewriteInitialRequest`・`runClaudeRequest` を import でき、全件合格する
- [ ] `tests/billing.test.ts` が `closeClaudeProcesses`・`runClaudeRequest` を入口から import でき、全件合格する
- [ ] `tests/tui-process.test.ts` が型 `RunClaudeInput` を入口から import でき、全件合格する

## 中身を書き換えていないこと（`verify-move.mts` で確かめる）

- [ ] `verify-move.mts` が `ok: 52 文を照合し、17 個の名前の再 export を確かめた` を出す
- [ ] 元の最上位の文 52個がすべて、structure.md「移す先の表」のファイルに1回ずつある（表に無い文も、二重に写した文も無い）
- [ ] 各文は先頭のコメントごと元と1文字も違わない（違うのは `export ` を足した9個の宣言の先頭だけ）
- [ ] 各ファイルの文の並びが表の順と一致する
- [ ] `git diff --stat` の追加と削除の差が import 文の分（設計時の実測で +1178 / -1146）程度に収まる

## 入口（`src/claude-cli.ts`）

- [ ] 入口には `export ... from` の文しか無い（宣言・import 文・副作用のある文が無い）
- [ ] 入口は元の export 17個をすべて再 export する
- [ ] 入口は元に無い名前（`export を足す名前` の9個を含む）を再 export しない（境界値: 公開する名前が増えも減りもしない）
- [ ] 型の名前（`ClaudeStatus`・`RunClaudeInput`・`RunClaudeOutput`）は `type` 付きで再 export され、`--experimental-transform-types` で読み込んでもエラーにならない（`npm test` の合格で確かめる）

## 依存の向き（循環しないこと）

- [ ] どの新しいファイルも `./claude-cli.ts` を import しない
- [ ] 新しいファイルどうしの import が structure.md「依存の向き」の表の向きだけである（`verify-move.mts` が確かめる）
- [ ] `src/claude-cli.ts` と新しい6ファイル以外の `src/`・`tests/` のファイルが `git diff --stat` に出ない（ほかのファイルの import を変えていない）

## 状態と同時実行

- [ ] `processCache`・`managerTail`・`withManagerLock` が同じ `src/claude-print-cache.ts` にあり、どれも export されていない（ロックを通らずに状態を触る経路が増えない）
- [ ] `readyStatusCache` が `src/claude-executable.ts` に1つだけあり、export されていない
- [ ] `registerSessionResourceCleanup(...)` の呼び出しが `src/claude-print-cache.ts` に1回だけある（セッション終了時の後始末が二重に登録されない）
- [ ] 同じセッションへの同時の `runClaudeRequest` とキャッシュの破棄の直列化が変わらない（既存の `tests/claude-cli.test.ts`・`tests/billing.test.ts` の合格で確かめる）

## 該当しない観点

- 権限: この依頼は権限の判定を持たない。
- 状態遷移の禁止: 状態遷移の規則を変えない。`ClaudeProcess` の状態の扱いは文ごと移すため、既存テストの範囲で変わらない。
- 4xx でデータが変わらないこと: HTTP の API を持たない。

## 道具の振る舞い（設計時に確かめ済み。実装担当は再確認だけでよい）

- [ ] `examples/move-statements.mjs` を2回目に実行すると `元のファイルに無い表の名前` で止まり、何も書き出さない
