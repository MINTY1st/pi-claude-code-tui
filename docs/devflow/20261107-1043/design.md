# 思考表示が空になる不具合の修正 設計

## 結論

`src/tool-config.ts` の `buildExtraBody` が adaptive thinking を送るとき、`thinking` を `{ type: "adaptive" }` から `{ type: "adaptive", display: "summarized" }` に変える。変更は本番コード1行と、既存テスト1か所の期待値更新、テストの追加に限る。

## 目的

pi-claude-code-tui 経由で接続すると、Pi の画面で思考ブロック（電球マーク）は表示されるが中身が空になる。Opus 4.7 以降の Anthropic API は `thinking.display` を省略すると `"omitted"` として扱い、思考の本文を返さないためである。本拡張は `buildExtraBody` の結果を `CLAUDE_CODE_EXTRA_BODY` として Claude Code に渡し、Claude Code はそれをリクエスト本文に混ぜる。`display` を明示すれば、API は要約済みの思考本文を返し、Pi 側の既存の変換（`src/stream.ts` の `thinking` ブロック処理）がそのまま本文を表示する。

Pi 本体の Anthropic 接続（`@earendil-works/pi-ai` の `dist/api/anthropic-messages.js`）は、adaptive thinking で `display: options.thinkingDisplay ?? "summarized"` を送っている。本修正はこの既定値に合わせる。

## 範囲

対象:

- `src/tool-config.ts` の `buildExtraBody`
- `tests/transcript.test.ts` の `buildExtraBody` に関するテスト

対象外（変更しない）:

- `supportsAdaptiveThinking`（`src/model-catalog.ts`）の判定
- adaptive thinking 非対応モデル（例: `claude-haiku-4-5-20251001`）で reasoning を指定したときの挙動。現状どおり `thinking` キーを付けない
- `output_config.effort` の変換（`"minimal"` を `"low"` に読み替える処理）
- reasoning 無しのときの `thinking: { type: "disabled" }` と `context_management: { edits: [] }`
- `display` を利用者が設定で切り替える仕組み。`SimpleStreamOptions` に `thinkingDisplay` は存在しないため、値は `"summarized"` に固定する
- `src/stream.ts`、`src/claude-cli.ts`、`src/tui-process.ts`（`extraBody` を渡す経路）

## 変更前と変更後

| 条件 | 変更前の `body.thinking` | 変更後の `body.thinking` |
| --- | --- | --- |
| `options.reasoning` あり、adaptive 対応モデル（未知モデルを含む） | `{ type: "adaptive" }` | `{ type: "adaptive", display: "summarized" }` |
| `options.reasoning` あり、adaptive 非対応モデル | キーなし | キーなし（変更なし） |
| `options.reasoning` なし（`options` 自体が `undefined` を含む） | `{ type: "disabled" }` | `{ type: "disabled" }`（変更なし。`display` を付けない） |

`tools`、`max_tokens`、`output_config`、`context_management` の各キーは変更前と同じ値を返す。

## API（関数の契約）

シグネチャは変えない。

```ts
export function buildExtraBody(
  modelId: string,
  nativeTools: Array<Record<string, unknown>>,
  options?: SimpleStreamOptions,
): Record<string, unknown>;
```

- 純粋関数である。引数を変更せず、呼び出しごとに新しいオブジェクトを返す。
- `display` の値は文字列リテラル `"summarized"`。定数化はしない（使う場所が1か所のため）。
- `type: "disabled"` には `display` を付けない。API は `disabled` に `display` を受け付けない前提で、Pi 本体も付けていない。

## 画面

画面のコードは変えない。修正後は、adaptive 対応モデルで思考レベルを off 以外にしたとき、電球マークの思考ブロックに要約された本文が表示される。

## 業務ルール・設定

追加しない。環境変数・設定ファイルの追加もない。

## エラー

新しいエラーは追加しない。`buildExtraBody` は例外を投げない。API が `display` を拒否した場合の 4xx は Claude Code 側で発生し、既存のエラー経路でそのまま Pi に返る（本修正で扱いを変えない）。

## ドキュメント

`docs/` の公開文書は追加しない。README にも thinking の記述がないため変更しない。リポジトリに `docs/sync_backlog_wiki.js` は存在しないので、同期は実行しない。

## 受け入れ条件

1. `buildExtraBody("claude-sonnet-5", tools, { reasoning: "minimal" })` が `thinking: { type: "adaptive", display: "summarized" }` と `output_config: { effort: "low" }` を含む。
2. `buildExtraBody("claude-haiku-4-5-20251001", [], {})` が変更前と同じく `{ tools: [], thinking: { type: "disabled" }, context_management: { edits: [] } }` と完全一致する（`display` を含まない）。
3. `test-list.md` の全項目に対応するテストが `npm test` で合格する。
4. `npm run check`（`tsc --noEmit`）が合格する。
5. 差分は `src/tool-config.ts` と `tests/transcript.test.ts` だけである（`docs/devflow/` を除く）。

## 未決事項

- adaptive 非対応モデルで reasoning を指定した場合に、budget 方式（`{ type: "enabled", budget_tokens, display }`）を送るかどうか。Pi 本体は送っているが、本依頼の範囲外のため今回は変更しない。
- 実機での表示確認（Claude Code 経由で思考本文が実際に返ること）は自動テストでは確かめられない。PR 作成後に渡部さんが手元で確認する。
