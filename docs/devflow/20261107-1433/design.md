# 設計: effort の変更で対話 TUI のプロセスを作り直さない

## 結論

`src/tui-process.ts` の指紋（`fingerprint`）から `output_config` と `context_management` の**値**を外し、**キーの有無**だけを残す。2つの値は、relay の `transformRequest` で `replaceTranscript` の後に呼ぶ新しい関数 `applyTurnBody`（新規 `src/turn-body.ts`）が、ターンごとに本文の最上位へキー単位で書く。これにより effort だけを変えたターンは同じ Claude Code を使い回し、2〜7秒の起動を省く。`thinking` と `max_tokens` は今と同じく起動時の settings.json と指紋に残す。

依頼との違いが1点ある。依頼は2つのキーを「起動時の設定から外す」としているが、本設計では**起動時の settings.json（`CLAUDE_CODE_EXTRA_BODY`）には起動したターンの値をそのまま残す**。外すと Claude Code が上流へ送る `anthropic-beta` が変わり、受け入れ条件「anthropic-beta ヘッダの集合が変更前と一致すること」を満たせないためである（根拠は「Claude Code 2.1.317 の扱い」）。指紋から値を外すことは依頼どおりであり、作り直しを省く効果は変わらない。

確定差分は `examples/src-changes.diff`（本体）と `examples/tests-changes.diff`（テストと偽 claude）である。一時コピーのリポジトリで両方を当て、`npm test` 199件合格・`npm run check` 合格を確認済みである。実機の検証スクリプトのお手本は `examples/verify-turn-body.mts` であり、実装担当はこれを `scripts/verify-turn-body.mts` に置く。

## 目的

Pi の claude/auto が続きのターンで effort を変えたとき（続きのターンの約19%）に、Claude Code の対話 TUI を起動し直さない。上流（Anthropic API）へ送る本文の `thinking`・`output_config`・`context_management`・`max_tokens`・`model` と `anthropic-beta` ヘッダは変更前と同じに保ち、プロンプトキャッシュの読み取り量を減らさない。

## 範囲

| 対象 | 変更 |
| --- | --- |
| `src/turn-body.ts`（新規） | 定数 `TURN_BODY_KEYS`、型 `TurnBodyKey`・`TurnBody`・`LaunchIdentity`、関数 `turnBodyOf`・`launchIdentity`・`applyTurnBody` |
| `src/tui-process.ts` | `fingerprint` が `launchIdentity` を使う。`TuiWorker.run` の `transformRequest` が `replaceTranscript` の結果に `applyTurnBody` をかける。settings.json を書く箇所に「なぜ」のコメント2行を足す（書く中身は変えない） |
| `tests/turn-body.test.ts`（新規） | `src/turn-body.ts` の単体テスト13件 |
| `tests/tui-process.test.ts` | 実プロセス（偽 claude）を通すテスト9件を末尾に足す。既存のテストは変えない |
| `tests/fixtures/fake-claude.mjs` | 本物と同じく `CLAUDE_CODE_EXTRA_BODY` を本文へ浅く混ぜる。環境変数 `FAKE_SETTINGS_LOG` と `FAKE_DROP_BODY_KEYS` を足す |
| `scripts/verify-turn-body.mts`（新規） | 実機の検証スクリプト。`examples/verify-turn-body.mts` をそのまま置く |
| `docs/devflow/20261107-1433/implementation-notes.md`（新規） | 実装担当が実機の判定結果を書く |

範囲外: `claude -p` の経路（`src/claude-cli.ts` の `runClaudeRequest`。こちらの settings.json と指紋は変えない）、`src/tool-config.ts` の `buildExtraBody`、`src/turn-relay.ts`、`src/tui-transcript.ts`、README（記述「Compatible processes are reused」は変更後も正しい）。thinking のオン・オフの切り替えで作り直すことは変わらず、依頼どおり許容する。

## Claude Code 2.1.317 の扱い（静的読解。実機での確定は受け入れ条件3）

`~/.local/share/claude/versions/2.1.317` の同梱 JavaScript を読んだ結果である。動かして確かめた事実ではないため「推論」として扱い、受け入れ条件3の実機比較で確定させる。

