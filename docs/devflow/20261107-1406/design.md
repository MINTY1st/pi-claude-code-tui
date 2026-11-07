# 設計: thinking オフの要求が claude-sonnet-5-5 で 400 になる不具合を直す

## 結論

`buildExtraBody` は reasoning が無いとき、モデルによらず `thinking: {"type":"disabled"}` を送っている。claude-sonnet-5-5 はこれを 400 で拒否し、`{"type":"between_tools"}` を求める。`src/model-catalog.ts` にモデルごとの「thinking オフの形」（`"disabled"` か `"between_tools"`）を持たせ、`buildExtraBody` はその値を `thinking.type` に入れる。`between_tools` の形の ID は `claude-sonnet-5-5` の1件だけであり、それ以外のモデル（未知のモデルを含む）は今と同じ `disabled` を送る。`context_management` は2つの形とも今と同じ `{ edits: [] }` を送る。

確定差分は `examples/src-changes.diff`（本体）と `examples/tests-changes.diff`（テスト）である。一時コピーのリポジトリで両方を当て、`npm test` 177件合格・`npm run check` 合格を確認済みである。実装担当はこの差分をテストリストの順に入れる。

## 目的

Pi で claude-sonnet-5-5 を選び、thinking レベルを off にしたときの要求を 400 にせず通す。

## 範囲

| 対象 | 変更 |
| --- | --- |
| `src/model-catalog.ts` | 型 `ThinkingOffShape`、表 `THINKING_OFF_SHAPE_BY_ID`、実測した ID の集合 `BETWEEN_TOOLS_THINKING_OFF_IDS`、内部関数 `thinkingOffShapeOf`、公開関数 `thinkingOffShape` を足す。`modelFromDiscovery` で表に記録する |
| `src/tool-config.ts` | `buildExtraBody` の reasoning なしの分岐で `thinkingOffShape(modelId)` を使う |
| `tests/model-catalog.test.ts` | `thinkingOffShape` のテスト2件を足す |
| `tests/transcript.test.ts` | `buildExtraBody` のテスト4件を足す |

範囲外: reasoning があるときの本文、`context_management` の中身、モデル発見（`discoverClaudeModels`）、`stream.ts` の応答の扱い、README。opus-5-5 と fable-5-1 の thinking オフ（「未決事項」1）。

## 実機の確認結果（2026-11-07）

`examples/probe-thinking-off.mts` で、Claude Code（`claude -p`、`CLAUDE_CODE_EXTRA_BODY` を settings で渡す。対話 TUI の経路 `src/tui-process.ts` と同じ渡し方）から「Reply with exactly: OK」を1回ずつ送った。本文は `{ tools: [], thinking: { type: <形> }, context_management: { edits: [] } }` である。生の結果は `examples/probe-results.jsonl` にある。

カタログは `discoverClaudeModels()` の実機の応答による。選べるモデルは default（`claude-opus-5-5` に解決）、`claude-opus-5-5`、`claude-fable-5-1`、`claude-sonnet-5-5`、`claude-haiku-5-5` の5行である。全行の `supportsThinkingOff` は `false` であり、この値からは形の違いを判定できない。

| モデル | `disabled` | `between_tools`（`edits: []` 付き） | 決める形 |
| --- | --- | --- | --- |
| `claude-sonnet-5-5` | 400「To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}. …」 | 成功（`OK`、応答は text ブロックのみ） | `between_tools` |
| `claude-haiku-5-5` | 成功（`OK`） | 未送信（1モデル1〜2回の上限のため、通った形で止めた） | `disabled` |
| `claude-opus-5-5` | 400「"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.」 | 400「"thinking.type.between_tools" is not supported for this model.」 | `disabled`（現状維持。未決事項1） |
| `claude-fable-5-1` | opus-5-5 と同じ 400 | opus-5-5 と同じ 400 | `disabled`（現状維持。未決事項1） |

カタログの代替値（`FALLBACK_DISCOVERY`）にだけ載る `claude-sonnet-5` と `claude-haiku-4-5-20251001` は、今のアカウントのカタログに無いため実機では送っていない。どちらも `disabled` のままとする。

`context_management` は、`between_tools` でも `{ edits: [] }` が受け付けられた。Claude Code は既定で clear-thinking の edits を本文に入れ、thinking オフではこの edits が無効として拒否されるため、空の配列で上書きする今の処理を `between_tools` でも残す。

## 変更前と変更後

reasoning が無い（`options` が無い、または `options.reasoning` が偽）ときの `buildExtraBody(modelId, tools, options)` の戻り値:

