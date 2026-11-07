# テストリスト

対象: `src/tui-process.ts`（`tests/tui-process.test.ts`）、`package.json`・`package-lock.json`（`tests/package-metadata.test.ts`）。各項目の括弧内はお手本 `examples/tests-changes.diff` のテスト名である。テストは足すだけで、既存のテストは変えない。

## 進め方

1. 変更前に `npm ci --include=dev` と `npm test` を実行し、199件すべて合格することを確かめる（設計時に確認済み）。この環境は `NODE_ENV=production` なので `--include=dev` を省かない。
2. `git apply docs/devflow/20261107-1531/examples/tests-changes.diff` でテストを当てる。
3. 開発依存の Red: `node --experimental-transform-types --test tests/package-metadata.test.ts` を実行し、「型検査と単体テストには、実行環境の Pi と同じ 1.5.0 の pi-ai と pi-coding-agent を使う」の1件だけが AssertionError（actual `'^0.87.0'`、expected `'^1.5.0'`）で落ちることを確かめる。
4. 開発依存の Green: `git apply docs/devflow/20261107-1531/examples/package-changes.diff`、`cp docs/devflow/20261107-1531/examples/package-lock.json package-lock.json`、`npm ci --include=dev` の順に実行し、3 のテストファイルが全件合格すること、`npm run check` が合格することを確かめる。
5. キャッシュの Red: `src/tui-process.ts` の `const workers = new Map<string, TuiWorker>();` の直後に、次の仮実装だけを入れる。import の解決失敗（SyntaxError）ではなく AssertionError で落ちる Red を確かめるためである。`acquire` はまだ変えない。
   ```ts
   export function oldestIdleSession(_entries: Iterable<[string, { busy: boolean; lastUsed: number }]>): string | undefined {
     return undefined;
   }
   ```
6. `node --experimental-transform-types --test tests/tui-process.test.ts` を実行し（約80秒）、39件中、次の7件だけが AssertionError で落ちることを確かめる（設計時に確認済み）。
   - 「oldestIdleSession は使用中でない worker のうち、最後に使ったのが最も古いセッションを選ぶ」（actual `undefined`、expected `'B'`）
   - 「oldestIdleSession は使用中の worker を、最も古くても選ばない」（actual `undefined`、expected `'B'`）
   - 「境界値: oldestIdleSession は最後に使った時刻が同じなら先に入ったセッションを選ぶ」（actual `undefined`、expected `'A'`）
   - 「キャッシュが2つで埋まっていたら、…3つ目のセッションを残す」（actual `[ true, true, false ]`、expected `[ false, true, true ]`）
   - 「最後に使った時刻で選ぶ: …」（「A と C は使い回す」actual 4、expected 3）
   - 「反例: 応答を待っているセッションの Claude Code は、最も古くても追い出さない」（「A と C は使い回す」actual 4、expected 3）
   - 「同時実行: 新しいセッション2つが並んで起動しても、…」（「C と D は使い回す」actual 6、expected 4）
7. 仮実装を消し、`examples/src-changes.diff` の `src/tui-process.ts` の部分を次の順で入れて Green にする。`oldestIdleSession`（単体の3件が通る）→ `makeRoom` と `acquire` の書き換え（残りの4件が通る）。
8. `examples/src-changes.diff` の `src/claude-cli.ts` の部分（コメントのみ）と `examples/readme-changes.diff` を当てる。
9. 「反例の Red の確かめ方」の書き換えを1つずつ試し、表のテストが落ちることを確かめてから元に戻す。
10. 全体確認を実行する。

## 開発依存（`tests/package-metadata.test.ts`）

- [ ] `package.json` の devDependencies、lock のルートの devDependencies が、pi-ai・pi-coding-agent ともに `^1.5.0` であり、lock の `node_modules/@earendil-works/pi-ai` と `node_modules/@earendil-works/pi-coding-agent` の `version` が `1.5.0` である（「型検査と単体テストには、実行環境の Pi と同じ 1.5.0 の pi-ai と pi-coding-agent を使う」）
- [ ] 既存の「ロックファイルと動作条件がパッケージ定義に一致する」が、lock を置き換えた後も合格する（name・version・engines が変わらない）

## 追い出す相手の選び方（`oldestIdleSession`、純粋関数）

- [ ] 正常系: 使用中でないものが複数あれば、`lastUsed` が最小のセッション ID を返す（「oldestIdleSession は使用中でない worker のうち、最後に使ったのが最も古いセッションを選ぶ」）
- [ ] 状態による除外: `busy` が真のものは `lastUsed` が最小でも選ばない（「oldestIdleSession は使用中の worker を、最も古くても選ばない」）
- [ ] 境界値: `lastUsed` が等しければ反復順で先のものを返す（「境界値: oldestIdleSession は最後に使った時刻が同じなら先に入ったセッションを選ぶ」）
- [ ] 境界値: 空の入力、すべて使用中の入力では `undefined` を返す（「境界値: oldestIdleSession は空か、すべて使用中なら undefined を返す」）

