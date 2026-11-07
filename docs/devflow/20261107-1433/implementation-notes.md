# 実装メモ: effort の変更で TUI プロセスを作り直さない

## 結論

設計どおり実装し、実機の判定は30項目すべて `PASS`（`summary: 30 passed, 0 failed`）である。不合格は無い。実機への要求は変更前4回・変更後4回の合計8回で、やり直しは行っていない。

## 変更したファイル

| ファイル | 内容 |
| --- | --- |
| `src/turn-body.ts`（新規） | 定数 `TURN_BODY_KEYS`、型 `TurnBodyKey`・`TurnBody`・`LaunchIdentity`、関数 `turnBodyOf`・`launchIdentity`・`applyTurnBody` |
| `src/tui-process.ts` | `fingerprint` が `launchIdentity` を使う。`TuiWorker.run` の `transformRequest` が `replaceTranscript` の結果に `applyTurnBody` をかける。settings.json を書く箇所に「なぜ」のコメント2行を足す（書く中身は変えない） |
| `tests/turn-body.test.ts`（新規） | `src/turn-body.ts` の単体テスト13件 |
| `tests/tui-process.test.ts` | 実プロセス（偽 claude）を通すテスト9件を末尾に足す。既存のテストは変えない |
| `tests/fixtures/fake-claude.mjs` | `CLAUDE_CODE_EXTRA_BODY` を本文へ浅く混ぜる。環境変数 `FAKE_SETTINGS_LOG` と `FAKE_DROP_BODY_KEYS` を足す |
| `scripts/verify-turn-body.mts`（新規） | 実機の検証スクリプト。`examples/verify-turn-body.mts` をそのまま置いた |
| `tests/pty-session.test.ts` | verify の失敗を直した。経過時間の測定を `Date.now()` から `performance.now()`（単調時計）に変えた。対象は待ち時間を測る5件で、`lastActivityAt` に渡す値は実装と同じ壁時計のままにした |

## お手本（確定差分）との違い

`tests/tui-process.test.ts` の追加テスト1件で、お手本は変数名に `env` を使っている。fast-guard の規約検査（abbreviated-identifier）が `env` を省略形として差し戻したため、`requestEnv` に改名した。オブジェクトのキー名 `env` は `RunClaudeInput` のプロパティ名であり、型を変えないためそのままにした。この1点を除き、お手本の差分と同じである。

## 進め方の記録

1. 変更前に `npm test` が177件合格することを確かめた。
2. 本体を変える前に実機の「変更前」を記録した（`git worktree add --detach /tmp/verify-before HEAD`）。
3. `tests-changes.diff` の内容を `edit`・`write` で入れ、`tests/turn-body.test.ts` が読み込みで失敗することを確かめた（正しい Red ではない）。
4. `src/turn-body.ts` に仮実装を置き、10件だけが落ちることを確かめた（AssertionError 9件と `Missing expected exception` 1件）。内訳は turn-body の8件と tui-process の2件である。
5. `turnBodyOf` → `launchIdentity` → `applyTurnBody` の順に実装し、1つ入れるごとに対象のテストが通ることを見た。
6. `src/tui-process.ts` を import → `fingerprint` → `run` の `transformRequest` → settings.json の前のコメントの順に変え、`fingerprint` の時点で「起動時の settings には…」が、`transformRequest` の時点で「effort だけを変えた…」が通ることを見た。
7. 反例の Red の確かめ方の6つの書き換えを1つずつ入れ、表のテストが AssertionError で落ちることを確かめてから元に戻した。
8. `npm test` 199件合格、`npm run check` 合格を確かめた。
9. 実機の「変更後」を記録し、`compare` が `summary: 30 passed, 0 failed` を出した。

## verify の失敗と修正（2026-11-07）

`npm test` が199件中1件、`反例: 応答中（スピナーの描き直し中）の画面は、受信が終わっていても終了とみなさない` で失敗した。失敗時のメッセージは `elapsed=-1100` で、経過時間が負になっていた。

原因はテストの時間の測り方である。このテストは `submit` の直後に `Date.now()` を取り、`waitIdle` の後で再び `Date.now()` を取って差を求めていた。実行中にシステム時計が約1.1秒巻き戻り、差が負になった。同じ箇所で `process.hrtime.bigint()` を併記して測ると 1839.78ms 経過していた。実装は 1500ms 待ってから補助判定の 300ms を足した時点で終えており、待ち方は設計どおりである。画面にも `● ok` と入力欄がそろっていた。

