# テストリスト

対象: `src/model-catalog.ts`（`tests/model-catalog.test.ts`）、`src/tool-config.ts`（`tests/transcript.test.ts`。`buildExtraBody` は `src/transcript.ts` から再 export されている）。各項目の括弧内はお手本 `examples/tests-changes.diff` のテスト名である。

## 進め方

1. 変更前に `npm test` を実行し、171件すべて合格することを確かめる。
2. `git apply docs/devflow/20261107-1406/examples/tests-changes.diff` でテストを当てる。
3. 本体に次の仮実装だけを入れる。import 解決の失敗（SyntaxError）ではなく AssertionError で落ちる Red を確かめるためである。`src/tool-config.ts` はまだ変えない。
   ```ts
   // src/model-catalog.ts の ClaudeCodeModel の直後
   export type ThinkingOffShape = "disabled" | "between_tools";
   // src/model-catalog.ts の supportsAdaptiveThinking の直後
   export function thinkingOffShape(_model: string): ThinkingOffShape {
     return "disabled";
   }
   ```
4. `node --experimental-transform-types --test tests/model-catalog.test.ts tests/transcript.test.ts` を実行し、次の4件だけが AssertionError で落ちることを確かめる（設計時に確認済み。17件中13件は合格する）。
   - `thinkingOffShape returns between_tools only for claude-sonnet-5-5`（actual `'disabled'`、expected `'between_tools'`）
   - `thinkingOffShape follows the model that discovery resolves`（同上）
   - `buildExtraBody turns thinking off with between_tools on claude-sonnet-5-5`
   - `buildExtraBody returns an independent thinking-off object on every call`
5. 仮実装を消し、`examples/src-changes.diff` の内容を次の順で入れて Green にする。順序は `thinkingOffShapeOf` と `BETWEEN_TOOLS_THINKING_OFF_IDS` → `thinkingOffShape`（ここで model-catalog の1件目が通る）→ `THINKING_OFF_SHAPE_BY_ID` と `modelFromDiscovery` の1行（2件目が通る）→ `buildExtraBody`（transcript の2件が通る）。
6. 「反例の Red の確かめ方」の書き換えを1つずつ試し、表のテストが落ちることを確かめてから元に戻す。
7. 全体確認を実行する。

## 形の判定（`thinkingOffShape`）

- [ ] `claude-sonnet-5-5` と `claude-sonnet-5-5[1m]` は `"between_tools"` を返す（thinkingOffShape returns between_tools only for claude-sonnet-5-5）
- [ ] 境界値: `claude-sonnet-5`（前方一致で誤って含めやすい ID）は `"disabled"` を返す（同上）
- [ ] `claude-opus-5-5`、`claude-fable-5-1`、`claude-haiku-5-5`、`claude-haiku-4-5-20251001`、未知の `claude-future-1`、`default`（`FALLBACK_DISCOVERY` で `claude-opus-5-5[1m]` に解決）は `"disabled"` を返す（同上）
- [ ] 発見で `sonnet` が `claude-sonnet-5-5` に解決したとき、ID は `claude-sonnet-5-5` で形は `"between_tools"` になる（thinkingOffShape follows the model that discovery resolves）
- [ ] 状態遷移: `default` の解決先が `claude-sonnet-5-5[1m]` → `claude-opus-5-5[1m]` → 解決先なし と変わると、形は `"between_tools"` → `"disabled"` → `"disabled"` と最後に発見した結果に従う。前の発見の `"between_tools"` が残ることは無い（同上）
- [ ] 後片付け: 上記のテストは最後に `default` を `claude-opus-5-5[1m]` で発見し直し、後続のテストに書き換えた状態を残さない（同上。テストの末尾の1行）

## 本文の組み立て（`buildExtraBody`、reasoning なし）

- [ ] `claude-sonnet-5-5` では、`options` が `{}` でも省略でも、`{ tools: [], thinking: { type: "between_tools" }, context_management: { edits: [] } }` を返す。`claude-sonnet-5-5[1m]` も同じである（buildExtraBody turns thinking off with between_tools on claude-sonnet-5-5）
- [ ] `claude-haiku-5-5`、`claude-sonnet-5`、`claude-haiku-4-5-20251001`、`claude-opus-5-5`、`claude-fable-5-1`、`claude-future-1` は変更前と同じ `{ tools: [], thinking: { type: "disabled" }, context_management: { edits: [] } }` を返す（buildExtraBody keeps thinking disabled on models outside the between_tools list）
- [ ] 既存のテストは書き換えずに合格する: `claude-haiku-4-5-20251001` と `claude-opus-5-5` の reasoning なしは `disabled` で `display` を持たない（既存: buildExtraBody keeps thinking disabled without display when reasoning is absent、normalizes tool schemas and builds native generation fields）
- [ ] 同時実行: 同じモデルで2回呼んだ戻り値の `thinking` と `context_management` は別のオブジェクトであり、片方の `thinking.type` を書き換えてももう片方は `"between_tools"` のままである（buildExtraBody returns an independent thinking-off object on every call）

