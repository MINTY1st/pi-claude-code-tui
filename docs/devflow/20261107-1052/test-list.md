# テストリスト

対象: `src/relay-failure.ts`（`tests/relay-failure.test.ts`）、`src/turn-relay.ts`（`tests/turn-relay-failure.test.ts`・`tests/turn-relay.test.ts`）、`src/pty-session.ts`（`tests/pty-session.test.ts`）。各項目の括弧内は、お手本のテスト名である。

進め方:

1. `tests/relay-failure.test.ts` を先に置き、`src/relay-failure.ts` は型とエクスポート名だけをそろえた仮の実装で作る。文字列を返す関数は `""`、真偽値を返す関数は `false`、`relayFailure` は `{ kind, summary: "", detail: "" }` を返し、`CaptureError` は `super("")` だけを呼ぶ（import 解決の失敗ではなく AssertionError で落ちる Red を確認するため）。上から1件ずつお手本の実装に置き換えて Green にする。
2. `tests/turn-relay-failure.test.ts` を置き、`src/turn-relay.ts` を変更する前に実行して Red を確認する。`failure?.kind` が `undefined` になる AssertionError で落ちることを確かめる（`npm run check` は Green 後に確認する）。
3. `tests/pty-session.test.ts` に追加し、`waitIdle` の文言変更前に Red を確認する。
4. `src/tui-process.ts`・`src/claude-cli.ts` の置き換えと `timeout` 削除を行い、全体確認を実行する。

すべての「Pi が再試行する / しない」は、`@earendil-works/pi-ai` の `isRetryableAssistantError` を実際に呼んで判定する。

## 例外の記述（`describeError`・`relayFailure`・`CaptureError`）

- [ ] code 付き Error は `Error [ECONNRESET]: aborted`、数値 code は `Error [42]: bad`、message 空は `TypeError`、Error 以外は `String` の結果になる（describeError は name・code・message を残す）
- [ ] `AggregateError`（外側 code `ECONNREFUSED`、message 空、内側2件）は外側の name・code と、内側2件の name・code・message を `; ` で並べる。内側が0件なら `AggregateError: none` のように展開しない（describeError は AggregateError の中の errors を1段だけ並べる）
- [ ] 境界値: ちょうど1000文字はそのまま、1001文字以上は先頭1000文字 + `…`（計1001文字）になる（describeError は1000文字で切り…）
- [ ] `CaptureError` は `name` が `CaptureError`、`cause` が元の例外、message が `Claude Code stream handling failed: Error: ...` になる
- [ ] `relayFailure` は `summary` に name と code、`detail` に全文を入れる。Error 以外は `summary` が `UnknownError` になる

## 最終エラー文言と再試行判定（`incompleteUpstreamMessage`）

- [ ] 接続失敗（`connect`、status なし）は `Claude Code upstream connection error: ` で始まり、全文が期待値と一致し、Pi が再試行する
- [ ] 切断（`disconnect`）の status 200・500・529 は `Claude Code upstream connection lost: ` で始まり、`relay failure Error [ECONNRESET]: aborted` を含み、Pi が再試行する
- [ ] 境界値: 切断の status 400・499 は固定句を付けず、`relay failure Error [ECONNRESET]`（message の `socket hang up` を含まない）になり、Pi は再試行しない
- [ ] 4xx 応答（status 400、failure なし、`invalid_request_error` の本文）は変更前と同じ文言で、Pi は再試行しない
- [ ] status 429 は既存どおり Pi が再試行する（本変更で挙動を変えないことの固定）
- [ ] `capture`（ツール一覧外の `Claude Code returned unavailable tool foo`、`JSON.parse` の `SyntaxError`）は元の記述を含み、`isTransientRelayFailure` が false で、Pi は再試行しない
- [ ] `request`（`transformRequest` の例外）は `relay failure Error: PI_CLAUDE_CODE_BAD_TRANSCRIPT` を含み、Pi は再試行しない
- [ ] failure が無い不完全応答（status 200）は `Incomplete Claude Code upstream response (status 200, capture incomplete)` のままで、Pi は再試行しない
- [ ] `denied > 0` で `native retries denied 2` を出し、`upstream said` は境界値として600文字の本文を500文字で切る
- [ ] 課金（`usageCreditsChargeError`・`describeUsageCreditsRejection`）とツール一覧外（`Claude Code returned a tool outside Pi's current tool inventory`）は Pi が再試行しない

