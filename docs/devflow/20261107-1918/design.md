# 設計: Claude Code の設定 showThinkingSummaries を true にして、思考の本文が空になる不具合を直す

## 結論

pi-claude-code-tui が Claude Code に `--settings` で渡す settings.json に `showThinkingSummaries: true` を足す。settings.json の文字列は `src/claude-cli.ts` に新しく置く純粋関数 `claudeSettingsJson(extraBody)` の1か所で作り、TUI 経路（`src/tui-process.ts` の `TuiWorker.create`）と -p 経路（`src/claude-cli.ts` の `ClaudeProcess.create`）の両方がそれを使う。`CLAUDE_CODE_EXTRA_BODY` の中身、worker の指紋、`buildExtraBody` は変えない。

本体を変える前に、本物の claude（claude-opus-5-5）で変更前の記録を取り、変更後と比べる。原因の推論が外れていたら（「受け入れ条件」の実機の (1) か (2) が成り立たなければ）、本体の変更を進めずに `implementation-notes.md` に実測の結果を書いて止める。

## 目的

Pi の画面で思考（電球マーク）の中身が空になる不具合を直す。2026-11-07 の実測では、PR #17（`thinking: { type: "adaptive", display: "summarized" }` を本文に入れる変更）を含むコード（`pi-claude-code-tui-live`、`aeebf0d`）で Opus 5.5 の応答を受けても、Pi のセッションに残る thinking ブロックは本文の長さが 0 で、署名だけが入っていた。再起動しても同じだった。

## 原因の推論

以下は Claude Code 2.1.317 の実行ファイル（`~/.local/share/claude/versions/2.1.317`）の静的読解であり、実機では確かめていない。

1. Claude Code は anthropic-beta の候補表に `{beta: "redact-thinking-2026-02-12", when: (e) => e.firstPartyOnlyBetas && e.interleavedThinking && !he() && !bOn()}` を持つ。
2. `bOn()` は `ft().showThinkingSummaries ?? false` を返す。つまり設定 `showThinkingSummaries` が未設定か false なら、Claude Code は自分で `redact-thinking-2026-02-12` を付ける。
3. このベータが付くと、API は本文の `thinking.display: "summarized"` より優先して思考の本文を伏せ、署名だけを返す。Pi が受け取る thinking ブロックの本文が空になるのはこのためである。
4. `showThinkingSummaries` は Claude Code の settings のスキーマにある項目である（説明文: "Request API-side thinking summaries and show them in the conversation and in the transcript view (ctrl+o)"）。`--settings` のファイルに書けば `ft()` から読まれる。今の settings.json は `env` しか持たない。

裏づけとなる実測は1つある。devflow 20261107-1309 の実機検証で、thinking を `CLAUDE_CODE_EXTRA_BODY` から外すと `redact-thinking-2026-02-12` が消え、`thinking-display-updates-2026-08-18` が付いた（thinking を外すと `interleavedThinking` の条件が変わるため、という読みと矛盾しない）。

対話モードでは、`showThinkingSummaries: true` にすると Claude Code 自身の thinking の既定（`ips()`）も `display: "summarized"` になる。ただし Pi の `CLAUDE_CODE_EXTRA_BODY` が本文の `thinking` を上書きするため、上流へ送る `thinking` は変わらないと読める。これは実機の (3) で確かめる。

## 範囲

| 対象 | 変更 |
| --- | --- |
| `src/claude-cli.ts` | 公開関数 `claudeSettingsJson` を足す。`ClaudeProcess.create` の settings.json を書く1行をこの関数に置き換える |
| `src/tui-process.ts` | import に `claudeSettingsJson` を足す。`TuiWorker.create` の settings.json を書く1行をこの関数に置き換える |
| `tests/claude-cli.test.ts` | 3件足す。既存の「runs a request through a stream-json Claude executable」の偽 claude と最初の `runClaudeRequest` に settings の記録を足す |
| `tests/tui-process.test.ts` | 1件足す |
| `tests/fixtures/fake-claude.mjs` | 環境変数 `FAKE_SETTINGS_DOC_LOG`（起動時に読んだ settings.json 全体を1行ずつ書き出す）を足す |
| `scripts/verify-thinking-summaries.mts` | 新規。実機の検証スクリプト。`examples/verify-thinking-summaries.mts` をそのまま複写する |
| `docs/devflow/20261107-1918/implementation-notes.md` | 新規。実装担当が実機の結果を書く |

