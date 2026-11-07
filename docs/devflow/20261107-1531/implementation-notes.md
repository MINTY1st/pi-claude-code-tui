# 実装ノート: TUI の worker キャッシュの追い出し、開発依存の 1.5.0 化、コメント修正

## 結果

設計とお手本のとおりに実装した。`npm test` は 210件すべて合格し、`npm run check` も合格した。テストと検証はすべて成功し、コミットはしていない。

| 検証 | 結果 |
| --- | --- |
| 変更前の `npm test` | 199件合格 |
| 開発依存の Red（`tests/package-metadata.test.ts`） | 6件中1件失敗（actual `'^0.87.0'`、expected `'^1.5.0'`） |
| キャッシュの Red（`tests/tui-process.test.ts`、仮実装） | 39件中7件失敗（設計の表と同じ7件） |
| キャッシュの Green（`oldestIdleSession` のみ） | 単体4件合格 |
| キャッシュの Green（`makeRoom` と `acquire`） | 39件すべて合格 |
| 最終 `npm test` | 210件合格 |
| 最終 `npm run check` | 合格 |
| `node_modules` の pi-ai・pi-coding-agent | どちらも `1.5.0` |

## お手本からの逸脱

1件だけある。`tests/tui-process.test.ts` の `holdSubmits` の第2引数名を、お手本の `n` から `holdCount` に変えた。ハーネスの fast-guard（`abbreviated-identifier`）が `n` を省略形として差し戻したためである。挙動はお手本と同じで、貼り付け（`continue`）を指定回数目まで止める。コメントも `holdCount 回目まで止める` に合わせた。

## 反例の Red の確認

`test-list.md` の表の3つの書き換えを1つずつ試し、確認後に元へ戻した。

| 書き換え | 実行結果 |
| --- | --- |
| `<` を `<=` にする | 「境界値: oldestIdleSession は最後に使った時刻が同じなら先に入ったセッションを選ぶ」が失敗 |
| `!worker.busy &&` を消す | 対象6件のうち4件（oldestIdleSession の2件と反例2件）が失敗 |
| `makeRoom` と `close` を `TuiWorker.create` の前に移す | 「同時実行: 新しいセッション2つが並んで起動しても…」が失敗（actual 5、expected 4） |

## 差分の範囲

`git diff --stat` は7ファイルだけである。`src/claude-cli.ts` の差分は JSDoc の4行（2行削除、4行追加）に限られ、コードは変わっていない。

## 未対応の参考指摘

独立 reviewer の審査は【APPROVE】で、【必須】の指摘は無かった。そのターンで実装しなかった「参考」の指摘を次に残す。

- 追い出した worker の `close` が終わるまで、新しいセッションの最初のターンは始まらない。設計どおり「後で待つ」の範囲内であり、PTY の終了が遅いと最初のターンがその分だけ遅れる（reviewer の推測）。
- `makeRoom` の `while` は、上限が2のままなら実際には1回しか回らない。将来 `MAX_CACHED` を変えたときも正しく動く書き方であり、変更不要と判断した。