1. Claude Code は `CLAUDE_CODE_EXTRA_BODY` を本文の組み立てのたびに環境変数から読み、`output_config` 以外のキーを本文の最上位へ浅く混ぜる（`...Jd`）。`context_management` と `thinking` は Claude Code 自身の値を丸ごと上書きする。
2. `output_config` は別扱いである。Claude Code は `CLAUDE_CODE_EXTRA_BODY` の `output_config` を土台にし、その中に `effort` が**無いときだけ**、自分の effort を入れて `anthropic-beta` に `effort-2025-11-24` を足す（関数 `det`）。`effort` が有れば何も足さない。モデルが effort に対応しなければ `effort` を消し、中身が空になれば `output_config` を本文に入れない。
3. したがって `CLAUDE_CODE_EXTRA_BODY` から `output_config` を外すと、thinking オンのターンで `anthropic-beta` に `effort-2025-11-24` が加わり、ヘッダの集合が変更前と変わる。20261107-1309 の実機検証（`thinking`・`output_config`・`context_management` の3つを起動時の設定から外した実装）では、`effort-2025-11-24` と `thinking-display-updates-2026-08-18` が付き `redact-thinking-2026-02-12` が消えた（実測）。このうち `effort-2025-11-24` は `output_config` を外したことによると推論する（残りの2つは `thinking` によるもので、本設計では `thinking` を起動時に残す）。同じ実測で、Claude Code は thinking オンのターンに自分で `context_management: {"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}` を、thinking オフのターンに `output_config: {"effort":"medium"}` を入れた。本設計ではこれらのターンにそのキーのターンの値が無いため、変更前と同じく Claude Code の値がそのまま上流へ届く。
4. Claude Code は起動後に `process.env` を書き換えないため、起動時の settings.json の値は同じプロセスの間ずっと使われる。

この読解から、起動時の settings.json には起動したターンの値を残し、2つ目以降のターンの値は relay が本文で差し替える。値はターンごとに違っても、キーの有無が同じなら Claude Code が付けるヘッダと本文の形は変わらない。

## 変更前と変更後

| 項目 | 変更前 | 変更後 |
| --- | --- | --- |
| 指紋の材料の `extraBody` | `input.extraBody` そのもの | `input.extraBody` から `output_config` と `context_management` を除いたもの |
| 指紋の材料の `turnBodyKeys` | 無い | `input.extraBody` に値（`undefined` 以外）がある2つのキーの名前の配列。順序は `TURN_BODY_KEYS` の順 |
| 起動時の settings.json | `{ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(input.extraBody) } }` | 同じ（起動したターンの値を残す） |
| relay の `transformRequest` | `replaceTranscript(...)` | `applyTurnBody(replaceTranscript(...), turnBodyOf(input.extraBody))` |
| effort だけを変えたターン | 作り直す（2〜7秒） | 使い回す。本文の `output_config` はそのターンの値 |
| thinking のオン・オフを変えたターン | 作り直す | 作り直す（変わらない） |
| `max_tokens`・model・systemPrompt・ツール・cwd・環境変数・timeoutMs・upstreamUrl を変えたターン | 作り直す | 作り直す（変わらない） |
| `output_config` か `context_management` の有無だけが変わったターン | 作り直す | 作り直す（キーの有無は指紋に残すため） |

Pi の `buildExtraBody` の出力では、reasoning ありなら `output_config` だけがあり、なしなら `context_management` だけがある。キーの有無は `thinking` の有無と連動するため、通常の使い方で「有無だけが変わる」ことは thinking の切り替えと同時に起きる。指紋にキーの有無を残すのは、Claude Code の付けるヘッダが有無で変わる（上の2）ためである。

## 業務ルール

1. ターンごとに本文へ書くキーは `output_config` と `context_management` の2つだけとする（`TURN_BODY_KEYS`）。`thinking`・`max_tokens`・`tools` ほかのキーは書かない。
2. `extraBody` のキーの値が `undefined` なら、そのキーは無いものとして扱う（`JSON.stringify` で settings.json に出ないため）。
3. relay は、Claude Code が送った本文の最上位に**そのキーがあるときだけ**、値をターンの値で丸ごと置き換える。中身は混ぜない（Claude Code が `output_config` に `effort` 以外のキーを入れていても残さない）。本文にそのキーが無ければ足さない。Claude Code がキーを落とすのは起動時の settings に同じキーがあってもそうする場合（上の2のモデルが effort に対応しないときなど）であり、変更前も上流へ送っていなかったためである。
4. `TURN_BODY_KEYS` 以外のキー、`messages`（`replaceTranscript` の結果）、HTTP ヘッダには触らない。
5. ターンの値は `TuiWorker.run` の呼び出しごとに `input.extraBody` から取り直し、前のターンの値を持ち越さない。worker にも relay にも保存しない。

## 設定

追加の設定値・環境変数は無い。偽 claude の環境変数 `FAKE_SETTINGS_LOG` と `FAKE_DROP_BODY_KEYS` はテスト専用である。

## エラー

| 場面 | 扱い |
| --- | --- |
| Claude Code の本文が JSON として壊れている | `applyTurnBody` が `SyntaxError` を投げる。ただし `replaceTranscript` が先に同じ本文を解析して投げるため、実際に届くのは `replaceTranscript` の例外である |
| 本文が JSON のオブジェクトでない（配列・null・数） | `applyTurnBody` が `Error("Claude Code request body must be a JSON object")` を投げる |
| 上記の例外 | 新しい変換はしない。`TurnRelay.handle` の既存の `catch` が `relayFailure("request", error)` として記録し、TUI へ 502 を返す。ターンは既存の `incompleteUpstreamMessage` のエラーで失敗し、worker は既存の `runTrackedRequest` の `catch` で破棄される |
| 上流の 4xx | 変更前と同じ。ターンの値は保存していないため、次のターンは自分の `extraBody` の値で送る |

