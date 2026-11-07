# 実装メモ

## 手順と結果

お手本の diff の順序に従った。

1. `examples/fake-claude.diff` を適用し、`npm test` が 151 件合格することを確認した（偽 claude の既定の挙動は変わらない）。
2. `examples/tests-changes.diff` を適用し、`promptAfterBusy`・`promptFallbackReached`・`waitIdle` の第3引数だけを仮実装（常に false を返す）にして4ファイルを実行し、想定どおり 11 件だけが失敗することを確認した（AssertionError 7件、時間切れ 4件、残り51件は合格）。
3. `examples/src-changes.diff` の内容を promptAfterBusy → promptFallbackReached → waitIdle → tui-process → provider → tui-lifecycle → stream の順に入れ、各段階で対象テストが Green になることを確認した。
4. 反例の Red の確かめ方の6つの書き換えを1つずつ実施し、表のテストが落ちることを確認して元に戻した。
5. `npm test` が 171 件合格し、`npm run check` が合格することを確認した。

## お手本からの差分

- `tests/stream-abort.test.ts` の変数 `env` が fast-guard の省略識別子の指摘を受けたため、`environment` に改名した（2か所）。テストの内容は変えていない。

## 補足

- `docs/turn-completion.md` の「確認結果」節は、当初は設計の指示（既存の内容を残す）に従って旧テスト件数の記述をそのまま残した。レビュー指摘1を受けて、最新の実行結果に更新した。
- 設計の未決事項（終了行が画面に残らなかった原因、3000ms の実機実測）は本依頼では調査していない。

## レビュー指摘への対応（2026-11-07）

- 指摘1: `docs/turn-completion.md` の「確認結果」を「`npm test` は171件合格、`npm run check` は合格」「独立 reviewer の承認は、この変更の PR で確認する」に更新した。旧テスト件数 120 と「承認済み」の記述を削除した。
- 指摘2: `design.md` の受け入れ条件8と `test-list.md` の該当項目は「既存のテストを変更せずに合格する」としているが、`tests/tui-process.test.ts` の既存テストは経過時間の計測を `Date.now()` から `performance.now()` に変えている。設計の文書は tdd-gate が書き換えを止めるため、代わりにここで読み替えを明示する。既存テストの期待値と意味は変えておらず、計測方法だけを変更した。WSL2 のシステムクロックの巻き戻りで `Date.now()` の差が負に振れ、テストが誤って失敗したためである。
- 指摘1・2の再現確認: 一時テスト `tests/review-docs-repro.test.ts` で、`docs/turn-completion.md` の旧テスト件数と、`implementation-notes.md` の読み替えの記述を検査した。修正前に失敗することを確認した。文書の記述を検査する恒久テストは、文書を更新するたびに壊れるためリポジトリに残していない。

## 未対応の参考指摘（reviewer）

- `tests/tui-screen.test.ts` の追加部分の先頭に、作業指示のコメント（「末尾に追加する部分。先頭の import に…」）が残っている。お手本 `tests-changes.diff` の内容であり、設計どおりコピーしたため今回は残した。
- `src/stream.ts` は 445 行で 300 行の上限を超えている。今回の差分で生じたものではなく、分割は設計の対象外。
- 実機で受信完了後もヒント行の `esc to interrupt` が残り続ける差分描画が起きると、補助判定は働かず従来どおり時間切れになる（推測）。再発時の観測記録が望ましい。
- `src/tui-screen.ts` の `PROMPT_ALL` は g 付きのモジュールレベル正規表現である。現状は `matchAll` だけで安全だが、将来 `.test`/`.exec` を呼ぶと `lastIndex` が残り、`promptAfterBusy` が誤判定する。
- `src/pty-session.ts` の `poll` は done を締め切り判定より先に評価する。締め切り直後に保持条件が成立すると、設計ルール4より最大 `promptFallbackMs` 遅れて成功する。
- ツール実行中にヒント行の `esc to interrupt` が消える画面では補助判定が誤爆しうる（推測、実機未確認）。tool_use 応答と `FAKE_TURN_LINE=0` の組み合わせテストは無い。
- `promptFallbackReached` の `now=0` ケースと `isAbortError` の非 Error 値のテストが無い。
- `docs/turn-completion.md` の mermaid は「50ms 待つ→締め切り判定」の順で、実装（done 判定→締め切り→待つ）と逆である。

## 検証失敗への対応（2026-11-07）

- `npm test` で `上流が少しずつ返し続ける長いターンは、ターン全体が timeoutMs を超えても時間切れにしない` が 1 件だけ失敗した。`assert.ok(Date.now() - startedAt > 1_500)` が偽になり、ターンの所要時間が `timeoutMs` 以下と判定された。
- 再現しなかった。単独 1 回、3 並行 × 3 回、8 並行 × 8 回の計 12 回はすべて合格した。計測した所要時間は 2938〜2999ms で、上流の 6 イベント（400ms 間隔）に対して十分な長さだった。`waitIdle` は上流の終了後に描かれる終了行（`turnFinished`）まで待つため、実装の経路で 1500ms 未満に終わることはない。
- 原因は WSL2 のシステムクロックの巻き戻りと判断した。`dmesg` に `systemd-journald: Time jumped backwards, rotating.` と `hv_utils: TimeSync` が繰り返し記録されており、`Date.now()` を読む経過時間の判定が負に振れうる。
- 時計の巻き戻りはテストから制御できないため、指摘を再現するテストは書けなかった。代わりに、経過時間の計測を単調時計 `performance.now()` に変えた。テストの期待値と意味は変えていない。
- 実装側の `TuiSession.poll` の締め切りと `TurnRelay.lastActivityAt` も `Date.now()` を使っている。時計が巻き戻ると締め切りが過去になり、時間切れが早まる可能性がある。今回の差分ではないため変更していない（参考）。