## relay の失敗記録（`TurnRelay`、実 HTTP の上流で確かめる）

- [ ] 閉じたポートへの接続失敗で、TUI へ 502 を返し、`failure.kind` が `connect`、`detail` が `Error [ECONNREFUSED]`（または `AggregateError [ECONNREFUSED]`）で始まり `connect ECONNREFUSED` を含み、`status` は `undefined`、Pi が再試行する
- [ ] 上流が応答ヘッダーの前に接続を切ると、TUI へ 502 を返し、`failure` が `connect` / `Error [ECONNRESET]: socket hang up` で、Pi が再試行する
- [ ] 200 のヘッダーと `message_start` を送ったあと上流が切ると、`status` 200、`failure` が `disconnect` / `Error [ECONNRESET]: aborted` で、Pi が再試行する
- [ ] 4xx でデータが変わらない: 400 の本文の途中で上流が切ると、`failure` は `disconnect` だが最終文言に `aborted` を含まず、`capture.message` は `undefined` のままで、Pi は再試行しない
- [ ] `onEvent` が投げると、`failure` が `capture` / `CaptureError: Claude Code stream handling failed: Error: Claude Code returned unavailable tool foo` で、上流への要求は1回だけで、Pi は再試行しない
- [ ] SSE の `data` が壊れた JSON だと、`failure` が `capture` で `detail` に `SyntaxError: ` 以降の元の message を含み、Pi は再試行しない
- [ ] `transformRequest` が投げると、TUI へ 502 を返し、`failure` が `{ kind: "request", summary: "Error", detail: "Error: PI_CLAUDE_CODE_BAD_TRANSCRIPT" }` で、上流への要求は0回で、Pi は再試行しない
- [ ] 4xx でデータが変わらない: 400 の応答を最後まで受けると、TUI へ 400 をそのまま返し、`failure` は `undefined`、`capture.message` は `undefined`、`errorText()` は本文の `error.message` で、Pi は再試行しない
- [ ] 同時実行: 接続失敗のあとに届いた2回目の要求は 400 で拒否し、`denied` が1、`failure` は最初の `connect` のまま、最終文言に `native retries denied 1` を含み、Pi が再試行する
- [ ] 状態遷移: `beginTurn` で前のターンの `failure` を `undefined` に戻し、最終文言は再試行対象でなくなる
- [ ] 権限: 経路違い（`/v1/other`）の要求は 404 を返し、`failure` を記録せず、`used` は false のままである
- [ ] 既存の `tests/turn-relay.test.ts` 4件が `new TurnRelay` の `5_000` 引数を削除しただけで合格する（コンストラクタ引数の削除）

## 無応答の打ち切り（`TuiSession.waitIdle`）

- [ ] 上流から何も届かないまま `timeoutMs`（500ms）が過ぎると、例外の message が `Claude Code timed out: it did not finish its turn within 500ms: ` で始まり、Pi が再試行する（`examples/tests-changes.diff` の追加テスト）
- [ ] 既存テストの `/did not finish its turn within 500ms/` を変更せずに合格する
- [ ] `ready` のタイムアウト文言（`Claude Code did not finish loading Pi's tool list`）の既存テストが変更せずに合格する（`waitIdle` 以外の文言を変えていないことの固定）

## 該当なしの観点

- 権限（認証）: relay は認証ヘッダーを中継するだけで、本変更は認可を扱わない。経路違いの 404 だけを上で確かめる。
- トランザクション: 永続化するデータはない。

## 静的確認

- [ ] `grep -n "timeout:" src/turn-relay.ts` が何も出さない
- [ ] `grep -n "relay failure" src/tui-process.ts src/claude-cli.ts` が何も出さない（文言の組み立てが `relay-failure.ts` だけにある）
- [ ] `grep -rn "isRetryableAssistantError" tests/` が `relay-failure.test.ts`・`turn-relay-failure.test.ts`・`pty-session.test.ts` の3ファイルを出す

## 全体確認

- [ ] `npm test` が全件合格する
- [ ] `npm run check` が合格する