## 受け入れ条件

1. `npm test` が全件合格する（確定差分を当てた状態で199件。変更前は177件）。`npm run check` が合格する。
2. test-list.md の項目がすべて満たされる。
3. 実機で次の手順を1回ずつ実行し、`compare` の出力がすべて `PASS` である（最後の行が `summary: 30 passed, 0 failed`）。実機への要求は1回の `run` で4回、合計8回である。`run` が通信の失敗で途中で止まったときだけ、その側の `run` を1回やり直してよい（合計12回以内）。
   ```sh
   # 実装に着手する前（本体を変える前）の HEAD を変更前として固定する
   git worktree add --detach /tmp/verify-before HEAD
   ln -s "$PWD/node_modules" /tmp/verify-before/node_modules
   cp docs/devflow/20261107-1433/examples/verify-turn-body.mts scripts/verify-turn-body.mts
   node --experimental-transform-types scripts/verify-turn-body.mts run /tmp/verify-before /tmp/verify-before.jsonl claude-sonnet-5-5
   # 実装して npm test が全件合格した後
   node --experimental-transform-types scripts/verify-turn-body.mts run . /tmp/verify-after.jsonl claude-sonnet-5-5
   node --experimental-transform-types scripts/verify-turn-body.mts compare /tmp/verify-before.jsonl /tmp/verify-after.jsonl
   git worktree remove --force /tmp/verify-before
   ```
   判定の内訳は次のとおりである（4ターンは effort high → low → medium → thinking オフ。`compare` が自動で判定する）。
   - ターン2と3で、変更後の claude の `--settings` のパスが前のターンと同じ（作り直しが起きない）
   - 全ターンで、上流の本文の `thinking`・`output_config`・`context_management`・`max_tokens`・`model` が変更前と一致する
   - 全ターンで、`anthropic-beta` ヘッダの集合が変更前と一致する
   - 全ターンで、変更後の `cache_read_input_tokens` が変更前以上である
   - 全ターンで、変更前・変更後とも要求が成功している
4. `run` 2回の出力（各4行の JSON）と `compare` の出力全文を `docs/devflow/20261107-1433/implementation-notes.md` に貼る。`FAIL` が1行でもあれば、その行と「実機の判定に不合格がある」ことを同じファイルに書く。審査（reviewer）はこれを【必須】で差し戻す。不合格のときに設計を変えて直すこと（例: settings.json から2つのキーを外す、`anthropic-beta` を relay で書き換える）は実装担当の判断で行わない。
5. 実機の検証は `claude-sonnet-5-5` で行う。`claude-opus-5-5` と `claude-fable-5-1` は使わない（thinking オフの形をどれも 400 で拒否するため。devflow 20261107-1406）。スクリプトはこの2つを指定すると例外で止まる。

## 未決事項

1. **実機の判定が不合格だった場合の方針**: 「Claude Code 2.1.317 の扱い」は静的読解による推論である。実機で `anthropic-beta` や本文が一致しなかった場合の直し方（例: Claude Code の版による違いの吸収、ヘッダの書き換え）は依頼に無く、渡部さんが決める。
2. **依頼との違い（settings.json に値を残す）**: 依頼の文面は2つのキーを起動時の設定から外すことを求めている。本設計は受け入れ条件のヘッダ一致を優先して値を残した。文面どおりに外す案を試す場合は、受け入れ条件3の `anthropic-beta` の判定が不合格になると推論する。採否は渡部さんが決める。
3. **Claude Code の版が変わった場合**: Claude Code が `CLAUDE_CODE_EXTRA_BODY` をターンごとに読み直さなくなる、または `output_config` の扱いを変えると、上の推論が崩れる。版ごとの再検証は本設計の範囲外とする。
4. **Backlog Wiki の同期**: このリポジトリには `docs/sync_backlog_wiki.js` が無い。同期は行わない。

## メタ情報

- 依頼の根拠: devflow 20261107-1309 の案A（実機検証で thinking を外すと anthropic-beta が変わることを確認）、devflow 20261107-1406（opus-5-5・fable-5-1 の thinking オフの 400）
- 20261107-1309 の中断した実装と実機の結果は `git stash` の `stash@{0}`（「devflow 20261107-1309: 実機検証で J1・J3 不合格のため中断した実装」）にある。本設計はそこから実測値だけを引用し、コードは引き継がない。実装担当はこの stash を pop・drop しない
- 設計時の実機要求: 0回（Claude Code 2.1.317 の同梱コードの静的読解と、偽 claude を使ったテストだけで設計した）
- 設計時の確認: 一時コピー（`git worktree`）で確定差分を当て、`npm test` 199件合格、`npm run check` 合格、本リポジトリで `git apply --check` 合格。`verify-turn-body.mts` は `compare` を合成データで動かし、`tsc --noEmit` で型を確認した
