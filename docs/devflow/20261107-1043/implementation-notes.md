# 実装ノート

## 結論

設計どおり `src/tool-config.ts` の `buildExtraBody` で adaptive thinking に `display: "summarized"` を付与した。本番コードの変更はコメント1行とコード1行で、テストは `tests/transcript.test.ts` のみを変更した。

## test-list との対応

| test-list の項目 | テスト |
| --- | --- |
| 正常系1: reasoning `"minimal"` と `claude-sonnet-5` | 既存テスト `normalizes tool schemas and builds native generation fields` の期待値を更新 |
| 正常系2: reasoning `"high"` と `claude-opus-5-5` | `buildExtraBody summarizes adaptive thinking for every reasoning level and route` |
| 正常系3: reasoning `"low"`・`"medium"`・`"xhigh"` | 同上 |
| 正常系4: reasoning 無しと `claude-haiku-4-5-20251001` | 既存テスト（変更なし） |
| 正常系5: reasoning 無しと `claude-opus-5-5` | `buildExtraBody keeps thinking disabled without display when reasoning is absent` |
| 境界値1: `options` が `undefined` | 同上 |
| 境界値2: reasoning ありで adaptive 非対応モデル | `buildExtraBody omits thinking for models without adaptive thinking when reasoning is set` |
| 境界値3: reasoning ありで未知モデル `claude-future-1` | `buildExtraBody summarizes adaptive thinking for every reasoning level and route` |
| 境界値4: reasoning ありで `claude-opus-5-5[1m]` | 同上 |
| 境界値5: reasoning と `maxTokens: 1024` | `buildExtraBody keeps max_tokens alongside summarized thinking` |
| 不変1: 引数を変更しない | `buildExtraBody leaves inputs untouched and returns independent bodies` |
| 不変2: 2回呼び出しの独立性 | 同上 |

## 検証結果

- `npm test`: 125件すべて合格。
- `npm run check`: 合格。

## 補足

- 初回の `npm test` で `tests/tui-process.test.ts` の「上流が少しずつ返し続ける長いターンは、ターン全体が timeoutMs を超えても時間切れにしない」が1件失敗した。このテストは実時間の経過に依存する既存テストで、再実行では合格した。本修正は `buildExtraBody` の戻り値だけを変え、同テストが通る `tui-process.ts` の経路には影響しない。
- 「不変・独立性」は、共有する可変状態がないことの確認として、`structuredClone` した引数との `deepEqual` と、2回の呼び出しで `thinking` が別オブジェクトになることの2点で実装した。
- 設計の「未決事項」にある adaptive 非対応モデルへの budget 方式送信と実機での表示確認は、今回の範囲外として変更していない。

## 未対応の参考指摘

- reviewer: `buildExtraBody omits thinking for models without adaptive thinking when reasoning is set` は `output_config` のみの部分一致で、`context_management` の誤混入を検出できない。戻り値全体の `deepEqual` にするとより堅い（設計の変更範囲外のため今回は未対応）。
