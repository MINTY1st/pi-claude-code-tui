# 設計: TUI 経路の長い関数を分け、-p 経路と TUI 経路の応答チェックを共通にする（R2）

## 結論

振る舞いを変えずに、次の2つを行う。

1. TUI 経路で 50 行を超える2つの関数を、名前の付いた小さな関数へ分ける。`TurnRelay.handle`（`src/turn-relay.ts`、104 行）は 39 行に、`streamClaudeCode`（`src/stream.ts`、107 行）は 10 行にする。
2. -p 経路（`src/claude-print-process.ts` の `ClaudeProcess.run`）と TUI 経路（`src/tui-process.ts` の `TuiWorker.output`）に同じ形で書かれている3つのチェックを、共通の関数 `capturedMessage`・`completeUsage`・`guardUsageCredits` にまとめる。

依頼にある4つ目の「ツール一覧のチェック」は、HEAD `e3d2f1a` の時点で両方の経路から消えている（前の依頼 20261107-2023 で、一覧に無いツールを例外にしない仕様へ変えたため）。まとめる対象が無いので、この依頼ではツール一覧のチェックを書き足さない。書き足すと振る舞いが変わる。

既存のテストは1行も変えない。新しく足すテストは `tests/response-checks.test.ts`（16件）だけである。

設計時に、一時の作業木（HEAD `e3d2f1a`）へこの文書のとおりに変更を入れ、次を実測した。

| 確認 | 結果 |
| --- | --- |
| `npm run check` | 合格 |
| `npm test` | 235件中235件合格（変更前の219件と `tests/response-checks.test.ts` の16件） |
| `TurnRelay.handle` の行数 | 39 行 |
| `streamClaudeCode` の行数 | 10 行（いちばん長い新関数は `prepareRunInput` の 33 行） |
| `ClaudeProcess.run` の行数 | 129 行から 121 行へ減る（この依頼では 50 行以内にしない） |
| ファイルの行数 | `turn-relay.ts` 428、`stream.ts` 447、`tui-process.ts` 265、`claude-print-process.ts` 490、`billing.ts` 55、`response-checks.ts` 22 |

## 目的

`TurnRelay.handle` は、経路の判定・使用済みの拒否・本文の読み取りと書き換え・上流へのヘッダー作成・接続・応答の中継を1つの関数に持つ。`streamClaudeCode` は、Pi の会話から要求を作る処理・実行経路の選択・診断情報の組み立て・失敗の記録を1つの関数に持つ。どちらも 100 行を超え、関心事ごとに読めない。関数に名前を付けて分けると、各部分を単独で追える。

応答の完全性・usage・課金のチェックは、-p 経路と TUI 経路に同じ条件と同じ文言で2回ずつ書かれている。片方だけを直すと2つの経路の振る舞いがずれるため、1か所にまとめる。

## 範囲

範囲に入るもの:

- `src/response-checks.ts` の新規作成（`capturedMessage`・`completeUsage`）
- `src/billing.ts` への `guardUsageCredits` の追加
- `src/turn-relay.ts` の `TurnRelay.handle` の分割
- `src/stream.ts` の `streamClaudeCode` の分割
- `src/tui-process.ts` の `assertCompleteCapture` と `TuiWorker.output` を、共通の関数の呼び出しへ置き換えること
- `src/claude-print-process.ts` の `ClaudeProcess.run` の3か所を、共通の関数の呼び出しへ置き換えること
- `tests/response-checks.test.ts` の新規作成

範囲に入らないもの（この依頼では行わない）:

- 既存のテスト（`tests/` の既存ファイル）の変更
- `ClaudeProcess.run`（121 行）・`ClaudeProcess.create`（94 行）・`discoverClaudeModels`・`createClaudeCodeProvider` など、TUI 経路でない長い関数の分割
- `AnthropicCapture.apply`（46 行）など、50 行以内の関数の分割
- 識別子 `env`・`args`・`fn` の改名（fast-guard の `abbreviated-identifier` は変更前からある指摘で、`RunClaudeInput.env` は公開インターフェースのフィールド名である）
- ツール一覧のチェックの追加
- エラー文言・HTTP ステータス・ヘッダーの値・診断情報の形の変更
- README.md の変更（利用者から見える振る舞いが変わらないため）

