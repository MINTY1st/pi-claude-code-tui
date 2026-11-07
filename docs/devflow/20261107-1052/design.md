# 一時的な通信障害で Pi の自律作業が止まる問題の修正 設計

## 結論

relay の失敗を「種別（どの段階で失敗したか）＋ name・code・message の全文」で記録し、最終エラー文言を新しい純粋関数 `incompleteUpstreamMessage`（新規 `src/relay-failure.ts`）で1か所から組み立てる。接続失敗・切断・無応答の打ち切りの3種だけ、Pi の再試行判定（pi-ai の `isRetryableAssistantError`）が一致する固定句を先頭に付ける。400 系・課金・ツール一覧外・応答の解析失敗には固定句を付けない。効いていない `http.request` の `timeout` オプションは外し、`TurnRelay` のコンストラクタから `timeoutMs` 引数を削除する。

## 目的

v0.1.5 以降も、次の3種の一時的な通信障害で Pi の自律作業が止まる。

| 障害 | 現在の最終エラー文言（例） |
| --- | --- |
| 接続失敗 | `Incomplete Claude Code upstream response (status unknown, capture incomplete, relay failure AggregateError)` |
| 切断 | `Incomplete Claude Code upstream response (status 200, capture incomplete, relay failure Error)` |
| 無応答 | `Claude Code did not finish its turn within 300000ms: <画面>` |

本拡張は Claude Code に `CLAUDE_CODE_MAX_RETRIES=0`（`src/claude-cli.ts` の `processEnvironment`）を渡すので、Claude Code は再送しない。Pi 本体の自動再試行は `AgentSession._isRetryableError` が `isRetryableAssistantError(message)` を呼び、`errorMessage` が `RETRYABLE_PROVIDER_ERROR_PATTERN` に一致し、かつ `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` に一致しないときだけ再試行する。上の3文言はどれも一致しないため、誰も再試行しない。

加えて、`src/turn-relay.ts` の `handle` は例外の `error.name` だけを `failure` に残すため、`AggregateError` の内訳（`ECONNREFUSED` など）や `onEvent` が投げた例外の本文が最終エラーから消え、原因を追えない。

## 範囲

対象:

- `src/relay-failure.ts`（新規）: 例外の記述、失敗種別、最終エラー文言の組み立て
- `src/turn-relay.ts`: `failure` の型と記録内容、`AnthropicCapture` の例外の包み方、`http.request` の `timeout` 削除、コンストラクタ引数の削除
- `src/tui-process.ts`: `assertCompleteCapture` の文言組み立てを `incompleteUpstreamMessage` に置き換え、`new TurnRelay` の引数変更
- `src/claude-cli.ts`: `claude -p` 経路の不完全応答の文言組み立てを `incompleteUpstreamMessage` に置き換え、`new TurnRelay` の引数変更
- `src/pty-session.ts`: `waitIdle` のタイムアウト文言
- `tests/relay-failure.test.ts`（新規）、`tests/turn-relay.test.ts`、`tests/pty-session.test.ts`
- `README.md` の Configuration 節に1段落追加

対象外（変更しない）:

- `CLAUDE_CODE_MAX_RETRIES=0` の値。Claude Code 側の再送は relay が `PI_CLAUDE_CODE_TURN_RELAY_CONSUMED` で拒否する設計のまま
- 拡張内での独自の再試行。再試行は Pi 本体に任せる
- `src/stream.ts` の `normalizeError`（文言はそのまま通過する）
- `TuiSession.ready` と `TuiSession.clear` のタイムアウト文言
- `claude -p` 経路の `Claude Code stream timed out`（既に `timed? out` に一致する）
- 200 応答で接続が正常に閉じたのに `message_stop` が来なかった場合（`failure` が無い不完全応答）の文言
- 上流の 4xx 本文（`upstream said:` 以降）の書き換え
- `timeoutMs` の既定値（`tui-process.ts` の `DEFAULT_TIMEOUT_MS = 180_000`、Pi からは通常 300000）