`tests/pty-session.test.ts` の経過時間の測定を `performance.now()` に変えた。`waitIdle` の `lastActivityAt` に渡す値は実装の `poll` と同じ壁時計でなければ締め切りを比べられないため、`Date.now()` のまま残した。

再現と確認は次のとおりである。

- 修正前のテストを10回実行し、1回失敗することを確かめた（`elapsed=-1115`、`process.hrtime.bigint()` では 1839.78ms）。
- 修正後、同じテストを10回連続で実行し、すべて合格した。
- `npm test` は199件すべて合格し、`npm run check` も合格した。

## 実機の検証（claude-sonnet-5-5）

検証に使ったモデルは `claude-sonnet-5-5` である。claude-opus-5-5 と claude-fable-5-1 は使っていない。実機への要求は変更前4回・変更後4回の合計8回である。

検証スクリプトは `.gitignore` されない `scripts/verify-turn-body.mts` に置いた（`scripts/` は `.gitignore` の対象外）。

### 変更前（`run /tmp/verify-before /tmp/verify-before.jsonl claude-sonnet-5-5`）

```json
{"turn":1,"reasoning":"high","settingsPaths":["/tmp/pi-claude-code-tui-pcf49n/settings.json"],"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"high"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-sonnet-5-5"},"cacheRead":0,"text":"OK1"}
{"turn":2,"reasoning":"low","settingsPaths":["/tmp/pi-claude-code-tui-1LV1Ow/settings.json"],"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"low"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-sonnet-5-5"},"cacheRead":2115,"text":"OK2"}
{"turn":3,"reasoning":"medium","settingsPaths":["/tmp/pi-claude-code-tui-izuy9E/settings.json"],"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"medium"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-sonnet-5-5"},"cacheRead":2451,"text":"OK3"}
{"turn":4,"reasoning":"off","settingsPaths":["/tmp/pi-claude-code-tui-DMVMJn/settings.json"],"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","effort-2025-11-24","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"between_tools"},"output_config":{"effort":"medium"},"context_management":{"edits":[]},"max_tokens":128000,"model":"claude-sonnet-5-5"},"cacheRead":0,"text":"OK4"}
```

### 変更後（`run . /tmp/verify-after.jsonl claude-sonnet-5-5`）

```json
{"turn":1,"reasoning":"high","settingsPaths":["/tmp/pi-claude-code-tui-711965/settings.json"],"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"high"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-sonnet-5-5"},"cacheRead":2434,"text":"OK1"}
{"turn":2,"reasoning":"low","settingsPaths":["/tmp/pi-claude-code-tui-711965/settings.json"],"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"low"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-sonnet-5-5"},"cacheRead":2451,"text":"OK2"}
{"turn":3,"reasoning":"medium","settingsPaths":["/tmp/pi-claude-code-tui-711965/settings.json"],"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"medium"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-sonnet-5-5"},"cacheRead":2469,"text":"OK3"}
{"turn":4,"reasoning":"off","settingsPaths":["/tmp/pi-claude-code-tui-ifOJ8e/settings.json"],"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","effort-2025-11-24","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"between_tools"},"output_config":{"effort":"medium"},"context_management":{"edits":[]},"max_tokens":128000,"model":"claude-sonnet-5-5"},"cacheRead":2491,"text":"OK4"}
```

### 比較（`compare /tmp/verify-before.jsonl /tmp/verify-after.jsonl`）