## 変更前と変更後

### 外から見える振る舞い

変わらない。次のすべてが変更前と同じである。

- `streamClaudeCode` が Pi へ流すイベントの種類と順番（`start` → 中身のイベント → `done`、または `error`）
- `runTuiRequest` と `runClaudeRequest` が返す `RunClaudeOutput` の中身
- 投げるエラーの文言（下の「エラー」の表）
- relay が TUI へ返す HTTP ステータス（404・400・499・502、上流のステータス）と本文
- relay が上流へ送るヘッダー（取り除くヘッダー、`accept-encoding: identity`、`content-length`、`anthropic-beta` の合成）と、TUI へ返すヘッダー（取り除くヘッダー、`connection: close`）
- `RelayFailure.kind` を決める段階（`request` → `connect` → `disconnect`、`capture`）の切り替わる位置

### 内部の構成

| 観点 | 変更前 | 変更後 |
| --- | --- | --- |
| 応答の完全性チェック | `tui-process.ts` の `assertCompleteCapture` と `claude-print-process.ts` の `run` に同じ条件を2回書く | `response-checks.ts` の `capturedMessage` を両方から呼ぶ |
| usage の検証 | 両方の経路に同じ条件と同じ文言を2回書く | `response-checks.ts` の `completeUsage` を両方から呼ぶ |
| 課金ガード | 両方の経路に同じ条件を2回書く | `billing.ts` の `guardUsageCredits` を両方から呼ぶ |
| ツール一覧のチェック | どちらの経路にも無い（`e3d2f1a` で削除済み） | 変えない（無いまま） |
| `TurnRelay.handle` | 104 行。全段階を1関数に持つ | 39 行。段階ごとに4つのメソッドと8つのモジュール関数を呼ぶ |
| `streamClaudeCode` | 107 行。中に 87 行の即時実行の無名関数を持つ | 10 行。`runTurn` ほか6つの関数を呼ぶ |

## API

公開する名前（`export`）は、次の3つだけを足す。既存の公開名は変えない。

| 名前 | ファイル | 形 |
| --- | --- | --- |
| `capturedMessage` | `src/response-checks.ts` | `(outcome: CapturedOutcome) => NativeMessage` |
| `completeUsage` | `src/response-checks.ts` | `(usage: NativeUsage \| undefined) => NativeUsage` |
| `CapturedOutcome` | `src/response-checks.ts` | `interface CapturedOutcome extends RelayOutcome { capture: { complete: boolean; message?: NativeMessage } }` |
| `guardUsageCredits` | `src/billing.ts` | `(rateLimit: RateLimitInfo \| undefined, environment: Record<string, string \| undefined>) => void` |

`src/claude-cli.ts`（入口）からは再 export しない。使うのは `src/` の内部とテストだけである。

`turn-relay.ts` と `stream.ts` に足す関数とメソッドは、すべて `export` しない（structure.md）。既存のテストが外から振る舞いを確かめているため、分けた関数を個別に公開してテストする必要がない。

## 画面

変更しない。

## 業務ルール

新しい業務ルールは足さない。共通にした3つの関数は、変更前の条件をそのまま持つ。

- `capturedMessage`: 上流のステータスが 200 で、`capture.complete` が真で、`capture.message` があるときだけ、その message を返す。それ以外は `incompleteUpstreamMessage(outcome)` を文言にして投げる。
- `completeUsage`: usage があり、`input_tokens` と `output_tokens` がどちらも `typeof === "number"` のときだけ、渡された usage をそのまま返す。0 も通す。
- `guardUsageCredits`: `rateLimit?.isUsingOverage === true` で、かつ `usageCreditsAllowed(environment)` が偽のときだけ、`usageCreditsChargeError(rateLimit)` を投げる。

経路ごとに違う部分は、呼び出し側に残す。

