# 実装メモ: settings.json に showThinkingSummaries: true を足す

## 結論

`src/claude-cli.ts` に純粋関数 `claudeSettingsJson` を足し、TUI 経路（`TuiWorker.create`）と -p 経路（`ClaudeProcess.create`）の settings.json をこの関数から書くようにした。実機の検証は `hypothesis: confirmed`（21 passed, 0 failed）で、実要求は合計6回（変更前3回・変更後3回、やり直しなし）である。

## 単体テスト

- `npm test`: 214件すべて合格（変更前 210件 + 4件）。
- `npm run check`（`tsc --noEmit`）: 合格。
- 仮実装（`claudeSettingsJson` が `showThinkingSummaries` を書かない形）のとき、`tests/claude-cli.test.ts` と `tests/tui-process.test.ts` の46件中4件が `ERR_ASSERTION` で落ちた。落ちたのは「claudeSettingsJson は showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY には extraBody の JSON 文字列をそのまま入れる」「境界値: claudeSettingsJson は空の extraBody でも showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY は "{}" にする」「runs a request through a stream-json Claude executable」「起動時の settings には thinking のオン・オフによらず showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY は extraBody の JSON のまま渡す」である。「反例: claudeSettingsJson は渡された extraBody を書き換えない」は仮実装の段階でも合格した（test-list.md の想定どおり）。
- test-list.md「反例の Red の確かめ方」の4通りを1つずつ試し、表のテストが落ちることを確かめて戻した。

| 書き換え | 落ちたテスト |
| --- | --- |
| `TuiWorker.create` の行だけを変更前の形に戻す | 「起動時の settings には thinking のオン・オフによらず showThinkingSummaries: true を書き、…」（`tests/tui-process.test.ts` の40件中1件） |
| `ClaudeProcess.create` の行だけを変更前の形に戻す | 「runs a request through a stream-json Claude executable」（`tests/claude-cli.test.ts` の6件中1件） |
| `CLAUDE_CODE_EXTRA_BODY: JSON.stringify(extraBody)` を `CLAUDE_CODE_EXTRA_BODY: extraBody` にする | 「claudeSettingsJson は showThinkingSummaries: true を書き、…」「境界値: …」「runs a request through a stream-json Claude executable」と TUI の結合テスト（46件中34件） |
| キーの順を `{ showThinkingSummaries: true, env: ... }` にする | 「claudeSettingsJson は showThinkingSummaries: true を書き、…」（`tests/claude-cli.test.ts` の6件中1件） |

## 実機の検証

design.md「実機の検証」の手順に従った。変更前の作業木は `/tmp/verify-1918-before`（HEAD `e5c3a51`。設計時の `aeebf0d` から docs のコミットだけが進んでおり、`src/` と `tests/` は同じ）で、`node_modules` は本リポジトリへのシンボリックリンクである。検証スクリプトは `docs/devflow/20261107-1918/examples/verify-thinking-summaries.mts` を `scripts/verify-thinking-summaries.mts` にそのまま複写した。

### 変更前の記録（`/tmp/verify-1918-before.jsonl`）

```jsonl
{"run":1,"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"high"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-opus-5-5"},"cacheRead":0,"blockTypes":["thinking","text"],"thinking":[{"length":0,"signatureLength":892}],"redacted":0,"text":"692"}
{"run":2,"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"high"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-opus-5-5"},"cacheRead":2532,"blockTypes":["text"],"thinking":[],"redacted":0,"text":"37*43=1591, 29*31=899, diff 692.\n\n**692*"}
{"run":3,"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","redact-thinking-2026-02-12","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"high"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-opus-5-5"},"cacheRead":2532,"blockTypes":["thinking","text"],"thinking":[{"length":0,"signatureLength":892}],"redacted":0,"text":"692"}
```

### 変更後の記録（`/tmp/verify-1918-after.jsonl`）

```jsonl
{"run":1,"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"high"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-opus-5-5"},"cacheRead":2532,"blockTypes":["thinking","text"],"thinking":[{"length":112,"signatureLength":892}],"redacted":0,"text":"692"}
{"run":2,"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"high"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-opus-5-5"},"cacheRead":2532,"blockTypes":["text"],"thinking":[],"redacted":0,"text":"37*43=1591, 29*31=899, difference 692.\n\n"}
{"run":3,"ok":true,"betas":["claude-code-20250219","context-management-2025-06-27","extended-cache-ttl-2025-04-11","interleaved-thinking-2025-05-14","mid-conversation-tool-changes-2026-07-01","oauth-2025-04-20","per-turn-control-2026-07-01","thinking-token-count-2026-05-13"],"sent":{"thinking":{"type":"adaptive","display":"summarized"},"output_config":{"effort":"high"},"context_management":{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]},"max_tokens":128000,"model":"claude-opus-5-5"},"cacheRead":2532,"blockTypes":["text"],"thinking":[],"redacted":0,"text":"37*43=1591, 29*31=899, diff 692.\n\n**692*"}
```

