# 実装メモ: thinking オフの形をモデルごとに持たせる

## 結果

- 確定差分はお手本（`examples/src-changes.diff`・`examples/tests-changes.diff`）と同一である。`index` 行を除いた `git diff` が両方とも一致した。
- `npm test` は177件すべて合格し、`npm run check`（`tsc --noEmit`）も合格した。
- 変更したファイルは `src/model-catalog.ts`・`src/tool-config.ts`・`tests/model-catalog.test.ts`・`tests/transcript.test.ts` の4つだけである。

## 実機の確認（受け入れ条件3、1回だけ実行）

```sh
node --experimental-transform-types docs/devflow/20261107-1406/examples/probe-thinking-off.mts claude-sonnet-5-5 current
```

出力は次の1行である。400 は解消した。

```json
{"modelId":"claude-sonnet-5-5","mode":"current","sent":{"thinking":{"type":"between_tools"},"context_management":{"edits":[]}},"exitCode":0,"isError":false,"text":"OK","contentTypes":["text"]}
```

## 設計との違い

テストの当て方だけが test-list.md の手順2と異なる。ハーネスの TDD ゲートはシェルからの `git apply` をテストの追加として認識せず、本体の書き換えを止める。そのため `git checkout` でテストを戻したあと、`edit` でお手本と同じ内容を入れた。入れた差分は `index` 行を除いて `examples/tests-changes.diff` と一致することを `diff` で確認した。それ以外の手順は test-list.md のとおりである。

## 反例の Red の確認

test-list.md の表の5つを1つずつ試し、すべてで対象のテストが AssertionError で落ちることを確かめてから元に戻した。手順1〜5の順に、落ちたテストは次のとおり。

1. `startsWith("claude-sonnet-5")` に変える: thinkingOffShape returns between_tools only for claude-sonnet-5-5（ほかに disabled のモデルのテスト）
2. `THINKING_OFF_SHAPE_BY_ID.set(...)` を消す: thinkingOffShape follows the model that discovery resolves
3. `else` を `{ type: "disabled" }` に戻す: buildExtraBody turns thinking off with between_tools on claude-sonnet-5-5
4. `thinking` を `if` の前に置く: buildExtraBody omits thinking for models without adaptive thinking when reasoning is set
5. 定数オブジェクトを使い回す: buildExtraBody returns an independent thinking-off object on every call

## 未対応の参考指摘（reviewer の【APPROVE】時に残った【参考】）

- `FALLBACK_DISCOVERY` と `ALIASES` の `sonnet` は今も `claude-sonnet-5` に解決するが、実機のカタログは `claude-sonnet-5-5` を返す。発見に失敗したときだけ使う代替値が実機と食い違っている（今回の依頼の範囲外）。
- `claude-sonnet-5-5-YYYYMMDD` のような日付付き ID は完全一致のため `disabled` になる（design.md の未決事項3どおり）。
- `between_tools` でツールを使う会話の thinking ブロックの見え方は実機で確かめていない（design.md の未決事項2）。PR 本文に残す。