## 変更前と変更後

### relay の失敗記録（`TurnRelay.failure`）

| 項目 | 変更前 | 変更後 |
| --- | --- | --- |
| 型 | `string \| undefined` | `RelayFailure \| undefined`（`{ kind, summary, detail }`） |
| 中身 | `error.name` のみ（例: `AggregateError`） | `kind`: 失敗した段階、`summary`: name と code、`detail`: name・code・message と AggregateError の内訳 |
| 例: 接続失敗 | `AggregateError` | `detail` = `AggregateError [ECONNREFUSED] (errors: Error [ECONNREFUSED]: connect ECONNREFUSED 160.79.104.10:443; Error [ECONNREFUSED]: connect ECONNREFUSED 2607:6bc0::10:443)` |
| 例: 切断 | `Error` | `detail` = `Error [ECONNRESET]: aborted` |
| 例: onEvent の例外 | `Error` | `detail` = `CaptureError: Claude Code stream handling failed: Error: Claude Code returned unavailable tool foo` |

### 最終エラー文言

| 状況 | 変更前 | 変更後 | 再試行 |
| --- | --- | --- | --- |
| 接続失敗（上流の応答ヘッダーを受け取る前の失敗） | `Incomplete Claude Code upstream response (status unknown, capture incomplete, relay failure AggregateError)` | `Claude Code upstream connection error: Incomplete Claude Code upstream response (status unknown, capture incomplete, relay failure AggregateError [ECONNREFUSED] (errors: ...))` | しない → する |
| 切断（応答ヘッダー受信後の失敗、status が 4xx 以外） | `Incomplete Claude Code upstream response (status 200, capture incomplete, relay failure Error)` | `Claude Code upstream connection lost: Incomplete Claude Code upstream response (status 200, capture incomplete, relay failure Error [ECONNRESET]: aborted)` | しない → する |
| 無応答の打ち切り（TUI 経路） | `Claude Code did not finish its turn within 300000ms: <画面>` | `Claude Code timed out: it did not finish its turn within 300000ms: <画面>` | しない → する |
| 4xx 応答の本文読み取り中の切断 | `... (status 400, capture incomplete, relay failure Error, upstream said: ...)` | `Incomplete Claude Code upstream response (status 400, capture incomplete, relay failure Error [ECONNRESET], upstream said: ...)`（message を含めない） | しない → しない |
| 4xx 応答（失敗なし） | `Incomplete Claude Code upstream response (status 400, capture incomplete, upstream said: <message>)` | 同じ | しない → しない |
| onEvent・SSE・JSON 解析の例外 | `... relay failure Error` / `relay failure SyntaxError` | `Incomplete Claude Code upstream response (status 200, capture incomplete, relay failure CaptureError: Claude Code stream handling failed: <元の name・code・message>)` | しない → しない |
| 要求本文の読み取り・`transformRequest` の例外 | `... relay failure Error` | `Incomplete Claude Code upstream response (status unknown, capture incomplete, relay failure <元の name・code・message>)` | しない → しない |
| TUI 経路で Claude Code の再送を拒否した場合 | `native retries denied` を出さない | `, native retries denied <N>` を出す（`claude -p` 経路と同じ書式に統一） | 変更なし |

固定句と、それが一致する pi-ai のパターンは次のとおり（`node_modules/@earendil-works/pi-ai/dist/utils/retry.js` で実測確認済み）。

| 種別 | 固定句 | 一致するパターン |
| --- | --- | --- |
| 接続失敗 | `Claude Code upstream connection error` | `connection.?error` |
| 切断 | `Claude Code upstream connection lost` | `connection.?lost` |
| 無応答 | `Claude Code timed out` | `timed? out` |

## API（関数の契約）

### `src/relay-failure.ts`（新規）

