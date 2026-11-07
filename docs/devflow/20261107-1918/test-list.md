# テストリスト

対象: `src/claude-cli.ts`（`tests/claude-cli.test.ts`）、`src/tui-process.ts`（`tests/tui-process.test.ts`）、偽 claude `tests/fixtures/fake-claude.mjs`、実機の検証 `scripts/verify-thinking-summaries.mts`。各項目の括弧内はお手本 `examples/tests-changes.diff` のテスト名である。新しいテストは4件で、既存のテストは「runs a request through a stream-json Claude executable」に settings の記録と1つの assert を足す以外は変えない。

## 進め方

1. `npm test` を実行し、210件すべて合格することを確かめる（設計時に確認済み）。`npm run check` も合格することを確かめる。
2. 実機の変更前の記録を取る（design.md「実機の検証」の手順1〜3）。本体にもテストにも手を入れる前に行う。`scripts/verify-thinking-summaries.mts` は `cp docs/devflow/20261107-1918/examples/verify-thinking-summaries.mts scripts/` で置く。
3. `git apply docs/devflow/20261107-1918/examples/tests-changes.diff` でテストと偽 claude を当てる。この時点では `claudeSettingsJson` が無く、`tests/claude-cli.test.ts` は import で落ちる（正しい Red ではない）。
4. 仮実装（Red 用）: `src/claude-cli.ts` の `export function processEnvironment(` の直前に、structure.md の `claudeSettingsJson` をコメントごと置く。ただし本体の1行は **変更前の形** `return JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(extraBody) } });` にする。あわせて structure.md のとおり、`ClaudeProcess.create` と `TuiWorker.create` の settings.json を書く行を `claudeSettingsJson(input.extraBody)` に置き換え、`src/tui-process.ts` の import に `claudeSettingsJson` を足す（この時点では振る舞いは変更前と同じ）。
5. `node --experimental-transform-types --test tests/claude-cli.test.ts tests/tui-process.test.ts` を実行し（約80秒）、46件中、次の4件だけが AssertionError で落ちることを確かめる（設計時に確認済み）。
   - 「claudeSettingsJson は showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY には extraBody の JSON 文字列をそのまま入れる」
   - 「境界値: claudeSettingsJson は空の extraBody でも showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY は "{}" にする」
   - 「runs a request through a stream-json Claude executable」（足した settings の assert で落ちる）
   - 「起動時の settings には thinking のオン・オフによらず showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY は extraBody の JSON のまま渡す」
   「反例: claudeSettingsJson は渡された extraBody を書き換えない」はこの時点で合格する（書き換えない実装を Red の段階から守る反例であり、落ちないのが正しい）。
6. Green: `claudeSettingsJson` の本体を structure.md の形（`showThinkingSummaries: true` を含む）にし、5 の4件が通ることを確かめる。
7. 「反例の Red の確かめ方」の書き換えを1つずつ試し、表のテストが落ちることを確かめてから元に戻す。
8. 全体確認を実行する。
9. 実機の変更後の記録と比較を行う（design.md「実機の検証」の手順5〜7）。`hypothesis: rejected` なら design.md「推論が外れたとき」に従って止める。

## settings.json の文字列（`claudeSettingsJson`、純粋関数）

- [ ] 正常系: thinking オンの `extraBody` を渡すと、`JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(extraBody) }, showThinkingSummaries: true })` と文字列として一致する。キーの順（`env`、`showThinkingSummaries`）も含めて決まる（「claudeSettingsJson は showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY には extraBody の JSON 文字列をそのまま入れる」）
- [ ] 境界値: 空の `extraBody`（`{}`）でも `showThinkingSummaries: true` を書き、`CLAUDE_CODE_EXTRA_BODY` は `"{}"` になる（「境界値: claudeSettingsJson は空の extraBody でも showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY は "{}" にする」）
- [ ] 反例: thinking オフの `extraBody` を渡しても、呼んだ後の `extraBody` は呼ぶ前と deepEqual である（「反例: claudeSettingsJson は渡された extraBody を書き換えない」）

## TUI 経路（`TuiWorker.create`、偽 claude の `FAKE_SETTINGS_DOC_LOG`）