範囲外: `src/tool-config.ts` の `buildExtraBody`（`display: "summarized"` は残す）、`src/turn-body.ts`、TUI の `fingerprint` と -p 経路の指紋、`TURN_BODY_KEYS`、`tuiArgs` と -p 経路の起動引数、`src/stream.ts` の thinking の変換、README（thinking・settings の記述が無い）、`docs/cross-provider-replay.md`・`docs/turn-completion.md`。

## 変更前と変更後

### settings.json の中身

`extraBody` が `{ tools: [], thinking: { type: "adaptive", display: "summarized" }, output_config: { effort: "high" } }` のとき:

| 経路 | 変更前 | 変更後 |
| --- | --- | --- |
| TUI（`TuiWorker.create`） | `{"env":{"CLAUDE_CODE_EXTRA_BODY":"{\"tools\":[],...}"}}` | `{"env":{"CLAUDE_CODE_EXTRA_BODY":"{\"tools\":[],...}"},"showThinkingSummaries":true}` |
| -p（`ClaudeProcess.create`） | 同上 | 同上 |

- `CLAUDE_CODE_EXTRA_BODY` の値は、変更前と同じく `JSON.stringify(extraBody)` の文字列であり、1文字も変わらない。
- `showThinkingSummaries` は thinking のオン・オフ、モデル、effort によらず常に `true` である。
- キーの順は `env`、`showThinkingSummaries` の順にする（`JSON.stringify` の出力が決まるため、テストで文字列一致を確かめる）。

### 上流へ送るもの（推論。実機で確かめる）

| 項目 | 変更前 | 変更後 |
| --- | --- | --- |
| anthropic-beta の `redact-thinking-2026-02-12` | 付く（実測） | 付かない |
| anthropic-beta のほかの値 | — | 変わらない（参考として記録する。合否には使わない） |
| 本文の `thinking`・`output_config`・`context_management`・`max_tokens`・`model` | — | 変わらない |
| 応答の thinking ブロックの本文 | 長さ 0、署名あり（実測） | 長さ 1 以上 |

### worker の作り直し

変わらない。`showThinkingSummaries` は定数であり、指紋の材料（`extraBody` など）は変えないため、作り直しの回数は増えも減りもしない。既存の「effort だけを変えた次のターンは Claude Code を作り直さず…」「thinking のオン・オフを切り替えたターンは Claude Code を作り直す」がそのまま合格することで確かめる。

なお、変更を入れた版へ更新した直後の Pi では、更新前に起動した worker は Pi の再起動で消える。指紋に設定の版を入れる必要は無い。

## 業務ルール

1. Pi が起動する Claude Code には、経路（TUI・-p）によらず必ず `showThinkingSummaries: true` を渡す。
2. `showThinkingSummaries` を環境変数や Pi の設定で切り替えられるようにはしない（依頼に無い）。
3. `CLAUDE_CODE_EXTRA_BODY` には `extraBody` を `JSON.stringify` した文字列をそのまま入れる。`claudeSettingsJson` は `extraBody` を書き換えない。

## 設定

新しい環境変数は無い。Claude Code に渡す settings.json に `showThinkingSummaries: true` が増えるだけである。`--setting-sources ""` のままでも `--settings` のファイルは読まれる（今の `env` が効いているため。実測済み）。

## エラー

