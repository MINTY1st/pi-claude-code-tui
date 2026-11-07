# テストリスト

対象: `src/tui-screen.ts`（`tests/tui-screen.test.ts`）、`src/pty-session.ts`（`tests/pty-session.test.ts`）、`src/tui-process.ts`（`tests/tui-process.test.ts`）、`src/tui-lifecycle.ts`・`src/stream.ts`・`src/provider.ts`（`tests/stream-abort.test.ts`）。各項目の括弧内はお手本 `examples/tests-changes.diff` のテスト名である。

## 進め方

1. `examples/fake-claude.diff` を当てる。既存の `npm test` が151件すべて合格することを確かめる（偽 claude の既定の挙動は変わらない）。
2. `examples/tests-changes.diff` を当てる。続けて、本体に次の仮実装だけを入れる（import 解決の失敗ではなく、AssertionError か時間切れで落ちる Red を確かめるため）。
   - `src/tui-screen.ts`: `export function promptAfterBusy(_plain: string): boolean { return false; }`
   - `src/pty-session.ts`: `TuiSessionOptions.promptFallbackMs?: number`、`export interface FallbackHold { since?: number }`、常に `false` を返す `promptFallbackReached`、`waitIdle` の第3引数 `_responseComplete?: () => boolean`（使わない）
3. 4ファイルを実行し、次の11件だけが落ちることを確かめる（確認済み。残り51件は合格する）。
   - AssertionError: `promptAfterBusy は、…だけ真になる`、`境界値: esc to interrupt の直後の入力欄は…`、`promptFallbackReached は…数え直す`、`境界値: holdMs が 0 なら…`、`stream-abort.test.ts` の `Pi が中断済みの signal で要求を始めても…`・`…起動中にセッションを片付けた…`・`…ターン中にセッションを片付けた…`（いずれも `'error' !== 'aborted'`）
   - 時間切れ（`Claude Code timed out: it did not finish its turn within …`）: `反例: 応答中（スピナーの描き直し中）の…`、`反例: 応答中の表示の後ろに入力欄が…`、`終了行を取りこぼしても…`、`終了行を描かない TUI でも…`。これは修正前の不具合そのもの（終了行が無いと打ち切りまで待つ）の再現である
4. `examples/src-changes.diff` の内容を、テストリストの上から1件ずつ入れて Green にする。順序は `promptAfterBusy` → `promptFallbackReached` → `waitIdle` → `tui-process.ts` → `provider.ts` → `tui-lifecycle.ts` → `stream.ts`。
5. 「反例の Red の確かめ方」の6つの書き換えを1つずつ試し、表のテストが落ちることを確かめてから元に戻す。
6. 全体確認を実行する。

## 画面の判定（`promptAfterBusy`）

- [ ] 応答中の表示より後ろに入力欄 `❯\u00a0? for shortcuts` が描き直された画面と、`● ok ──── ❯\u00a0 ────` は真になる（promptAfterBusy は、応答中の表示より後ろに入力欄が描き直されたときだけ真になる）
- [ ] 反例: 2026-11-05〜06 の応答中の画面 `✶ Frosting… (14s · ↓ 799 tokens) ──── ❯ ──── ⏸ manual mode on · esc to interrupt`、`❯\u00a0continue ✻ Thinking… (esc to interrupt)`、それにスピナーの描き直しを足した画面は偽になる（反例: 応答中の画面（入力欄の後ろに esc to interrupt がある）では偽になる）
- [ ] 反例: 空の画面、`● ok ✻ Thinking…`、`❯continue`（❯ の直後が空白でない）は偽になる（反例: 入力欄が一度も描かれていない画面では偽になる）
- [ ] 境界値: `esc to interrupt❯\u00a0` は真、`❯\u00a0esc to interrupt` は偽になる（境界値: esc to interrupt の直後の入力欄は真、直前の入力欄は偽になる）
- [ ] 反例: 終了行がある画面の `turnFinished` は真、終了行の無い同じ画面は偽のままである（反例: 終了行がある画面の判定（turnFinished）は promptAfterBusy の追加で変わらない）

## 時間の判定（`promptFallbackReached`）

- [ ] 境界値: holdMs 300 で、1000 に開始して 1299 は偽、1300 は真。偽を渡すと `since` が `undefined` に戻り、1302 で数え直して 1602 で真になる（promptFallbackReached は条件が holdMs 続いたときだけ真になり、途切れたら数え直す）
- [ ] 境界値: holdMs 0 なら、条件が成り立った最初の確認で真、成り立たなければ偽になる（境界値: holdMs が 0 なら、条件が成り立った最初の確認で真になる）

## ターン終了の判定（`TuiSession.waitIdle`、偽 claude と `promptFallbackMs: 300`）

- [ ] 反例: 終了行なし・スピナー 50ms 間隔・応答 1500ms の画面は、`responseComplete` が最初から真でも、偽 claude が入力欄を描き直す 1500ms より前に終えない（反例: 応答中（スピナーの描き直し中）の画面は、受信が終わっていても終了とみなさない）
- [ ] 反例: 応答中の表示の直後に入力欄が描かれる画面（`FAKE_PROMPT_WHILE_BUSY=1`）でも、`responseComplete` が真になる 1000ms + 300ms より前に終えない（反例: 応答中の表示の後ろに入力欄が描かれていても、受信が終わるまでは終了とみなさない）
- [ ] 反例: 終了行なしで `responseComplete` が偽のままなら、入力欄があっても `timed out: it did not finish its turn within 800ms` で打ち切る（反例: 終了行が無く受信も終わっていなければ、入力欄があっても timeoutMs で打ち切る）
- [ ] 反例: `responseComplete` を渡さない呼び出しは、終了行が無ければ従来どおり `timed out` で打ち切る（反例: responseComplete を渡さない呼び出しは、終了行が無ければ従来どおり打ち切る）
- [ ] 終了行なし・`responseComplete` が真なら、300ms 以上 3000ms 未満で終える（終了行を取りこぼしても、受信完了と入力欄が promptFallbackMs 続けばターンを終える）
- [ ] 終了行がある通常のターンは、`promptFallbackMs: 2000`・`responseComplete` が偽でも 1500ms 未満で終える（終了行がある通常のターンは、補助判定を待たずに終える）