- TUI 経路だけが「relay を1度も使わなかった」ことをエラーにする（`relay.used` の判定は `assertCompleteCapture` に残す）。-p 経路では relay を使わずに stream-json だけで答えることがあるため、この判定を持たない。
- usage の取り出し方は経路ごとに違う。-p 経路は `message.usage ?? result.usage`、TUI 経路は `message.usage` を `completeUsage` に渡す。
- 課金ガードの `environment` は、両方の経路とも `{ ...process.env, ...input.env }` を呼び出し側で作って渡す。`guardUsageCredits` は `process.env` を読まない。

## 設定

変えない。環境変数（`PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS`・`PI_CLAUDE_CODE_TUI` など）の名前と意味はそのままである。

## エラー

投げる文言はすべて変更前と同じである。投げる場所だけが共通の関数へ移る。

| 条件 | 文言 | 投げる場所（変更後） |
| --- | --- | --- |
| TUI 経路で relay が使われなかった | `Claude Code's interactive mode sent no request for the turn` | `tui-process.ts` の `assertCompleteCapture`（変更なし） |
| 上流が 200 でない、または message_stop まで届かない | `incompleteUpstreamMessage(relay)` の文言（接続の失敗なら `Claude Code upstream connection error: ` などで始まる） | `capturedMessage` |
| usage が無い、またはトークン数が数でない | `Claude Code response did not include complete token usage` | `completeUsage` |
| 使用量クレジットで払われた | `usageCreditsChargeError(rateLimit)` の文言（`Claude Code billing: ...`） | `guardUsageCredits` |
| 終わりの stopReason が error・aborted・pending | `output.errorMessage`、空なら `Claude Code ended with <stopReason>` | `stream.ts` の `finishedReason` |

チェックの順番も変えない。TUI 経路は「relay の使用 → 応答の完全性 → usage → 課金」、-p 経路は「応答の完全性 → message・message_stop・result の有無 → ネイティブのエラー → result の subtype → usage → 課金」の順で調べる。

## 受け入れ条件

- [ ] `npm test` が 235 件すべて合格する（既存の 219 件と `tests/response-checks.test.ts` の 16 件）
- [ ] `npm run check` が合格する
- [ ] `git diff --stat -- tests/` に出るのは `tests/response-checks.test.ts` の追加だけである
- [ ] `TurnRelay.handle` と `streamClaudeCode` が、それぞれ 50 行以内である（関数の開始行から閉じ括弧の行まで）
- [ ] 新しく足した関数とメソッドが、すべて 50 行以内である
- [ ] 次の grep が `src/response-checks.ts` と `src/billing.ts` の中の1か所ずつしか出さない
  - `grep -rn "did not include complete token usage" src` は `src/response-checks.ts` だけ
  - `grep -rn "isUsingOverage === true" src` は `src/billing.ts` だけ
  - `grep -rn "incompleteUpstreamMessage(" src` は `src/relay-failure.ts`（定義）と `src/response-checks.ts` だけ
- [ ] `grep -rn "outside Pi's current tool inventory\|toolNames" src` が何も出さない（ツール一覧のチェックを書き足していない）
- [ ] 各ファイルの本体が 500 行以内である（`stream.ts` は 447 行、`claude-print-process.ts` は 490 行が目安）
- [ ] README.md・`src/claude-cli.ts`・`package.json` に差分が無い

## 未決事項

- ツール一覧のチェックは HEAD の時点で両方の経路から消えているため、この設計ではまとめる対象から外した。依頼がツール一覧のチェックを再び入れることを意図しているなら、それは振る舞いの変更であり、別の依頼として扱う必要がある。渡部さんに確かめたい。
- diagnostics（`claude-code.turn-relay`・`claude-code.rate-limit`）を確かめる既存テストが無い。この依頼は既存テストを変えず、`turnDiagnostics` は export しないので、diagnostics のテストも足さない。中身を1文字も変えずに移すことと reviewer の目視で守る。テストを足すかは別の依頼で決めてほしい。
- `ClaudeProcess.run` は共通化の後も 121 行あり、循環的複雑度も上限を超える。-p 経路の分割は依頼の (1) の対象外なので、次の依頼（R3）で扱うかを決めてほしい。

## メタ情報

- 依頼の版: R2（R1 は docs/devflow/20261107-1953）
- 起点の HEAD: `e3d2f1a`（ブランチ `devflow/20261107-2050`）
- 作成日: 2026-11-07
