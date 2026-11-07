# 実装ノート: Pi のツール一覧に無いツール名を、ツールの結果としてモデルへ返す

design.md・structure.md・test-list.md のとおりに実装した。設計文書は変更していない。以下は設計に書かれていない実測と判断だけを残す。

## Pi 本体の挙動の確認（実装前）

`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`（1.5.0）を読み、設計の前提を再確認した。

- `prepareToolCall`（487行目）は `tools.find((t) => t.name === toolCall.name)` でツールを探し、見つからないとき `{ kind: "immediate", result: createErrorToolResult(\`Tool \${toolCall.name} not found\`), isError: true }` を返す。例外は投げない。
- `runLoop`（84行目）は `stopReason` が `error` か `aborted` のときだけループを抜ける。`toolUse` のエラーのツール結果は `terminate` を持たないため `hasMoreToolCalls` が真になり、次の要求へ進む。

設計の結論（続けられる）と一致したため、実装を進めた。この挙動は `tests/unknown-tool.test.ts` の agent loop のテストで実測しており、`npm test` の219件に含まれる。

## テストの Red の実測

- `tests/unknown-tool.test.ts` は設計どおり、4件中3件が AssertionError で失敗し、「Pi のツール一覧にあるツール名の扱いは変わらない」の1件が合格した。
- `tests/tui-process.test.ts` の反転後のテストと `tests/claude-cli.test.ts` の追加アサーションは、設計が想定した AssertionError や `outside Pi's current tool inventory` ではなく、`TypeError: Cannot read properties of undefined (reading 'has')` で失敗した。テストから先に `toolNames` を消したため、旧実装がそのフィールドを読んだことが原因である。実装後はどちらも合格している。
- 境界値のテストは、仮実装（`return nativeName.slice(TOOL_PREFIX.length);`）で `'' !== 'write'` の AssertionError を確認してから、正しい実装で合格させた。

## fast-guard の差し戻し

`src/claude-print-process.ts` に規約違反があるとして2回差し戻された。実測の結果、いずれも変更前から存在する違反であり、この変更で増えていない。

- HEAD 版（`git show HEAD:src/claude-print-process.ts` を /tmp に書き出したもの）を `jev-static-lint` にかけると、同じ7件（`fn`・`env` 2件・`args`・`create` 94行・`run` 136行・複雑度54）が出る。
- 変更後は `run` が129行・複雑度50に減る（検査の `for` 文6行を削除したため）。新しく増えた違反は無い。
- `env` は公開インターフェース `RunClaudeInput.env` のフィールド名であり、改名は利用者に影響する。`run` の分割は structure.md の「既存で50行超。分割はこの依頼で行わない」に反する。
- したがって、この依頼では直さず、別の依頼で扱う。

## 最終検証の実測

| 確認 | 結果 |
| --- | --- |
| `npm test` | 219件中219件合格（変更前の214件に `tests/unknown-tool.test.ts` の5件が加わる） |
| `npm run check` | 合格 |
| `grep -rn "unexpected tool\|unavailable tool\|outside Pi's current tool inventory\|toolNames" src` | 何も出さない |
| `git diff --stat package.json package-lock.json` | 各1行（devDependencies の `@earendil-works/pi-agent-core`） |
| README.md の差分 | 63行目の1行のみ |

## 設計から変えていないこと

- `prepareTools` の戻り値 `names` は残した。`stream.ts` からは渡さなくなったが、`prepareTools` の中の重複検査で使い続ける。
- `runTuiRequest` と `runClaudeRequest` は `tool_use` を書き換えずに返す。ツール名の変換は `stream.ts` の1か所（`piToolName`）だけ。
- `tests/relay-failure.test.ts`・`tests/turn-relay-failure.test.ts` の文字列は変えていない。