- [ ] thinking オン（`thinkingOn("high")`）で起動した Claude Code が読む settings.json は `{ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(thinkingOn("high")) }, showThinkingSummaries: true }` である。thinking オフ（`{ thinking: { type: "disabled" }, context_management: { edits: [] } }`）に切り替えて起動し直した Claude Code が読むものも、同じく `showThinkingSummaries: true` を持ち、`CLAUDE_CODE_EXTRA_BODY` はそのターンの `extraBody` の JSON である。記録はちょうど2行である（「起動時の settings には thinking のオン・オフによらず showThinkingSummaries: true を書き、CLAUDE_CODE_EXTRA_BODY は extraBody の JSON のまま渡す」）
- [ ] 回帰（既存、変えない）: `CLAUDE_CODE_EXTRA_BODY` の中身は起動したターンの値のままで、effort を変えても書き直さない（「起動時の settings には起動したターンの output_config を残し、effort を変えても書き直さない」）
- [ ] 回帰・状態遷移（既存、変えない）: effort だけを変えたターンは作り直さない（「effort だけを変えた次のターンは Claude Code を作り直さず、そのターンの output_config を上流へ送る」）。`showThinkingSummaries` を足しても作り直しの回数は増えない
- [ ] 回帰・状態遷移（既存、変えない）: thinking のオン・オフを切り替えたターンは作り直す（「thinking のオン・オフを切り替えたターンは Claude Code を作り直す」）

## -p 経路（`ClaudeProcess.create`、既存テストの偽 claude の `SETTINGS_LOG`）

- [ ] 最初の `runClaudeRequest`（`extraBody: { tools: [] }`）で起動した Claude Code が読む settings.json は `{ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify({ tools: [] }) }, showThinkingSummaries: true }` の1行だけである。`discoverClaudeModels` の起動は `SETTINGS_LOG` を渡さず、`--settings` も無いため記録しない（「runs a request through a stream-json Claude executable」に足す assert）

## 権限・4xx・同時実行

- [ ] 権限: 新しい権限の判定は無い。既存の `--setting-sources ""`・`--strict-mcp-config`・`--allowedTools mcp__pi` は変わらない（「tuiArgs は -p 系のフラグを使わず、Pi のツールだけを許可する」が合格のまま）
- [ ] 4xx でデータが変わらないこと: 上流が 4xx を返した既存のテスト（`tests/tui-process.test.ts`・`tests/turn-relay-failure.test.ts` の失敗系）がすべて合格のままである。settings.json は worker の一時ディレクトリにしか書かず、利用者の `~/.claude/settings.json` には書かない（`--setting-sources ""` と一時ディレクトリのまま。変更なし）
- [ ] 同時実行: 並行して起動する worker どうしは別々の一時ディレクトリに settings.json を書く。既存の「同時実行: 新しいセッション2つが並んで起動しても、…」が合格のままである

## 反例の Red の確かめ方

Green の後、次の書き換えを1つずつ入れて表のテストが AssertionError で落ちることを確かめ、元に戻す（設計時は未実行。5 の Red で両経路の結合テストが落ちることは確認済み）。

| 書き換え | 落ちるテスト |
| --- | --- |
| `TuiWorker.create` の行だけを変更前の `JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(input.extraBody) } })` に戻す | 「起動時の settings には thinking のオン・オフによらず showThinkingSummaries: true を書き、…」 |
| `ClaudeProcess.create` の行だけを変更前の形に戻す | 「runs a request through a stream-json Claude executable」 |
| `claudeSettingsJson` の `CLAUDE_CODE_EXTRA_BODY: JSON.stringify(extraBody)` を `CLAUDE_CODE_EXTRA_BODY: extraBody` にする（二重の JSON 化をやめる） | 「claudeSettingsJson は showThinkingSummaries: true を書き、…」と TUI・-p の結合テスト |
| `claudeSettingsJson` のキーの順を `{ showThinkingSummaries: true, env: ... }` にする | 「claudeSettingsJson は showThinkingSummaries: true を書き、…」（文字列一致のため） |

## 実機（`scripts/verify-thinking-summaries.mts`、合計8回以内）

- [ ] 変更前3回の記録がすべて `ok` である。参考として、thinking ブロックの本文の長さが 0・署名ありであること（不具合の再現）を INFO で見る
- [ ] (1) 変更後のすべての記録で anthropic-beta に `redact-thinking-2026-02-12` が無い
- [ ] (2) 変更後に thinking ブロックが1件以上あり、すべての本文の長さが 1 以上である
- [ ] (3) 同じ番号の記録どうしで本文の `thinking`・`output_config`・`context_management`・`max_tokens`・`model` が一致する
- [ ] (4) 同じ番号の記録どうしで変更後の `cache_read_input_tokens` が変更前以上である
- [ ] `compare` が `summary: N passed, 0 failed` と `hypothesis: confirmed` を出す。rejected なら本体を戻して `implementation-notes.md` に記録し、止める

## 全体確認

- [ ] `npm test` が 214件すべて合格する
- [ ] `npm run check` が合格する
- [ ] `git diff --stat` が design.md「範囲」の表のファイルだけを含む
- [ ] `implementation-notes.md` に実機の記録（jsonl の各行）と `compare` の出力全文、実要求の回数を書く
