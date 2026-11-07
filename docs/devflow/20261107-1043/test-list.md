# テストリスト

対象: `buildExtraBody`（`tests/transcript.test.ts`）。上から順に1件ずつ Red → Green で進める。最初の1件は既存テストの期待値更新で Red（AssertionError）を確認する。

## 正常系

- [ ] reasoning `"minimal"` と `claude-sonnet-5` で、`thinking` が `{ type: "adaptive", display: "summarized" }`、`output_config` が `{ effort: "low" }` になる（既存テストの期待値を更新）
- [ ] reasoning `"high"` と `claude-opus-5-5` で、`thinking` が `{ type: "adaptive", display: "summarized" }`、`output_config` が `{ effort: "high" }` になる
- [ ] reasoning `"low"`・`"medium"`・`"xhigh"` のそれぞれで `display: "summarized"` が付き、`effort` は指定値のままである
- [ ] reasoning 無し（`{}`）と `claude-haiku-4-5-20251001` で、戻り値が `{ tools: [], thinking: { type: "disabled" }, context_management: { edits: [] } }` と完全一致する（既存テストを維持）
- [ ] reasoning 無しと adaptive 対応モデル（`claude-opus-5-5`）でも、`thinking` が `{ type: "disabled" }` で `display` を含まない

## 境界値

- [ ] `options` が `undefined` のとき、`thinking: { type: "disabled" }` と `context_management: { edits: [] }` を返し、`display` を含まない
- [ ] reasoning ありで adaptive 非対応モデル（`claude-haiku-4-5-20251001`）のとき、`thinking` キーが存在せず（`"thinking" in body` が false）、`output_config` は付く
- [ ] reasoning ありで未知モデル（`claude-future-1`）のとき、adaptive 扱いとなり `display: "summarized"` が付く
- [ ] reasoning ありで `[1m]` 付き ID（`claude-opus-5-5[1m]`）のとき、`display: "summarized"` が付く
- [ ] reasoning と `maxTokens: 1024` を同時に指定したとき、`max_tokens: 1024` と `display: "summarized"` の両方を含む

## 不変・独立性（同時実行の代替）

- [ ] 呼び出し後も引数の `nativeTools` 配列と `options` オブジェクトが変更されていない（呼び出し前に `structuredClone` した値と `deepEqual`）
- [ ] 2回呼び出した結果の `thinking` が別オブジェクトであり、1回目の結果の `thinking.display` を書き換えても2回目の結果は `"summarized"` のままである

## 該当なしの観点

- 権限: `buildExtraBody` は認可を扱わないため対象外。
- 状態遷移の禁止: 状態を持たない純粋関数のため対象外。
- 4xx でデータが変わらないこと: 関数は通信しないため対象外。API の 4xx は Claude Code 側の既存経路で扱う。
- 同時実行: 共有する可変状態がないため、上の「不変・独立性」のテストで代える。

## 全体確認

- [ ] `npm test` が全件合格する
- [ ] `npm run check` が合格する