## relay と組み合わせた判定（`runTuiRequest`、実 HTTP の偽上流、既定の 3000ms）

- [ ] 終了行を描かない偽 claude（`FAKE_TURN_LINE=0`）でも、応答 `hello` を返し、`timeoutMs` 10000ms より前に終える（終了行を描かない TUI でも、応答を受け取り終えたら補助判定でターンを終える（2026-11-06 に 300 秒待って失敗した））
- [ ] 反例: `message_stop` を送らない上流では、終了行が無く入力欄が出ていても補助判定で終えず、`timeoutMs` 5000ms で `timed out` になる（`Incomplete` で早く終わらない）（反例: message_stop が届かない応答は、終了行が無く入力欄が出ていても補助判定で終えず、時間切れにする）
- [ ] 既存の `上流が少しずつ返し続ける長いターンは…` が変更せずに合格する

## 中断の記録（`streamClaudeCode`）

- [ ] 再現: 中断済みの signal で、pi-ai の `lazyStream` の setup の中で `provider.auth.apiKey.resolve` を呼んでから `streamClaudeCode` を返すと、`stopReason` が `aborted`、`errorMessage` が `This operation was aborted` になる（Pi が中断済みの signal で要求を始めても、aborted・This operation was aborted として記録する（2026-11-07 に error と記録された））
- [ ] Pi の signal で中断した要求は `aborted` になる（既存の挙動の固定）（Pi の signal で中断した要求は aborted として記録する）
- [ ] 状態遷移: 起動中（`ready` の前）にセッションを片付けると、Pi の signal は中断されないまま、`aborted`・`Claude Code TUI session was closed` になる（Pi の signal が生きたまま起動中にセッションを片付けた要求も、aborted として記録する）
- [ ] 状態遷移: ターン中（`submit` の前）にセッションを片付けると、`Claude Code ended` ではなく `aborted`・`Claude Code TUI session was closed` になる（Pi の signal が生きたままターン中にセッションを片付けた要求も、「Claude Code ended」ではなく aborted として記録する）
- [ ] 反例: 中断でない失敗（`PI_CLAUDE_CODE_COMMAND=/nonexistent/claude`）は `error`・`not installed` のままである（反例: 中断でない失敗（Claude Code が見つからない）は error のまま記録する）
- [ ] 同時実行: 既存の `反例: ready 待機中のセッション破棄は、その要求の送信と登録を止める` と `反例: セッション破棄は、キャッシュ外の並行 worker も中断して清掃する` が変更せずに合格する（並行する2要求がどちらも拒否され、上流への要求は増えない）

## 反例の Red の確かめ方（本体を書き換えて落ちることを確かめ、必ず元に戻す）

| 書き換え（`src-changes.diff` を当てたあと） | 落ちるテスト（確認済み） |
| --- | --- |
| `pty-session.ts` の `responseComplete?.() === true && promptAfterBusy(plain)` を `responseComplete?.() === true && /❯[ \u00a0]/.test(plain)` にする（応答中の表示を見ない） | 反例: 応答中（スピナーの描き直し中）の画面は… |
| 同じ箇所を `promptAfterBusy(plain)` にする（受信完了を見ない） | 反例: 応答中の表示の後ろに入力欄が…、反例: 終了行が無く受信も終わっていなければ…、反例: responseComplete を渡さない呼び出しは… |
| `tui-process.ts` の `() => this.relay.capture.complete` を `() => true` にする | 反例: message_stop が届かない応答は…（`Incomplete` で終わる） |
| `provider.ts` の `resolve` に `signal.throwIfAborted()` を戻す | Pi が中断済みの signal で要求を始めても… |
| `tui-lifecycle.ts` の catch から `if (controller.signal.aborted) throw controller.signal.reason;` を消す | …ターン中にセッションを片付けた… |
| `stream.ts` の `|| isAbortError(error)` を消す | …起動中にセッションを片付けた… |

## 該当なしの観点

- 権限: 本変更は認証・認可を扱わない。`resolve` が返す認証情報（`apiKey: "external-process"`）は変えない。
- 4xx でデータが変わらないこと: 本変更は永続化するデータを持たない。上流の 4xx は `capture.complete` が偽のままなので補助判定は働かず、既存の `途中で切れた SSE や HTTP 400 は成功結果にせずエラーにする` が変更せずに合格することで確かめる。
- トランザクション: 該当なし。

## 静的確認

- [ ] `grep -n "throwIfAborted" src/provider.ts` が何も出さない
- [ ] `grep -n "promptAfterBusy" src/pty-session.ts` が import と `waitIdle` の2か所だけを出す
- [ ] `grep -n "capture.complete" src/tui-process.ts` が `assertCompleteCapture` と `waitIdle` の呼び出しの2か所を出す

## 全体確認

- [ ] `npm test` が全件（171件）合格する
- [ ] `npm run check` が合格する
- [ ] `docs/turn-completion.md` を design.md の「ドキュメント」の内容に更新した