新しいエラーは無い。`claudeSettingsJson` は `JSON.stringify` だけを行い、例外を投げる経路は今の `writeFile` の行と同じである（`extraBody` に循環参照があれば `TypeError`。今と同じく呼び出し元へそのまま伝わる）。

## 実機の検証

### 手順

本物の claude（2.1.317）に、変更前3回・変更後3回の合計6回の要求を送る。やり直しは「やり直し」の規則の範囲（合計8回以内）に限る。

1. 本体を変える前に、変更前のコードの作業木を作る。`git worktree add --detach /tmp/verify-1918-before HEAD` の後、`ln -s /home/minty/pi-claude-code-tui/node_modules /tmp/verify-1918-before/node_modules` を実行する（作業木から `src/` を import したときに依存を解決するため）。
2. `scripts/verify-thinking-summaries.mts` を本リポジトリに複写する（`examples/verify-thinking-summaries.mts` と同じ内容）。スクリプトは `src/` を引数のリポジトリから読むため、本リポジトリに置いたまま変更前の作業木を指せる。
3. 変更前: `node --experimental-transform-types scripts/verify-thinking-summaries.mts run /tmp/verify-1918-before /tmp/verify-1918-before.jsonl 3`
4. 本体を変更し、単体テストを全件合格させる。
5. 変更後: `node --experimental-transform-types scripts/verify-thinking-summaries.mts run /home/minty/pi-claude-code-tui /tmp/verify-1918-after.jsonl 3`
6. 比較: `node --experimental-transform-types scripts/verify-thinking-summaries.mts compare /tmp/verify-1918-before.jsonl /tmp/verify-1918-after.jsonl`
7. 作業木を消す: `git worktree remove --force /tmp/verify-1918-before`

### 1回の要求の中身

- モデルは `claude-opus-5-5`、`extraBody` は `buildExtraBody("claude-opus-5-5", [], { reasoning: "high" })`。
- 会話は user の1発言だけ: `What is 37 * 43 - 29 * 31? Think it through, then reply with only the final number.`（adaptive thinking が思考を省きにくい計算の問題にする）。
- 1回ごとに別のセッション ID（`verify-thinking-summaries-1` など）で `runTuiRequest` を呼び、終わるたびに `closeTuiProcesses()` で Claude Code を閉じる。1回の要求で上流への要求は1回である。
- スクリプトは relay と api.anthropic.com の間に記録用の中継を挟み、送った anthropic-beta と本文の5つのキーを記録する（`scripts/verify-turn-body.mts` と同じ方式）。

### 判定（`compare` が出す）

| 番号 | 判定 | 合格の条件 |
| --- | --- | --- |
| (1) | 推論の検証 | 変更後のすべての記録で、anthropic-beta に `redact-thinking-2026-02-12` が無い |
| (2) | 推論の検証 | 変更後の記録のうち thinking ブロックを持つものが1件以上あり、変更後のすべての thinking ブロックの本文の長さが 1 以上である |
| (3) | 回帰 | 同じ番号の記録どうしで、本文の `thinking`・`output_config`・`context_management`・`max_tokens`・`model` が一致する |
| (4) | 回帰 | 同じ番号の記録どうしで、変更後の `cache_read_input_tokens` が変更前以上である |
| (前提) | 記録の完全さ | 両方の記録がすべて `ok` で、組にできる記録が2件以上ある |

参考として（合否に数えない）、変更前の thinking ブロックの形と、anthropic-beta の増減（変更後にだけあるもの・変更前にだけあるもの）を `INFO` の行で出す。

`compare` は最後に `hypothesis: confirmed` か `hypothesis: rejected` を出す。(1) と (2) がともに合格なら confirmed、どちらかが不合格なら rejected である。

### 推論が外れたとき（hypothesis: rejected）

本体の変更を進めない。具体的には、手順4で入れた本体の変更（`src/` の差分）とテストの差分を `git checkout -- src tests` で戻し、検証スクリプトだけを残す。`implementation-notes.md` に次を書いて止める。審査（reviewer）はこれを【必須】で差し戻す。