```
PASS turn 1 body.thinking: before={"type":"adaptive","display":"summarized"} after={"type":"adaptive","display":"summarized"}
PASS turn 1 body.output_config: before={"effort":"high"} after={"effort":"high"}
PASS turn 1 body.context_management: before={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]} after={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}
PASS turn 1 body.max_tokens: before=128000 after=128000
PASS turn 1 body.model: before="claude-sonnet-5-5" after="claude-sonnet-5-5"
PASS turn 1 anthropic-beta: before=["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"] after=["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"]
PASS turn 1 cache_read_input_tokens: before=0 after=2434
PASS turn 2 no-respawn after: ["/tmp/pi-claude-code-tui-711965/settings.json"] -> ["/tmp/pi-claude-code-tui-711965/settings.json"]
PASS turn 2 body.thinking: before={"type":"adaptive","display":"summarized"} after={"type":"adaptive","display":"summarized"}
PASS turn 2 body.output_config: before={"effort":"low"} after={"effort":"low"}
PASS turn 2 body.context_management: before={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]} after={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}
PASS turn 2 body.max_tokens: before=128000 after=128000
PASS turn 2 body.model: before="claude-sonnet-5-5" after="claude-sonnet-5-5"
PASS turn 2 anthropic-beta: before=["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"] after=["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"]
PASS turn 2 cache_read_input_tokens: before=2115 after=2451
PASS turn 3 no-respawn after: ["/tmp/pi-claude-code-tui-711965/settings.json"] -> ["/tmp/pi-claude-code-tui-711965/settings.json"]
PASS turn 3 body.thinking: before={"type":"adaptive","display":"summarized"} after={"type":"adaptive","display":"summarized"}
PASS turn 3 body.output_config: before={"effort":"medium"} after={"effort":"medium"}
PASS turn 3 body.context_management: before={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]} after={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}
PASS turn 3 body.max_tokens: before=128000 after=128000
PASS turn 3 body.model: before="claude-sonnet-5-5" after="claude-sonnet-5-5"
PASS turn 3 anthropic-beta: before=["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"] after=["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"]
PASS turn 3 cache_read_input_tokens: before=2451 after=2469
PASS turn 4 body.thinking: before={"type":"between_tools"} after={"type":"between_tools"}
PASS turn 4 body.output_config: before={"effort":"medium"} after={"effort":"medium"}
PASS turn 4 body.context_management: before={"edits":[]} after={"edits":[]}
PASS turn 4 body.max_tokens: before=128000 after=128000
PASS turn 4 body.model: before="claude-sonnet-5-5" after="claude-sonnet-5-5"
PASS turn 4 anthropic-beta: before=["claude-code-20250219","context-management-2025-06-27","effort-2025-11-24","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"] after=["claude-code-20250219","context-management-2025-06-27","effort-2025-11-24","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"]
PASS turn 4 cache_read_input_tokens: before=0 after=2491
summary: 30 passed, 0 failed
```

### 判定の内訳

- ターン2（high → low）とターン3（low → medium）で、変更後の claude の `--settings` のパスが前のターンと同じ（作り直しが起きない）。変更前は4ターンすべてでパスが変わっていた。
- 4ターンすべてで、上流の本文の `thinking`・`output_config`・`context_management`・`max_tokens`・`model` が変更前と一致する。
- 4ターンすべてで、`anthropic-beta` ヘッダの集合が変更前と一致する。thinking オフのターンに `effort-2025-11-24` が付くことも変更前と同じである。
- 4ターンすべてで、変更後の `cache_read_input_tokens` が変更前以上である（変更前 `0 → 2115 → 2451 → 0`、変更後 `2434 → 2451 → 2469 → 2491`）。
- 4ターンすべてで、変更前・変更後とも要求が成功している。

実機の判定に不合格は無い。

## 未対応の参考事項

reviewer の【参考】指摘は、このターンでは実装せず、次のとおり残す。

- `src/turn-body.ts` の `applyTurnBody` の上で `//` コメントと JSDoc が2段に続いている。1つにまとめると読みやすい（reviewer の【参考】、2026-11-07）。
- `tests/fixtures/fake-claude.mjs` は、`--settings` の引数が無いときや JSON が壊れているときに起動の時点で例外になる。今のテストには影響しない（reviewer の【参考】、2026-11-07）。
- `src/pty-session.ts` の `poll` の締め切りと `promptFallbackReached`、`src/turn-relay.ts` の `lastActivityAt` は `Date.now()` のままである。時計が巻き戻ると締め切りが過去になり、時間切れが早まる可能性がある（20261107-1148 の参考指摘と同じ。今回は実装の待ち方が正しかったため変えていない）。
- `tests/tui-process.test.ts` の経過時間の測定（`Date.now() - startedAt < 10_000`）は壁時計のままで、時計が前に飛ぶと誤って失敗する可能性がある（reviewer の【参考】、2026-11-07）。
- `tests/pty-cleanup.test.ts` の締め切りループは壁時計だが、時計が巻き戻っても待ち時間が延びるだけで、誤って失敗しない（reviewer の【参考】、2026-11-07）。
