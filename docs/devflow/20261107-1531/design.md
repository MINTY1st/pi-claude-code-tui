# 設計: TUI の worker キャッシュに追い出しを足し、pi の開発依存を 1.5.0 に上げ、古いコメントを直す

## 結論

3つの小さな変更を1つの PR で入れる。

1. `src/tui-process.ts` の `acquire` は、キャッシュ（`workers`、上限 `MAX_CACHED = 2`）が埋まっているとき、新しいセッションの worker を使い捨てにしている。これを、使用中でない worker のうち最後に使った時刻（`lastUsed`）が最も古いものを Map から外して閉じ、空いた枠に新しい worker を登録する動作に変える。-p 経路の `acquireProcess`（`src/claude-cli.ts`）と同じ規則である。
2. `package.json` の devDependencies の `@earendil-works/pi-ai` と `@earendil-works/pi-coding-agent` を `^0.87.0` から `^1.5.0` に上げ、`package-lock.json` を 1.5.0 で解決し直す。本体（`src/`）の型の修正は要らない。
3. `src/claude-cli.ts` の `readyClaudeCommand` の JSDoc（189〜192行）を、今の起動の契機（-p 経路はツール呼び出しのたびに破棄、TUI 経路はキャッシュに合う worker が無いときに起動）に合わせて書き直す。

確定差分は `examples/` の4つの diff と `examples/package-lock.json` である。一時コピーのリポジトリ（HEAD `cd9dc99`）で全部を当てて `npm ci --include=dev` を実行し、`npm test` 210件合格・`npm run check` 合格を確認済みである。4つの diff は本リポジトリで `git apply --check` も通る。実装担当はこの差分を `test-list.md` の順に入れる。

## 目的

- 3つ目以降の Pi セッションでも TUI のプロセスを使い回せるようにする。今は先に2つのセッションが枠を取ると、15分の待機期限が切れるまで、ほかのセッションは毎ターン Claude Code を起動し直す（起動に2〜7秒かかる）。
- 型検査と単体テストを、実行環境の Pi（`~/.nvm/versions/node/v24.22.2/lib/node_modules/@earendil-works/pi-coding-agent`、1.5.0。依存の pi-ai も 1.5.0）と同じ版で行う。
- コメントが今の動作と食い違わないようにする。

## 範囲

| 対象 | 変更 |
| --- | --- |
| `src/tui-process.ts` | 公開関数 `oldestIdleSession` と内部関数 `makeRoom` を足し、`acquire` の登録部分を書き換える |
| `src/claude-cli.ts` | `readyClaudeCommand` の JSDoc だけを書き換える。コードは変えない |
| `package.json` | devDependencies の2行だけを `^1.5.0` にする |
| `package-lock.json` | `examples/package-lock.json` で置き換える |
| `tests/tui-process.test.ts` | 10件足す |
| `tests/package-metadata.test.ts` | 1件足す |
| `README.md` | Limitations のキャッシュの1行（71行）を新しい動作に合わせる |

範囲外: `MAX_CACHED`・`IDLE_LIFETIME_MS` の値、`usable` の条件、-p 経路（`acquireProcess` を含む `src/claude-cli.ts` のコード）、peerDependencies（`*` のまま）、`@types/node`・`typescript` の版、`package.json` の `version`、`docs/cross-provider-replay.md`・`docs/turn-completion.md`（キャッシュの記述が無い）。

## 変更前と変更後

### (1) TUI の worker キャッシュ

`acquire(input, env)` で、キャッシュにそのセッションの使える worker が無く、新しい worker を `TuiWorker.create` で起動した後の扱い:

| 場面 | 変更前 | 変更後 |
| --- | --- | --- |
| セッション ID が無い | 使い捨て | 使い捨て（変わらない）。何も追い出さない |
| そのセッションの worker が Map にある（並行要求で使用中） | 使い捨て | 使い捨て（変わらない）。何も追い出さない |
| Map が上限未満 | 登録する | 登録する（変わらない）。何も追い出さない |
| Map が上限で、使用中でない worker が1つ以上ある | 使い捨て | 使用中でない worker のうち `lastUsed` が最も古いものを Map から外し、閉じる。新しい worker を登録する |
| Map が上限で、すべて使用中 | 使い捨て | 使い捨て（変わらない）。何も追い出さない |

「使用中」は `TuiWorker.busy === true` を指す。`busy` は `reserve()` で真、`release()` で偽になる。壊れた worker（`broken`）や死んだ worker も `busy` が偽なら追い出しの対象になる。

追い出された worker を前に使っていたセッションは、次のターンで Map に自分の worker が無いため、新しく起動する（そのとき枠が埋まっていれば、同じ規則で別の worker を追い出す）。

### (2) 開発依存の版