## 本文の組み立て（`buildExtraBody`、reasoning あり）

- [ ] `claude-sonnet-5-5` で `reasoning: "minimal"`・`maxTokens: 256` のとき、`{ tools: [], max_tokens: 256, thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "low" } }` を返し、`between_tools` にならない（buildExtraBody keeps adaptive thinking on claude-sonnet-5-5 when reasoning is set）
- [ ] `claude-sonnet-5-5` で `low`・`medium`・`high`・`xhigh` のとき、`thinking` は `adaptive`・`summarized`、`output_config.effort` は渡した値で、`context_management` を持たない（同上）
- [ ] 他のモデルの reasoning ありの既存テストは書き換えずに合格する（既存: buildExtraBody summarizes adaptive thinking for every reasoning level and route、buildExtraBody omits thinking for models without adaptive thinking when reasoning is set、buildExtraBody keeps max_tokens alongside summarized thinking）

## 入力を壊さないこと

- [ ] 既存のテストは書き換えずに合格する: `buildExtraBody` は渡した `nativeTools` と `options` を書き換えず、呼ぶたびに独立した本文を返す（既存: buildExtraBody leaves inputs untouched and returns independent bodies）。API が 400 を返しても、送る前の本文と呼び出し元の値は変わらない（`buildExtraBody` は送信より前に1回だけ呼ばれ、応答で本文を書き換える経路が無いため、追加のテストは要らない）

## 対象外の観点

- 権限: `thinkingOffShape` と `buildExtraBody` は利用者や権限を受け取らない純粋な判定であり、権限による分岐が無いためテストしない。
- 実機の 400: 単体テストでは API を呼ばない。受け入れ条件3（design.md）の `probe-thinking-off.mts claude-sonnet-5-5 current` を実装後に1回だけ実行して確かめる。400 が解消しなければ、出力の1行を `docs/devflow/20261107-1406/implementation-notes.md` に書く。

## 反例の Red の確かめ方

Green にしたあと、本体を次のように1か所ずつ書き換え、右のテストが AssertionError で落ちることを確かめてから元に戻す（5つとも設計時に一時コピーで確認済み。右に無いテストが一緒に落ちることもある）。

| 書き換え | 落ちるテスト |
| --- | --- |
| `thinkingOffShapeOf` を `resolvedId.startsWith("claude-sonnet-5")` で判定する | thinkingOffShape returns between_tools only for claude-sonnet-5-5（`claude-sonnet-5` で落ちる） |
| `modelFromDiscovery` の `THINKING_OFF_SHAPE_BY_ID.set(...)` の行を消す | thinkingOffShape follows the model that discovery resolves（`default` で落ちる） |
| `buildExtraBody` の `else` 分岐を `{ type: "disabled" }` に戻す | buildExtraBody turns thinking off with between_tools on claude-sonnet-5-5 |
| `buildExtraBody` で `thinkingOffShape` の値を reasoning の有無より前に `body.thinking` へ入れ、reasoning ありで上書きしない形にする（例: `if` の前に `body.thinking = { type: thinkingOffShape(modelId) }`、`if` の中の `supportsAdaptiveThinking` が偽のとき残る） | buildExtraBody omits thinking for models without adaptive thinking when reasoning is set |
| `else` 分岐で、モジュール内に置いた定数オブジェクト `{ type: ... }` を使い回す | buildExtraBody returns an independent thinking-off object on every call |

## 全体確認

- [ ] `npm test` が177件すべて合格する（変更前171件 + 追加6件）
- [ ] `npm run check`（`tsc --noEmit`）が合格する
- [ ] `git diff --stat` の対象が `src/model-catalog.ts`・`src/tool-config.ts`・`tests/model-catalog.test.ts`・`tests/transcript.test.ts` の4ファイルだけである
- [ ] 受け入れ条件3の実機確認を1回実行し、`"isError":false`・`"text":"OK"`・`sent.thinking` が `{"type":"between_tools"}` であることを確かめる