| modelId | 変更前 | 変更後 |
| --- | --- | --- |
| `claude-sonnet-5-5`、`claude-sonnet-5-5[1m]` | `thinking: { type: "disabled" }`、`context_management: { edits: [] }` | `thinking: { type: "between_tools" }`、`context_management: { edits: [] }` |
| `default`（発見で `claude-sonnet-5-5` または `claude-sonnet-5-5[1m]` に解決したとき） | 同上（`disabled`） | `between_tools` |
| 上記以外（`claude-haiku-5-5`、`claude-opus-5-5`、`claude-fable-5-1`、`claude-sonnet-5`、`claude-haiku-4-5-20251001`、未知の ID、他に解決した `default`） | `disabled` | `disabled`（変わらない） |

`tools` と `max_tokens` の扱いは変わらない。reasoning があるときの戻り値（`thinking: { type: "adaptive", display: "summarized" }` と `output_config.effort`、`context_management` なし）はどのモデルでも変わらない。

## 業務ルール

1. 形の判定は Pi のモデル ID から接尾辞 `[1m]` と別名（`ALIASES`）を外した正規の ID で行う。正規の ID が `BETWEEN_TOOLS_THINKING_OFF_IDS` に含まれれば `"between_tools"`、それ以外は `"disabled"` とする。前方一致や正規表現は使わず、完全一致で判定する（`claude-sonnet-5` を誤って含めないため）。
2. `default` は、`modelFromDiscovery` が受け取った `resolvedModel`（接尾辞 `[1m]` を外したもの）で判定する。`resolvedModel` が無ければ `"disabled"` とする。発見の結果は `modelFromDiscovery` を呼んだ時点の表に記録し、後から呼ばれた結果で上書きする（`ADAPTIVE_THINKING_BY_ID` と同じ扱い）。
3. 表に無い ID は、ルール1の判定をその場で行う。発見を一度も経ていない `claude-sonnet-5-5` でも `"between_tools"` になる。
4. `buildExtraBody` は呼ぶたびに新しい `thinking` と `context_management` のオブジェクトを作る。

## 設定

追加の設定値・環境変数は無い。`between_tools` の ID は実測した事実であり、利用者が変える値ではないため、`src/model-catalog.ts` の定数とする。

## エラー

新しいエラーは足さない。`thinkingOffShape` は例外を投げない。opus-5-5・fable-5-1 で reasoning なしの要求が 400 になる挙動は変更前と同じである（未決事項1）。

## 受け入れ条件

1. `npm test` が全件合格する（確定差分を当てた状態で177件）。`npm run check` が合格する。
2. test-list.md の項目がすべて満たされる。
3. 実機で次の1回を送り、`"isError":false` と `"text":"OK"` が出る。`current` は実装後の `buildExtraBody("claude-sonnet-5-5", [], {})` をそのまま送るモードである。
   ```sh
   node --experimental-transform-types docs/devflow/20261107-1406/examples/probe-thinking-off.mts claude-sonnet-5-5 current
   ```
   出力の `sent.thinking` が `{"type":"between_tools"}` であることも確かめる。400 が解消しなければ、出力の1行をそのまま `docs/devflow/20261107-1406/implementation-notes.md` に書く。審査（reviewer）はこれを【必須】で差し戻す。
4. 実機の確認は上記の1回だけとする（haiku-5-5 の `disabled` は本文が変更前と同じであり、設計時に成功を確認済みである）。

## 未決事項

1. **opus-5-5 と fable-5-1 の thinking オフ**: 両モデルとも `disabled` と `between_tools` の両方を 400 で拒否した。API のエラー文は「adaptive と output_config.effort で思考を制御せよ」と求めており、thinking を完全に切る形はこの2モデルに無い可能性がある（推測）。依頼の範囲は「disabled か between_tools」であり、第3の形（例: reasoning なしでも `adaptive` と `effort: "low"` を送る、または `thinking` を省く）は依頼に無い業務ルールになるため、本設計では入れない。今回は `disabled` を送り続け、400 になる挙動は変更前と同じとする。対応方針は渡部さんが別の依頼で決める。
2. **`between_tools` で返る thinking ブロック**: API のエラー文によれば、`between_tools` ではツール呼び出しの合間に書く短い更新が thinking ブロックで返る。設計時の確認はツールを使わない1往復であり、応答は text ブロックだけだった。`stream.ts` は thinking ブロックを Pi の thinking として既に中継するため、本設計では手を入れない。ツールを使う会話での見え方は実機で確かめていない。
3. **日付付きの ID**: `claude-sonnet-5-5-YYYYMMDD` のような ID が今後カタログに出た場合、完全一致のため `disabled` になる。今のカタログには無いため、本設計では扱わない。
4. **Backlog Wiki の同期**: このリポジトリには `docs/sync_backlog_wiki.js` が無い。同期は行わない。

## メタ情報

- 依頼の根拠: devflow 20261107-1309 の実機検証で確認した claude-sonnet-5-5 の 400（変更前のコードでも起きる）
- 設計時の実機要求: 7回（opus-5-5・fable-5-1・sonnet-5-5 が各2回、haiku-5-5 が1回）
