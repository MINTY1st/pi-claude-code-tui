# 実装ノート

## 実装した内容

- お手本 `examples/relay-failure.ts` を `src/relay-failure.ts` にコピーした。
- お手本 `examples/relay-failure.test.ts` と `examples/turn-relay-failure.test.ts` を `tests/` にコピーした。
- `src/turn-relay.ts` の失敗記録を `RelayFailure` に変え、`AnthropicCapture` の解析と `onEvent` の例外を `CaptureError` で包んだ。`http.request` の `timeout` とコンストラクタの `timeoutMs` を削除した。
- `src/tui-process.ts` と `src/claude-cli.ts` の最終エラー文言の組み立てを `incompleteUpstreamMessage` に置き換えた。
- `src/pty-session.ts` の `waitIdle` のタイムアウト文言を `Claude Code timed out: it did not finish its turn` に変えた。
- `tests/turn-relay.test.ts` の `new TurnRelay` から `5_000` を削除した。
- `tests/pty-session.test.ts` に無応答の打ち切りの再試行判定テストを追加した。
- `README.md` の Configuration 節に再試行の文言の段落を追加した。

## 検証

- `npm test`: 151件合格（失敗 0）
- `npm run check`: 合格
- `grep -n "timeout:" src/turn-relay.ts`: 出力なし
- `grep -n "relay failure" src/tui-process.ts src/claude-cli.ts`: 出力なし

## 設計との差異・補足

- 静的確認の `grep -rn "isRetryableAssistantError" tests/` は、既存の `tests/billing.test.ts` も含めて4ファイルを返す。`billing.test.ts` は本変更前から判定を呼んでいる。
- `tests/turn-relay-failure.test.ts` の実行をシェルのパイプ（`| head`）に接続すると、テスト結果を出力したあとテストランナーが終了せず待ち続けた。標準出力をファイルへリダイレクトした実行では約0.6秒で終了した。テストコード自体のハングではない。
