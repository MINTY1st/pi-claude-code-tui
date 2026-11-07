# テストリスト: R2 の分割と共通化

振る舞いを変えないリファクタなので、確かめることは2種類ある。1つは新しい共通部品の振る舞いで、`tests/response-checks.test.ts`（examples/response-checks.test.ts をコピーしたもの）に新しく書く。もう1つは「変更前と同じに動くこと」で、既存のテストが守る。既存のテストは1行も変えない。

## 進め方（t-wada 流 TDD）

1. 共通部品は Red から始める。`tests/response-checks.test.ts` を置いた直後は `src/response-checks.ts` と `guardUsageCredits` が無いため、モジュールの解決エラー（構文エラーに近い失敗）になる。先に `src/response-checks.ts` と `guardUsageCredits` を「常に投げる仮実装」（例: `throw new Error("not yet")`）で置き、AssertionError で落ちることを確かめてから examples の本体へ置き換える。
2. 呼び替えと分割は Refactor として行う。始める前と各手順の後で `npm test` が全件 Green であることを確かめ、テストを変えずにプロダクションコードだけを動かす。
3. 手順は「共通部品 → `tui-process.ts` の呼び替え → `claude-print-process.ts` の呼び替え → `turn-relay.ts` の分割 → `stream.ts` の分割」の順にする。1つ終えるごとに `npm run check` と関連テストを流す。

## 1. 共通部品（新規: tests/response-checks.test.ts）

### capturedMessage（応答の完全性）

- [ ] 正常系: 200 で最後まで受け取った応答の message を、同じ参照で返す
- [ ] 200 でも message_stop まで届いていなければ、`Incomplete Claude Code upstream response (status 200, capture incomplete)` で投げる
- [ ] 4xx を受け取り終えていても投げ、上流の文言を載せる（`status 400, capture complete, upstream said: ...`）
- [ ] 境界値: complete でも message が無ければ投げる
- [ ] 境界値: status が無い（上流へ届かなかった）とき `status unknown` として投げる
- [ ] 文言は `incompleteUpstreamMessage` と同じで、接続失敗なら Pi が再試行する文言（`Claude Code upstream connection error: `）になる
- [ ] 4xx でデータが変わらない: 投げても渡された結果（status・denied・capture）を書き換えない

### completeUsage（usage の検証）

- [ ] 正常系: input_tokens と output_tokens が数なら、同じ usage をそのまま返す
- [ ] usage が無ければ `Claude Code response did not include complete token usage` で投げる
- [ ] input_tokens か output_tokens の片方が欠けているか、数でなければ投げる
- [ ] 境界値: 0 トークンを欠けとみなさずに通す

### guardUsageCredits（課金ガード）

- [ ] rateLimit が無いか、プラン枠の内（isUsingOverage が false）なら何もしない
- [ ] 使用量クレジットで払われた応答を、`usageCreditsChargeError` と同じ文言で止め、Pi は再試行しない
- [ ] 権限: 許可の環境変数 `PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS` が有効なら止めず、`0` なら止める
- [ ] 境界値: isUsingOverage が `true` そのもののときだけ止める（文字列の `"true"` では止めない）
- [ ] 反例: process.env を読まず、渡された環境変数だけで決める（process.env に許可があっても、渡された環境変数に無ければ止める）

## 2. 変更前と同じに動くこと（既存テスト。変えずに全件 Green を保つ）

括弧の中は、その振る舞いを守る既存テストのファイルである。

### 共通化した3つのチェック（両方の経路）

- [ ] TUI 経路: 途中で切れた SSE や HTTP 400 は成功にせずエラーにする（`tests/tui-process.test.ts`）
- [ ] TUI 経路: 使用量クレジットで払われた応答は billing エラーで止める（`tests/tui-process.test.ts`）
- [ ] -p 経路: 使用量クレジットで払われた応答は止まり、許可の環境変数があれば通る（`tests/billing.test.ts` の「stops when Claude Code reports a request was charged to usage credits」「usage credits are opt-in」）
- [ ] -p 経路: 上流の 4xx を incomplete の文言にし、usage-credit の拒否は再試行しない billing の文言にする（`tests/billing.test.ts` の「rewrites usage-credit rejections ...」）
- [ ] 一覧に無いツールは例外にせず tool_use のまま返す（`tests/unknown-tool.test.ts`、`tests/tui-process.test.ts`）。ツール一覧のチェックを書き足していないことをここで確かめる