## キャッシュの動作（`runTuiRequest` 経由、偽の `claude` を使う統合テスト）

- [ ] 正常系: A・B で満杯のとき C を起動すると、A の TuiSession が閉じ（`isAlive()` が偽）、B と C は生きている。その後 C・B は起動し直さず、A は起動し直す（「キャッシュが2つで埋まっていたら、使われていない最も古いセッションの Claude Code を閉じて、3つ目のセッションを残す」）
- [ ] 選ぶ基準は起動順ではなく最後に使った時刻: A・B・A の順に使ってから C を起動すると、B が追い出され A は残る（「最後に使った時刻で選ぶ: 先に起動しても直前に使ったセッションは残し、その次に古いセッションを追い出す」）

## 状態遷移の禁止（使用中の worker を閉じない）

- [ ] 反例: A が応答待ち（貼り付けで止めている）のとき C を起動すると、A は最も古くても追い出さず、B を追い出す。A の応答は壊れずに返る（「反例: 応答を待っているセッションの Claude Code は、最も古くても追い出さない」）
- [ ] 反例: A・B がともに応答待ちのとき C を起動すると、何も追い出さず C は使い捨てになる。A・B は残り、C の次のターンは起動し直す（「反例: キャッシュがすべて応答待ちなら何も追い出さず、3つ目のセッションは使い捨てで受ける」）
- [ ] 反例: セッション ID の無い要求と、同じセッションへの並行要求は使い捨てで受け、満杯でも何も追い出さない（「反例: セッション ID の無い要求と、同じセッションへの並行要求は、使い捨てで受けて何も追い出さない」）

## 同時実行

- [ ] A・B で満杯のとき、新しい C と D を同時に起動すると、両方を登録し A・B を追い出す。上限 2 を超えて登録せず、同じ空きを二重に数えない（「同時実行: 新しいセッション2つが並んで起動しても、空きを二重に数えず両方を残し、古い2つを追い出す」）

## 該当しない観点

- 権限: この変更には利用者や役割による分岐が無い。
- 4xx でデータが変わらないこと: 上流の 400 を受けた worker は今と同じく `runTrackedRequest` の `catch` で Map から外れて閉じる。追い出しはこの経路を変えないため、既存の「途中で切れた SSE や HTTP 400 は成功結果にせずエラーにする」「反例: 上流が 400 を返したターンのあとも、次のターン…」が全件合格し続けることで確かめる。新しいテストは足さない。
- `readyClaudeCommand` の JSDoc の変更: コメントだけなのでテストを足さない。

## 反例の Red の確かめ方

本体を次のように1か所ずつ書き換えて `tests/tui-process.test.ts` を実行し、表のテストが落ちることを確かめてから元に戻す（3つとも設計時に確認済み。`tsc` は3つとも通る）。

| 書き換え | 落ちるテスト |
| --- | --- |
| `oldestIdleSession` の `worker.lastUsed < oldest.lastUsed` を `<=` にする | 「境界値: oldestIdleSession は最後に使った時刻が同じなら先に入ったセッションを選ぶ」の1件 |
| `oldestIdleSession` の `!worker.busy &&` を消す | 「oldestIdleSession は使用中の worker を、最も古くても選ばない」「境界値: oldestIdleSession は空か、すべて使用中なら undefined を返す」「反例: 応答を待っているセッションの…」「反例: キャッシュがすべて応答待ちなら…」の4件 |
| `acquire` で `makeRoom()` と追い出した worker の `close` を `TuiWorker.create` の前に移し、create の後は `room && !workers.has(sessionId) && workers.size < MAX_CACHED` のときだけ登録する | 「同時実行: 新しいセッション2つが並んで起動しても、…」の1件（D が使い捨てになり、起動回数が 5 になる） |

## 全体確認

- [ ] `npm test` が 210件すべて合格する（出力は一時ファイルへ逃がし、`ℹ tests`・`ℹ pass`・`ℹ fail` の行と失敗箇所だけを見る）
- [ ] `npm run check` が合格する
- [ ] `grep '"version"' node_modules/@earendil-works/pi-ai/package.json node_modules/@earendil-works/pi-coding-agent/package.json` がどちらも `1.5.0` を示す
- [ ] `git diff --stat` が design.md の「範囲」の7ファイルだけを含み、`src/claude-cli.ts` の差分がコメント行だけである