```ts
export type RelayFailureKind = "request" | "connect" | "disconnect" | "capture";
export interface RelayFailure { kind: RelayFailureKind; summary: string; detail: string }
export interface RelayOutcome {
  status?: number;
  failure?: RelayFailure;
  denied: number;
  capture: { complete: boolean };
  errorText(): string;
}
export class CaptureError extends Error {}
export function describeError(error: unknown): string;
export function relayFailure(kind: RelayFailureKind, error: unknown): RelayFailure;
export function isTransientRelayFailure(outcome: Pick<RelayOutcome, "status" | "failure">): boolean;
export function incompleteUpstreamMessage(outcome: RelayOutcome): string;
```

実装はお手本 `docs/devflow/20261107-1052/examples/relay-failure.ts` をそのまま `src/relay-failure.ts` にコピーする。詳細は structure.md に書く。

### `TurnRelay`（変更）

```ts
// 変更前
constructor(upstream?: string, timeoutMs?: number, onEvent?, transformRequest?, requestBetas?: string[]);
failure?: string;
// 変更後
constructor(upstream?: string, onEvent?, transformRequest?, requestBetas?: string[]);
failure?: RelayFailure;
```

## 業務ルール

1. 一時的な障害は「接続失敗」「切断」「無応答の打ち切り」の3種に限る。
2. 接続失敗は、上流へ要求を出してから応答ヘッダーを受け取るまでの例外である（`kind: "connect"`）。上流がヘッダー前に接続を切った `socket hang up` もここに入る。
3. 切断は、応答ヘッダーを受け取ったあとの例外である（`kind: "disconnect"`）。上流側の切断と、TUI への書き込み失敗（`Claude Code disconnected from the turn relay`）の両方を含む。
4. 切断でも status が 400〜499 のときは一時的としない。固定句を付けず、`relay failure` には `summary`（name と code）だけを出す。message に `socket hang up` などの再試行語が入り、400 系が再試行されるのを防ぐためである。
5. status 429 は、本変更で固定句を付けない。ただし `status 429` の `429` が pi-ai の既存パターンに一致するため、Pi は既存どおり再試行する（本変更で挙動を変えない）。
6. `AnthropicCapture` の中（SSE フレームの JSON 解析、`tool_use` 入力の JSON 解析、`onEvent`）で起きた例外は `kind: "capture"` とし、一時的としない。`onEvent` の例外には、ツール一覧外の `Claude Code returned unavailable tool <name>` / `Claude Code returned unexpected tool <name>`（`src/stream.ts`）が含まれる。
7. 上流へ要求を出す前の例外（TUI からの要求本文の読み取り、`transformRequest`）は `kind: "request"` とし、一時的としない。
8. 課金（`usageCreditsChargeError`・`describeUsageCreditsRejection`）とツール一覧外（`Claude Code returned a tool outside Pi's current tool inventory`）の文言は変更しない。どちらも再試行されないことをテストで固定する。
9. 一時的としない失敗でも、`relay failure` には `detail`（元の message を含む全文）を出す。例外はルール4の 4xx の切断だけである。
10. `detail` は1000文字を上限とし、超えた分は切り捨てて末尾に `…` を付ける。`upstream said:` 以降は既存どおり500文字で切る。
11. 無応答の打ち切りは `TuiSession.waitIdle` のタイムアウトだけを対象とする。締め切りの数え方（最後の上流活動 + `timeoutMs`）は変えない。

## 設定

追加しない。環境変数の追加・変更もない。`http.request` の `timeout` を外す理由は次のとおりである。Node.js の `timeout` オプションはソケットが無通信になったとき `timeout` イベントを出すだけで、接続を破棄しない。relay は `timeout` イベントを購読していないので、現状は何もしていない。無通信の打ち切りは、TUI 経路では `waitIdle`（`lastActivityAt` 基準）、`claude -p` 経路では `EventQueue.next`（`Claude Code stream timed out`）が同じ `timeoutMs` で既に行っている。relay 側でも効かせると、同じ時刻に2つの打ち切りが競合し、最終エラーが「無応答」と「切断」のどちらになるかが実行ごとに変わる。