| 項目 | 変更前 | 変更後 |
| --- | --- | --- |
| `package.json` `devDependencies["@earendil-works/pi-ai"]` | `^0.87.0` | `^1.5.0` |
| `package.json` `devDependencies["@earendil-works/pi-coding-agent"]` | `^0.87.0` | `^1.5.0` |
| `package-lock.json` の `node_modules/@earendil-works/pi-ai` と `pi-coding-agent` の `version` | `0.87.1` | `1.5.0` |
| `npm test` | 199件合格 | 210件合格（足す11件を含む） |
| `npm run check` | 合格 | 合格（`src/` の型の修正なし） |

1.5.0 は依存として `pi-agent-core`・`pi-codemode`・`pi-mcp`・`pi-schema`・`pi-tui` などを新たに引く。lock の差分が大きい（約 +390/−1990 行）のはこのためであり、`examples/package-lock.json` をそのまま使う。

### (3) `readyClaudeCommand` の JSDoc

変更前:

```ts
/**
 * Resolve a logged-in Claude Code executable. Successful checks are cached
 * briefly because a fresh worker is spawned after every tool call, and an
 * extra `claude auth status` process on each of those turns adds latency.
 */
```

変更後（`examples/src-changes.diff` と同じ文面。このファイルのコメントは英語で書かれているため英語のままにする）:

```ts
/**
 * Resolve a logged-in Claude Code executable. Successful checks are cached
 * briefly because every worker launch needs one: the -p path discards its
 * worker after each tool call, and the TUI path launches a new one whenever no
 * cached worker matches the request. An extra `claude auth status` process on
 * each of those launches adds latency.
 */
```

根拠: -p 経路は `ClaudeProcess.commit` が応答に `tool_use` を含むと `false` を返し、`runClaudeRequest` が `discardProcess` で閉じる。TUI 経路は `TuiWorker.create` が起動のたびに `readyClaudeCommand` を呼ぶ。

## 業務ルール

1. 追い出しを考えるのは、セッション ID があり、Map にそのセッションの worker が無く、新しい worker の起動が終わった時点だけである。
2. 追い出す worker は「`busy` が偽」のものから `lastUsed` が最小のものを選ぶ。`lastUsed` が等しければ Map に先に入ったもの（反復順で先のもの）を選ぶ。起動時刻ではなく最後に使った時刻で選ぶ。
3. 追い出しは Map の大きさが上限未満になるまで繰り返す。上限は 2 のままなので、実際には0件か1件である。対象が無くなったら止め、新しい worker は使い捨てにする。
4. 空きの判定・追い出す worker の Map からの削除・新しい worker の登録は、`TuiWorker.create` の後に `await` を挟まずに続けて行う。追い出した worker を閉じる処理（`close()`）はその後で待つ。閉じる処理の失敗は握りつぶし、要求は続ける。
5. 追い出した worker の待機タイマーは `close()`（`dispose`）が止める。タイマーの処理は `workers.get(sessionId) === this` を確かめてから Map を消すため、追い出し後に同じセッションへ登録した新しい worker を消さない（今のコードのまま）。

## 設定

新しい設定値・環境変数は無い。`MAX_CACHED = 2`、`IDLE_LIFETIME_MS = 15分` は変えない。

## エラー

新しいエラーは無い。追い出した worker の `close()` が reject しても無視する（`.catch(() => undefined)`）。新しい worker の `TuiWorker.create` が失敗したときは、追い出しの前に例外が出るため何も追い出さない（今と同じく例外がそのまま呼び出し元へ伝わる）。

## 受け入れ条件

1. `npm ci --include=dev` の後、`npm test` が 210件すべて合格する（変更前 199件 + 11件）。
2. `npm run check`（`tsc --noEmit`）が合格する。
3. `node_modules/@earendil-works/pi-ai/package.json` と `node_modules/@earendil-works/pi-coding-agent/package.json` の `version` が `1.5.0` である。
4. `test-list.md` の Red の手順で、仮実装のときに7件が AssertionError で落ちる。
5. `git diff` が「範囲」の表のファイルだけを含む。`src/claude-cli.ts` の差分はコメント行だけである。
6. `git diff --stat` で `src/tui-process.ts` の本体が 500行を超えない（変更後は約 280行）。追加・変更する関数はそれぞれ 50行以内である。

## 実装上の注意

- この環境は `NODE_ENV=production` であり、npm の `omit` が `dev` になる。`npm ci` だけでは devDependencies が入らず、`tsc` が見つからない・テストが import で落ちる。必ず `npm ci --include=dev` を使う。
- AGENTS.md の `node docs/sync_backlog_wiki.js` は、このリポジトリに `docs/sync_backlog_wiki.js` が無いため実行しない。
- `/tmp/dev1531` に、設計前から detached の worktree が残っている。設計時の検証では使っていない。実装で一時コピーが要るなら別の場所に作る。

## 未決事項

無し。
