# 設計: Pi のツール一覧に無いツール名を、例外ではなくツールの結果としてモデルへ返す

## 結論

Claude Code の応答に含まれる `tool_use` を Pi の `toolCall` に変換するとき、ツール名の検査をやめる。接頭辞 `mcp__pi__` が付いていれば外し、付いていなければ名前をそのまま `toolCall.name` にする。Pi のツール一覧に無い名前でも例外にしない。

一覧に無い名前の扱いは Pi 本体（`@earendil-works/pi-agent-core` 1.5.0）の agent loop に任せる。agent loop はその `toolCall` に対して `Tool <name> not found` というエラーのツール結果（`isError: true`）を作り、ターンを止めずに次の要求へ進む。この挙動はコードと実測の両方で確かめた（「Pi 本体の挙動の確認」）。

例外を投げている箇所は依頼に書かれた `src/stream.ts` の2か所のほかに、`src/tui-process.ts` と `src/claude-print-process.ts` にも1か所ずつある。後の2か所は `src/stream.ts` より先に実行されるため、残すと対話 TUI 経路でも -p 経路でも要求が失敗したままになる。そのため4か所すべてから検査を外す。

設計時に一時の作業木（HEAD `5ffc96a`）で structure.md のとおりに変更し、次を実測した。

| 確認 | 結果 |
| --- | --- |
| 変更前に `examples/unknown-tool.test.ts` の振る舞いの4件を実行（Red） | 4件中3件が AssertionError で失敗（`'error' !== 'toolUse'` が2件、agent loop の toolResult が `undefined` が1件）。正しいツール名の1件は合格 |
| 変更前に -p 経路の追加アサーションを実行（Red） | `Error: Claude Code returned a tool outside Pi's current tool inventory` で失敗 |
| 変更後の `npm run check` | 合格 |
| 変更後の `npm test` | 219件中219件合格（変更前の214件に、新しいテストファイルの5件が加わる。`piToolName` の境界値の1件を含む） |
| agent loop を通した2回目の上流要求の本文 | `{"type":"tool_use","id":"toolu_write","name":"write",...}` と `{"type":"tool_result","tool_use_id":"toolu_write","content":"Tool write not found","is_error":true,...}` を含む |

## 目的

モデルが Pi のツール一覧に無いツールを呼んでも、ターン全体を失敗にしない。Pi の普段の動き（ほかのプロバイダを使うとき）と同じく、「そのツールは無い」というツールの結果をモデルに返し、モデルに正しいツールで呼び直させる。

2026-11-07 の実測では、devflow の設計役（`claude-opus-5-5`、対話 TUI 経路）がファイルを書こうとした直後に接頭辞の無い `write` を呼び、「Claude Code returned unexpected tool write」で要求が失敗した。devflow 20261107-1655 で2回、20261107-1953 で1回起きた。直前までのツール呼び出しは正しく `mcp__pi__codemode` だった。要求の失敗は devflow の工程そのものを止めるため、1回の呼び間違いで作業が中断する。

## 範囲

範囲に入るもの:

- `src/tool-config.ts`: ツール名の変換関数 `piToolName` を足す
- `src/transcript.ts`: `piToolName` を再 export に加える
- `src/stream.ts`: 146行目と244行目の検査を外し、`piToolName` で名前を変換する。`EventTranslator` と `nativeContent` から引数 `toolNames` を除く。`runRequest` に `toolNames` を渡すのをやめる
- `src/tui-process.ts`: `assertKnownTools` を消す
- `src/claude-print-process.ts`: 446〜451行目の検査を消す。`RunClaudeInput` からフィールド `toolNames` を消す
- `tests/`: 新しいテストファイル `tests/unknown-tool.test.ts` の追加、`tests/tui-process.test.ts` の1件の期待の反転、`tests/claude-cli.test.ts` へのアサーションの追加、`toolNames` を渡している6か所の削除
- `package.json`・`package-lock.json`: devDependencies に `@earendil-works/pi-agent-core` を足す（テストが `agentLoop` を import するため）
- `README.md` 63行目: 「再試行しないもの」の列挙から `tools outside Pi's inventory` を除き、一覧に無いツールの扱いを1文で足す

範囲に入らないもの（この依頼では行わない）:

- Claude Code 側の動き（`--tools ""`・`--allowedTools mcp__pi`・inert MCP・relay による後続要求の拒否）の変更
- 一覧に無い名前を、似た名前の正しいツールへ読み替えること（例: `write` を `codemode` の中の `write` に読み替える）
- `toolCall` の引数をツールの入力スキーマで検証すること（Pi の agent loop が `validateToolArguments` で行う）
- `prepareTools` の戻り値 `names` の削除（`prepareTools` の中でツール名の重複検査に使い続けるため、戻り値の形は変えない）
- `tests/relay-failure.test.ts`・`tests/turn-relay-failure.test.ts` に例として書かれた文字列（`Claude Code returned unavailable tool foo`・`... outside Pi's current tool inventory`）の変更。どちらも「任意の例外の文言」としての例であり、本体のコードの文言を参照していないため
- `docs/sync_backlog_wiki.js` の実行（このリポジトリには存在しない）

## 変更前と変更後

| 観点 | 変更前 | 変更後 |
| --- | --- | --- |
| 応答の `tool_use.name` が `mcp__pi__read` で、Pi の一覧に `read` がある | `toolCall.name = "read"` | 同じ |
| `tool_use.name` が `mcp__pi__unknown` で、Pi の一覧に `unknown` が無い | TUI 経路: `src/stream.ts` 244行目が「Claude Code returned unavailable tool unknown」を投げ、relay が CaptureError に包み、`stopReason: "error"`。-p 経路: `src/claude-print-process.ts` が「... outside Pi's current tool inventory」を投げ、`stopReason: "error"` | `toolCall.name = "unknown"`、`stopReason: "toolUse"` |
| `tool_use.name` が `write`（接頭辞なし） | TUI 経路: 「Claude Code returned unexpected tool write」で `stopReason: "error"`（2026-11-07 の実測）。-p 経路: 「... outside Pi's current tool inventory」で `stopReason: "error"` | `toolCall.name = "write"`、`stopReason: "toolUse"` |
| `tool_use.name` が `mcp__other__x`（別の接頭辞） | 「unexpected tool mcp__other__x」で `stopReason: "error"` | `toolCall.name = "mcp__other__x"`（外すのは `mcp__pi__` だけ） |
| 一覧に無い `toolCall` を受けた Pi の agent loop | 届かない（ターンが error で終わる） | `Tool <name> not found` のエラーのツール結果を作り、次の要求を送る |
| 次の要求で Claude に送る履歴 | 該当なし | 同じプロバイダの応答には再送用の native メッセージ（replay carrier）が付いているため、モデルが呼んだ名前（`write`）のまま `tool_use` を送り、続けて `is_error: true` の `tool_result` を送る |
| `RunClaudeInput.toolNames` | あり（`Set<string>`） | 無し |
| `EventTranslator` のコンストラクタ | `(model, output, stream, toolNames)` | `(model, output, stream)` |
| `README.md` 63行目 | 「tools outside Pi's inventory」を再試行しない失敗に数える | 列挙から外し、一覧に無いツールは Pi のツール結果としてモデルへ返す旨を書く |

## Pi 本体の挙動の確認

依頼の条件「続けられないとわかったら実装を進めない」を判定するため、`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`（1.5.0）を読み、実測した。結論として、Pi 本体は一覧に無い名前の `toolCall` でエラーのツール結果を返して続ける。実装を進めてよい。

コードで確かめたこと:

1. `prepareToolCall`（487行目）は `tools.find((t) => t.name === toolCall.name)` でツールを探し、見つからなければ `{ kind: "immediate", result: createErrorToolResult(\`Tool ${toolCall.name} not found\`), isError: true }` を返す。例外は投げない。
2. `createErrorToolResult`（646行目）は `{ content: [{ type: "text", text: message }], details: {} }` を返す。`createToolResultMessage`（662行目）がこれを `role: "toolResult"`・`toolName: toolCall.name`・`isError: true` のメッセージにする。
3. `runLoop`（84行目）は、`stopReason` が `error` か `aborted` のときだけループを抜ける（148行目）。`toolUse` の応答ではツール結果を `currentContext.messages` に積み、`hasMoreToolCalls = !executedToolBatch.terminate` とする。エラーのツール結果は `terminate` を持たないため、ループは次の要求へ進む。

実測したこと（`examples/unknown-tool.test.ts` の最後の1件）: `agentLoop` に `streamClaudeCode` を渡し、上流のフェイクが1回目に `write` の `tool_use`、2回目に文字の応答を返すようにした。`agentLoop` の結果には `toolName: "write"`・`isError: true`・`content: [{ type: "text", text: "Tool write not found" }]` のツール結果があり、上流には2回目の要求が届き、その本文に `is_error: true` の `tool_result` が入っていた。最後の応答の `stopReason` は `stop` だった。

## API・画面・業務ルール・設定・エラー

API（このパッケージが公開する関数と型）:

- `piToolName(nativeName: string): string` を `src/tool-config.ts` から export し、`src/transcript.ts` から再 export する。入口 `src/claude-cli.ts` からは再 export しない。
- 公開している型 `RunClaudeInput`（`src/claude-cli.ts` が再 export）からフィールド `toolNames` が消える。外部の利用者がこのフィールドをオブジェクトリテラルで渡していると型検査で余分なプロパティとして指摘されるが、実行時は無視されるため動作は変わらない。

画面: Pi の画面には、一覧に無い名前のツール呼び出しと、`Tool write not found` のエラーのツール結果が表示される。これは Pi 本体の表示であり、このパッケージは表示に関わらない。

業務ルール:

- 接頭辞 `mcp__pi__` が名前の先頭にあるときだけ外す。外すのは1回だけである（`mcp__pi__mcp__pi__x` は `mcp__pi__x` になる）。
- 名前の大文字と小文字は変えない（`Write` は `Write` のまま）。
- 接頭辞を外した結果が空文字になる場合（`tool_use.name` がちょうど `mcp__pi__`）も、空文字の名前の `toolCall` として返す。Pi の agent loop は `Tool  not found` を返す。
- Pi の一覧に同じ名前のツールがあれば、接頭辞の有無にかかわらず Pi がそのツールを実行する（例: Pi の一覧に `write` があり、モデルが接頭辞なしの `write` を呼んだ場合）。依頼の「名前をそのまま返す」から導かれる動きであり、Pi 本体が同じ名前のツールを実行するのは普段の動きと同じである。

設定: 追加しない。環境変数も増やさない。

エラー:

- 一覧に無いツール名は、このパッケージの中ではエラーにならない。モデルへのエラーは Pi の agent loop が作る。
- 次の検査と例外は残す: `prepareTools` のツール名の形式と重複の検査、ストリームと最終応答の内容の不一致（`Claude Code final response differs from its incremental stream`）、トークン使用量の欠落、使用量クレジットの拒否。

## 受け入れ条件

1. 対話 TUI 経路で、応答の `tool_use.name` が `write` のとき、`streamClaudeCode` の結果が `stopReason: "toolUse"`・`errorMessage: undefined`・`toolCall.name: "write"` になる。
2. 対話 TUI 経路で、`tool_use.name` が `mcp__pi__unknown` で Pi の一覧に `unknown` が無いとき、結果が `stopReason: "toolUse"`・`toolCall.name: "unknown"` になる。
3. `tool_use.name` が `mcp__pi__read` で Pi の一覧に `read` があるとき、`toolCall` の `id`・`name`・`arguments` が変更前と同じ（`toolu_read`・`read`・`{ path: "a.md" }`）になる。
4. Pi の `agentLoop` に `streamClaudeCode` を渡して1と同じ応答を受けると、`Tool write not found` のエラーのツール結果ができ、次の上流要求の本文に `is_error: true` の `tool_result` が入り、ループが最後の応答（`stopReason: "stop"`）まで進む。
5. `runTuiRequest` が、一覧に無い名前（`mcp__pi__unknown` と `write`）の `tool_use` を例外にせず、そのまま `message.content` に入れて返す。
6. -p 経路の `runClaudeRequest` が、Pi のツール一覧（`manifest`）が空でも `mcp__pi__echo` の `tool_use` を例外にせず返す。
7. `npm test` が全件合格し（設計時の実測は219件）、`npm run check` が合格する。
8. `src/` に文字列 `unexpected tool`・`unavailable tool`・`outside Pi's current tool inventory`・`toolNames` が残らない。

## 未決事項

- 次の要求で、replay carrier の無い履歴（別のプロバイダから切り替えた直後など）を送るときは、`canonicalAssistantContent`（`src/transcript.ts`）が名前に接頭辞を付け、`write` を `mcp__pi__write` として送る。モデルは自分が呼んだ名前と違う名前を履歴に見ることになる。Anthropic の API が、`tools` に定義の無い名前の `tool_use` を履歴に持つ要求を受け付けることは、この設計では実測していない（推測では受け付ける。carrier のある場合の `write` も定義に無い名前であり、フェイクの上流では検証できないため）。実機で拒否された場合は別の依頼で扱う。
- Claude Code 側は、モデルの `write` を自分のツールとして実行しようとし、`--tools ""` のため「ツールが無い」として後続の要求を送ると推測する。後続の要求は relay が拒否するため Pi の会話には影響しないと推測するが、対話 TUI の実機では確かめていない。

## メタ情報

- 依頼日: 2026-11-07
- 基準のコミット: `5ffc96a`（ブランチ `devflow/20261107-2023`）
- 設計時の作業木: `/tmp/spike-2023`（実測の後に削除した）