## エラー

- 新しい例外クラスは `CaptureError`（`name = "CaptureError"`）だけである。`AnthropicCapture.feed` / `finish` の中で起きた例外を包み、`cause` に元の例外を持つ。`message` は `Claude Code stream handling failed: <describeError(元の例外)>`。
- `CaptureError` は `TurnRelay.handle` の `catch` で `kind: "capture"` に変換され、relay の外には出ない。最終エラーは既存どおり `tui-process.ts` の `assertCompleteCapture`、`claude-cli.ts` の `ClaudeProcess.run` が `new Error(incompleteUpstreamMessage(relay))` として投げる。
- `src/stream.ts` の `normalizeError` は文言をそのまま `errorMessage` にする（context 長超過と課金の書き換えは既存どおり）。

## ドキュメント

`README.md` の Configuration 節、`Pi's request timeout ...` の段落の直後に次の段落を追加する。

> Connection failures, dropped connections and idle timeouts are reported with wording that Pi's automatic retry recognizes (`connection error`, `connection lost`, `timed out`), so Pi retries the turn even though Claude Code's own retries stay disabled (`CLAUDE_CODE_MAX_RETRIES=0`). 4xx responses, billing errors, tools outside Pi's inventory and malformed streams are reported without that wording and are not retried.

リポジトリに `docs/sync_backlog_wiki.js` は存在しないので、同期は実行しない。

## 受け入れ条件

1. 接続失敗・切断（status 200 と 5xx）・無応答の打ち切りの最終エラー文言を `isRetryableAssistantError({ stopReason: "error", errorMessage })` に渡すと `true` になる。
2. 4xx（429 を除く）・4xx 本文読み取り中の切断・課金・ツール一覧外・`onEvent` の例外・SSE / JSON の解析失敗・`transformRequest` の例外の最終エラー文言は `false` になる。
3. `AggregateError` の最終エラー文言に、外側の code と内側の各 errors の name・code・message が含まれる。
4. `onEvent` が投げた例外の message と、`JSON.parse` の `SyntaxError` の message が最終エラー文言に含まれる。
5. `src/turn-relay.ts` に `timeout:` の指定が無く、`TurnRelay` のコンストラクタに `timeoutMs` 引数が無い。
6. `test-list.md` の全項目に対応するテストが `npm test` で合格する。テストは pi-ai の `isRetryableAssistantError` を `@earendil-works/pi-ai` から実際に import して呼ぶ（判定を自前で再実装しない）。
7. `npm run check`（`tsc --noEmit`）が合格する。
8. 既存テスト `tests/pty-session.test.ts` の `/did not finish its turn within 500ms/` は変更せずに合格する。

## 未決事項

- 4xx 応答の本文（`upstream said:` 以降）や、一時的としない失敗の `detail` に偶然 pi-ai の再試行語（例: JSON 解析エラーの `position 500` の `500`、`timeout` という名前のツール）が含まれると、Pi が再試行する。本文や元の message を書き換えると原因調査の情報が失われるため、今回は許容し、書き換えない。
- 無応答の打ち切りの文言は画面（`lastScreen()`）を含む。画面に `billing` などの非再試行語が出ていると Pi は再試行しない。今回は許容する。
- 200 応答で `message_stop` 前に接続が正常に閉じた場合（`failure` が無い不完全応答）を一時的とするかは依頼の範囲外であり、今回は変更しない。
- 本番環境での `AggregateError`（IPv4/IPv6 の両方への接続失敗）は自動テストで再現しない。単体テストでは `AggregateError` を直接作って確かめ、統合テストでは単一の `ECONNREFUSED` で確かめる。