- 変更前・変更後の各記録の anthropic-beta（`betas`）と本文の5つのキー（`sent`）
- 各記録の thinking ブロックの形（`thinking` の各要素の `length` と `signatureLength`、`redacted` の件数、`blockTypes`）
- `compare` の出力全文

### やり直し

- 記録に `ok: false` があれば（通信の失敗、時間切れなど）、その側だけを count 2 で1回だけやり直してよい（3 + 3 + 2 = 8回）。出力ファイルは上書きされる。やり直した場合は `implementation-notes.md` にその理由と失敗した記録を書く。
- 変更後の3件すべてに thinking ブロックが無かった場合（モデルが思考を省いた場合）も、変更後だけを count 2 で1回だけやり直してよい。
- それ以上はやり直さない。合計8回を超えない。

## 受け入れ条件

1. `npm test` が 214件すべて合格する（変更前 210件 + 4件）。
2. `npm run check`（`tsc --noEmit`）が合格する。
3. `test-list.md` の Red の手順で、仮実装のときに4件が AssertionError で落ちる。
4. 実機の `compare` が `hypothesis: confirmed` と `summary: N passed, 0 failed` を出す。実要求は合計8回以内である。
5. `implementation-notes.md` に、変更前・変更後の記録（jsonl の各行）と `compare` の出力全文がある。
6. `git diff` が「範囲」の表のファイルだけを含む。`src/` の差分は、`claudeSettingsJson` の追加と settings.json を書く2行の置き換え、`src/tui-process.ts` の import の1行だけである。
7. 足す関数は 50行以内であり、`src/claude-cli.ts` と `src/tui-process.ts` の行数は変更前（1140行・280行）から数行しか増えない。

## 実装上の注意

- この環境は `NODE_ENV=production` である。依存を入れ直すときは `npm ci --include=dev` を使う（設計時点の `node_modules` で `npm test` 210件合格を確認済み）。
- AGENTS.md の `node docs/sync_backlog_wiki.js` は、このリポジトリに `docs/sync_backlog_wiki.js` が無いため実行しない。
- `/tmp/dev1531`・`/tmp/dv1655`・`/tmp/wt-1655`・`/tmp/wt-move`・`/tmp/wt1406`・`/tmp/wt1655` に、設計前から作業木が残っている。使わず、消さない。変更前の作業木は `/tmp/verify-1918-before` に新しく作る。
- `/home/minty/pi-claude-code-tui-live` は利用者が普段使う Pi が読む作業木である。触らない。
- 検証スクリプトは利用者の Pi が動かしている claude を止めない（`closeTuiProcesses()` はスクリプト自身のプロセスの worker だけを閉じる）。

## 危険と確かめ方

- `showThinkingSummaries: true` にすると、Claude Code は対話 TUI の画面にも思考の要約を描く。ターン終了の判定（`src/tui-screen.ts` の `TURN_DONE`・`BUSY_MARK`・`PROMPT`）は描画の文字列を見るため、思考の文に `esc to interrupt` や `❯ ` が含まれると判定がずれうる。実機の記録がすべて `ok` になること（時間切れにならないこと）で確かめる。ずれが見つかったら、本体を進めずに `implementation-notes.md` に画面の様子を書いて止める。
- -p 経路も同じ `bOn()` を通るため `redact-thinking-2026-02-12` が消えると読めるが、実機の要求の上限（8回）のため -p 経路は実機で確かめない。単体テストで settings.json の中身だけを確かめる。

## 未決事項

- 実機で (1) は成り立つが (2) が成り立たない場合（ベータは消えたのに本文が空のまま）の次の手。本設計では rejected として止め、原因の調べ直しは別の依頼にする。
- `redact-thinking-2026-02-12` 以外の anthropic-beta が変更後に増減した場合の扱い。本設計では INFO として記録するだけで合否に使わない。増減があれば `implementation-notes.md` に書き、審査で扱いを判断する。