### TurnRelay.handle の分割

- [ ] 1件の上流要求を中継して SSE を捕まえる（`tests/turn-relay.test.ts`）
- [ ] 経路違いの要求には 404 を返し、failure を残さない（`tests/turn-relay-failure.test.ts`）
- [ ] 状態遷移の禁止: 使用済みの relay への2本目の要求は 400（`PI_CLAUDE_CODE_TURN_RELAY_CONSUMED`）で拒否し、denied を数える（`tests/tui-process.test.ts` の「Claude Code が続けて送る2本の回復要求をすべて拒否する」、`tests/turn-relay-failure.test.ts` の「接続失敗のあとに届いた再送は拒否し…」）
- [ ] 段階: transformRequest が投げたら request、接続できなければ connect、200 の途中で切れたら disconnect、onEvent や SSE の解析が投げたら capture として残す（`tests/turn-relay-failure.test.ts`）
- [ ] 4xx でデータが変わらない: 400 の本文の途中で切れても message を出さず再試行もしない。400 を最後まで受けたら failure を残さず、本文を TUI にそのまま返す（`tests/turn-relay-failure.test.ts`）
- [ ] 上流のレスポンスヘッダーから rateLimit を作り、ターンの始めに消す（`tests/turn-relay.test.ts`）
- [ ] 上流から届くたびに lastActivityAt を進める（`tests/turn-relay.test.ts`）
- [ ] 上流へ送る本文はターンの output_config・context_management で書き換え、anthropic-beta を合成する（`tests/tui-process.test.ts` の effort・thinking の各テスト、`tests/claude-cli.test.ts`）
- [ ] 同時実行: 同じセッションへ effort の違う要求が並んでも、それぞれの本文にそれぞれの effort を書く（`tests/tui-process.test.ts`）

### streamClaudeCode の分割

- [ ] 正常系: start から done までのイベントを流し、toolCall を Pi の名前で返す（`tests/claude-cli.test.ts`、`tests/unknown-tool.test.ts`）
- [ ] 守るテストが無い: diagnostics に `claude-code.turn-relay` と、rateLimit があるときの `claude-code.rate-limit` を足すこと。既存テストはこの2件を確かめていない（2026-11-07 に `grep -l "claude-code.turn-relay" tests/*.ts` が何も出さないことを実測）。`turnDiagnostics` の配列の要素は変更前の2つのオブジェクトを1文字も変えずに移し、reviewer に変更前との差分を目で確かめてもらう
- [ ] 中断: Pi の signal で中断した要求、中断済みの signal で始めた要求、セッションの片付けで止めた要求は aborted として記録する（`tests/stream-abort.test.ts`）
- [ ] 反例: 中断でない失敗（Claude Code が見つからない）は error のまま記録する（`tests/stream-abort.test.ts`）
- [ ] エラーの文言は normalizeError を通し、usage-credit の拒否と relay の失敗の再試行判定が変わらない（`tests/billing.test.ts`、`tests/relay-failure.test.ts`、`tests/turn-relay-failure.test.ts`）
- [ ] 同時実行: 同じセッションへの並行要求でも、それぞれの会話を別のプロセスで処理する（`tests/tui-process.test.ts`）

## 3. 機械で確かめること（テストの外）

- [ ] `npm test` が 235 件すべて合格する（219 + 16）
- [ ] `npm run check` が合格する
- [ ] `git diff --stat -- tests/` が `tests/response-checks.test.ts` の追加だけを出す
- [ ] `TurnRelay.handle`・`streamClaudeCode` と、新しく足した関数・メソッドが、すべて 50 行以内である
- [ ] design.md の受け入れ条件の grep がすべて期待どおりに出る
