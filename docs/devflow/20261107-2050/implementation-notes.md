# 実装メモ: R2 の分割と共通化

## fast-guard の差し戻しについて（対応しない）

`src/claude-print-process.ts` に次の7件の指摘が届いた。

- `abbreviated-identifier`: `fn`（93行）・`env`（168行・230行）・`args`（236行）
- `function-length`: `create`（94行・210行）・`run`（121行・348行）
- `complexity`: `run`（循環複雑度 42・348行）

いずれも変更前からあった指摘である。実測は次のとおり。

```
$ git show HEAD:src/claude-print-process.ts > /tmp/guardcheck/claude-print-process.head.ts
$ node ~/.pi/agent/lib/jev-static-lint/cli.mjs /tmp/guardcheck/claude-print-process.head.ts
93 [abbreviated-identifier] fn
168 [abbreviated-identifier] env
230 [abbreviated-identifier] env
236 [abbreviated-identifier] args
210 [function-length] create 94 行
348 [function-length] run 129 行
348 [complexity] run 循環複雑度 50
```

変更後はこの7件がそのまま残り、`run` は 129 行から 121 行、循環複雑度は 50 から 42 へ減った。新しい指摘は増えていない。

design.md の「範囲に入らないもの」は、この7件を名指しで対象外にしている。`RunClaudeInput.env` は公開インターフェースのフィールド名であり、改名は振る舞いを変えないリファクタの範囲を超える。`ClaudeProcess.run` と `create` の分割は次回（R3）で扱う。よってこの差し戻しは取り込まず、ここに記録する。

## examples のコピー

- `examples/response-checks.ts` を `src/response-checks.ts` へ1行目のコメントを除いてコピーした。
- `examples/response-checks.test.ts` を `tests/response-checks.test.ts` へ1行目のコメントを除いてコピーした。
- `examples/billing-guard.ts` の4行目以降を `src/billing.ts` の `usageCreditsChargeError` の直後へ貼った。import は増やしていない。

## TDD の記録

1. `tests/response-checks.test.ts` を置いた直後: `ERR_MODULE_NOT_FOUND`（`src/response-checks.ts` が無い）。
2. `capturedMessage`・`completeUsage`・`guardUsageCredits` を `throw new Error("not yet")` の仮実装にした: 16件中15件が失敗し、1件（4xx でデータが変わらない）だけが通った。投げるだけで条件を満たすテストのためである。
3. examples の本体へ置き換えた: 16件すべて合格。
4. 呼び替えと分割は Refactor として行い、各手順の後に `npm test` の関連ファイルと `npm run check` を流した。手順ごとの結果は次のとおり。
   - `tui-process.ts` の呼び替え: `tests/tui-process.test.ts`・`tests/billing.test.ts` の43件合格。
   - `claude-print-process.ts` の呼び替え: `tests/claude-cli.test.ts`・`tests/billing.test.ts`・`tests/unknown-tool.test.ts` の14件合格。
   - `turn-relay.ts` の分割: `tests/turn-relay*.test.ts`・`tests/relay-failure.test.ts`・`tests/turn-body.test.ts` の42件合格。
   - `stream.ts` の分割: `tests/stream-abort.test.ts`・`tests/unknown-tool.test.ts`・`tests/billing.test.ts` の13件合格、`tests/claude-cli.test.ts` の6件合格。
   - 最後に `npm test` で235件全件合格、`npm run check` 合格。

## 行数の実測（関数の開始行から閉じ括弧の行まで）

`js-analyzer.mjs` で測った。design.md の実測値と少しずれるが、どれも上限 50 行以内である。

| 関数 | 実測 | design.md |
| --- | --- | --- |
| `TurnRelay.handle` | 41 | 39 |
| `TurnRelay.readTurnBody` / `openUpstream` / `relayResponse` | 7 / 14 / 18 | 7 / 14 / 17 |
| `upstreamRequestHeaders` | 14 | 14 |
| `streamClaudeCode` | 10 | 10 |
| `runTurn` / `prepareRunInput` | 28 / 44 | 26 / 33 |
| `newOutput` / `turnDiagnostics` / `markFailed` | 12 / 18 / 9 | 12 / 8 / 10 |

`prepareRunInput` と `turnDiagnostics` は、return のオブジェクトを1行ずつ縦に書いたため design.md の実測より長い。行数を合わせるために詰めると読みにくくなるため、上限の範囲で縦書きのままにした。

ファイルの行数は `turn-relay.ts` 431、`stream.ts` 470、`tui-process.ts` 265、`claude-print-process.ts` 490、`billing.ts` 55、`response-checks.ts` 22 で、どれも本体 500 行以内に収まる。

## lint の結果

`src/turn-relay.ts`・`src/stream.ts`・`src/tui-process.ts`・`src/billing.ts`・`src/response-checks.ts` は `jev-static-lint` の指摘が0件である。`src/claude-print-process.ts` だけが上記7件（すべて変更前から）を返す。

## reviewer の判定

【APPROVE】。必須の指摘は無い。参考の指摘が1件あったので、ここに残す。

- `src/stream.ts`: `prepareRunInput` が `process.cwd()` を start を流す前に評価する。作業ディレクトリが消えている場合は、変更前の「start → error」に対して「error だけ」になる。design.md が `prepareRunInput` に `cwd` を含めて返す形を指定しているため、このターンでは対応しない。