### `compare` の出力全文

```text
(node:1946185) ExperimentalWarning: Transform Types is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS records complete: before=[true,true,true] after=[true,true,true]
PASS (1) no redact-thinking-2026-02-12 after: [false,false,false]
PASS (2) thinking text after: [[{"length":112,"signatureLength":892}],[],[]]
PASS (3) run 1 body.thinking: before={"type":"adaptive","display":"summarized"} after={"type":"adaptive","display":"summarized"}
PASS (3) run 1 body.output_config: before={"effort":"high"} after={"effort":"high"}
PASS (3) run 1 body.context_management: before={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]} after={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}
PASS (3) run 1 body.max_tokens: before=128000 after=128000
PASS (3) run 1 body.model: before="claude-opus-5-5" after="claude-opus-5-5"
PASS (4) run 1 cache_read_input_tokens: before=0 after=2532
PASS (3) run 2 body.thinking: before={"type":"adaptive","display":"summarized"} after={"type":"adaptive","display":"summarized"}
PASS (3) run 2 body.output_config: before={"effort":"high"} after={"effort":"high"}
PASS (3) run 2 body.context_management: before={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]} after={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}
PASS (3) run 2 body.max_tokens: before=128000 after=128000
PASS (3) run 2 body.model: before="claude-opus-5-5" after="claude-opus-5-5"
PASS (4) run 2 cache_read_input_tokens: before=2532 after=2532
PASS (3) run 3 body.thinking: before={"type":"adaptive","display":"summarized"} after={"type":"adaptive","display":"summarized"}
PASS (3) run 3 body.output_config: before={"effort":"high"} after={"effort":"high"}
PASS (3) run 3 body.context_management: before={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]} after={"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}
PASS (3) run 3 body.max_tokens: before=128000 after=128000
PASS (3) run 3 body.model: before="claude-opus-5-5" after="claude-opus-5-5"
PASS (4) run 3 cache_read_input_tokens: before=2532 after=2532
INFO before thinking: [[{"length":0,"signatureLength":892}],[],[{"length":0,"signatureLength":892}]]
INFO anthropic-beta only after: []
INFO anthropic-beta only before: ["redact-thinking-2026-02-12"]
summary: 21 passed, 0 failed
hypothesis: confirmed
```

### 結果の読み

- (1) 変更後の3件すべてで anthropic-beta に `redact-thinking-2026-02-12` が無い。変更前にだけあった anthropic-beta はこの1つであり、変更後にだけ増えた値は無い。
- (2) 変更後の run 1 は thinking ブロックの本文が112文字、署名が892文字である。run 2 と run 3 は thinking ブロックを持たない（モデルが思考を省いた）。test-list.md のやり直しの条件「変更後の3件すべてに thinking ブロックが無かった場合」には当たらないため、やり直していない。
- (3) 本文の `thinking`・`output_config`・`context_management`・`max_tokens`・`model` は3組とも一致した。`CLAUDE_CODE_EXTRA_BODY` の中身は変更していないため、上流へ送る本文は変わらない。
- (4) `cache_read_input_tokens` は変更前が 0・2532・2532、変更後が 2532・2532・2532 であり、各組で変更後が変更前以上である。
- 参考: 変更前の thinking は run 1 と run 3 が「本文0・署名892」、run 2 が thinking ブロックなしであった。不具合（本文が空）は変更前の run 1・run 3 で再現し、変更後の run 1 では本文が入った。

## 補足

- 実機の記録はすべて `ok` であり、ターン終了の判定のずれ（design.md「危険と確かめ方」）は見つからなかった。
- `scripts/verify-thinking-summaries.mts` は `scripts/verify-turn-body.mts` と `startProxy` などの形が重なるが、design.md・structure.md の指示どおり共通化していない。リポジトリに jscpd の実行設定が無いため、重複の機械判定は行っていない。本体 `src/` に新しい重複は無い。
- 変更したファイルは design.md「範囲」の表のとおりである（`src/claude-cli.ts`・`src/tui-process.ts`・`tests/claude-cli.test.ts`・`tests/tui-process.test.ts`・`tests/fixtures/fake-claude.mjs`・`scripts/verify-thinking-summaries.mts`・`docs/devflow/20261107-1918/implementation-notes.md`）。
