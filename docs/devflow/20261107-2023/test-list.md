# テストリスト: Pi のツール一覧に無いツール名を、ツールの結果としてモデルへ返す

各項目の後ろの括弧に、確かめるテストの置き場所を書く。`unknown-tool` は `tests/unknown-tool.test.ts`（`examples/unknown-tool.test.ts` のコピー）を指す。

## ツール名の変換（`piToolName`、境界値）

- [ ] `mcp__pi__read` は `read` になる（unknown-tool「境界値: piToolName ...」）
- [ ] 接頭辞の無い `write` は `write` のまま（同上）
- [ ] 大文字小文字を変えない: `Write` は `Write` のまま（同上）
- [ ] 別の接頭辞 `mcp__other__x` は外さない（同上）
- [ ] 途中に `mcp__pi__` を含む `x_mcp__pi__read` は外さない（先頭一致だけを見る。同上）
- [ ] `mcp__pi__mcp__pi__x` は1回だけ外して `mcp__pi__x` になる（同上）
- [ ] ちょうど `mcp__pi__` は空文字になり、例外にしない（同上）
- [ ] 空文字は空文字のまま（同上）

## `streamClaudeCode`（対話 TUI 経路。2026-11-07 の実測と同じ経路）

- [ ] 接頭辞の無い `write` の `tool_use` で、`stopReason: "toolUse"`・`errorMessage: undefined`・`toolCall.name: "write"` になる（unknown-tool）
- [ ] 一覧に無い `mcp__pi__unknown` の `tool_use` で、`stopReason: "toolUse"`・`toolCall.name: "unknown"` になる（unknown-tool）
- [ ] 反例: 一覧にある `mcp__pi__read` の `toolCall` は、`id`・`name`・`arguments` が変更前と同じ（`toolu_read`・`read`・`{ path: "a.md" }`。unknown-tool）
- [ ] ストリームの途中（`startBlock`）と最終メッセージ（`nativeContent`）で同じ名前になり、「final response differs from its incremental stream」にならない（上の2件が `stopReason: "toolUse"` で終わることで確かめる）

## Pi の agent loop を通した振る舞い

- [ ] `agentLoop` に `streamClaudeCode` を渡し、一覧に `read` だけを置いた状態で `write` を呼ばれると、`toolName: "write"`・`isError: true`・`content: [{ type: "text", text: "Tool write not found" }]` のツール結果ができる（unknown-tool）
- [ ] 状態遷移: エラーのツール結果の後も agent loop は止まらず、上流へ2回目の要求を送る（`bodies.length === 2`。unknown-tool）
- [ ] 2回目の要求の本文に、`tool_use_id: "toolu_write"`・`is_error: true`・`Tool write not found` を含む `tool_result` が入る（モデルにエラーのツール結果が渡る。unknown-tool）
- [ ] 最後の応答は `stopReason: "stop"` で終わる（ターン全体が失敗にならない。unknown-tool）

## Claude Code の実行の層

- [ ] 対話 TUI 経路の `runTuiRequest` は、`mcp__pi__unknown` と `write` の `tool_use` を書き換えずに `message.content` に入れ、`stop_reason: "tool_use"` で返す（`tests/tui-process.test.ts` の反転後のテスト）
- [ ] 反例: 一覧にある `mcp__pi__read` の `tool_use` は、これまでどおり返り、Claude Code の回復要求2本を拒否する（`tests/tui-process.test.ts`「tool_use を Pi へ返し、...」。`toolNames` の指定を消した後も合格する）
- [ ] -p 経路の `runClaudeRequest` は、Pi のツール一覧（`manifest`）が空でも `mcp__pi__echo` の `tool_use` を例外にせず `stop_reason: "tool_use"` で返す（`tests/claude-cli.test.ts` の追加アサーション）
- [ ] 反例: -p 経路で一覧にある `echo` の往復（`toolCall` → `afterTool`）とプロセス数の記録は変わらない（`tests/claude-cli.test.ts` の既存アサーション）

## 残す検査（変わらないこと）

- [ ] トークン使用量の欠落、使用量クレジットの拒否、途中で切れた SSE・HTTP 400 は、これまでどおりエラーにする（`tests/tui-process.test.ts`・`tests/billing.test.ts` の既存テストが合格する）
- [ ] `prepareTools` のツール名の形式と重複の検査は変わらない（既存テストが合格する）
- [ ] 中断（`signal` とセッションの片付け）は `aborted` のまま記録する（`tests/stream-abort.test.ts` が合格する）

## 全体と機械的な確認

- [ ] `npm run check` が合格する
- [ ] `npm test` が全件合格する（設計時の実測は219件）
- [ ] `grep -rn "unexpected tool\|unavailable tool\|outside Pi's current tool inventory\|toolNames" src` が何も出さない
- [ ] `package.json` と `package-lock.json` の差分は devDependencies の `@earendil-works/pi-agent-core` の1行ずつだけ
- [ ] `README.md` の差分は63行目だけ

## 該当しない観点

- 権限: このパッケージはツールの実行可否を判定しない。一覧に同じ名前のツールがあれば Pi が実行する（design.md「業務ルール」）。Pi の `beforeToolCall` などの承認の仕組みは変えない。
- 4xx でデータが変わらないこと: HTTP の API を持たない。上流の 4xx の扱いは「残す検査」で確かめる。
- 同時実行: 足す関数は純粋関数で、共有する状態を増やさない。同じセッションへの並行要求の扱いは既存の `tests/tui-process.test.ts`「同じセッションへの並行要求でも ...」で確かめる。
