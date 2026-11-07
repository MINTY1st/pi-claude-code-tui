# テストリスト

対象: `src/turn-body.ts`（`tests/turn-body.test.ts`）、`src/tui-process.ts`（`tests/tui-process.test.ts`、偽 claude `tests/fixtures/fake-claude.mjs`）、実機（`scripts/verify-turn-body.mts`）。各項目の括弧内はお手本 `examples/tests-changes.diff` のテスト名である。

## 進め方

1. 変更前に `npm test` を実行し、177件すべて合格することを確かめる。
2. 実機の「変更前」を記録する（design.md の受け入れ条件3の前半。`git worktree add` から `run /tmp/verify-before ...` まで）。本体を変える前に行う。
3. `examples/tests-changes.diff` の内容を入れる（`git apply` をハーネスがテストの追加として認識しないときは、`edit`・`write` で同じ内容を入れ、`index` 行を除いて差分が一致することを `diff` で確かめる。devflow 20261107-1406 の実装メモと同じ扱い）。この時点で `npm test` を実行すると、`tests/turn-body.test.ts` は `src/turn-body.ts` が無いため読み込みで失敗する。これは正しい Red ではないので次の仮実装に進む。
4. `src/turn-body.ts` に次の仮実装だけを入れる（`src/tui-process.ts` はまだ変えない）。
   ```ts
   export const TURN_BODY_KEYS = ["output_config", "context_management"] as const;
   export type TurnBodyKey = (typeof TURN_BODY_KEYS)[number];
   export type TurnBody = Partial<Record<TurnBodyKey, unknown>>;
   export interface LaunchIdentity {
     body: Record<string, unknown>;
     turnKeys: TurnBodyKey[];
   }
   export function turnBodyOf(_extraBody: Record<string, unknown>): TurnBody {
     return {};
   }
   export function launchIdentity(extraBody: Record<string, unknown>): LaunchIdentity {
     return { body: { ...extraBody }, turnKeys: [] };
   }
   export function applyTurnBody(body: Buffer, _turn: TurnBody): Buffer {
     return body;
   }
   ```
5. `node --experimental-transform-types --test tests/turn-body.test.ts tests/tui-process.test.ts` を実行し、次の10件だけが落ちることを確かめる（設計時に確認済み。落ち方は AssertionError 9件と `Missing expected exception` 1件）。
   - turn-body（8件）: turnBodyOf は output_config と…、turnBodyOf の戻り値は…、launchIdentity は2つのキーの値を外し…、effort だけが違う extraBody は…、applyTurnBody は Claude Code が付けた同名のキーを…、applyTurnBody はターンに無いキーと…、本文が JSON のオブジェクトでなければ…（`Missing expected exception`）、applyTurnBody はターンの値と参照を共有せず…
   - tui-process（2件）: effort だけを変えた次のターンは…、起動時の settings には起動したターンの output_config を残し…
6. 仮実装を `examples/src-changes.diff` の `src/turn-body.ts` に置き換え、`tests/turn-body.test.ts` の13件が通ることを確かめる。順序は `turnBodyOf` → `launchIdentity` → `applyTurnBody` とし、1つ入れるごとに対象のテストが通ることを見る。
7. `src/tui-process.ts` を `examples/src-changes.diff` のとおりに変える。順序は import → `fingerprint`（ここで「起動時の settings には…」が通る）→ `run` の `transformRequest`（ここで「effort だけを変えた…」が通る）→ settings.json の前のコメント。
8. 「反例の Red の確かめ方」の書き換えを1つずつ試し、表のテストが落ちることを確かめてから元に戻す。
9. 全体確認と実機の「変更後」・`compare` を実行する。

## ターンの値の取り出し（`turnBodyOf`）

- [ ] `output_config` と `context_management` だけを取り出し、`tools`・`max_tokens`・`thinking` は含めない。thinking オンの本文からは `{ output_config }`、オフの本文からは `{ context_management }`、どちらも無い本文からは `{}` を返す（turnBodyOf は output_config と context_management だけを取り出し、ほかのキーは含めない）
- [ ] 境界値: 値が `undefined` のキーは無いものとして扱う（境界値: 値が undefined のキーは無いものとして扱う（settings.json の JSON に出ないため））
- [ ] 戻り値は `extraBody` と参照を共有せず、取り出した後に `extraBody` を書き換えても値が変わらない（turnBodyOf の戻り値は extraBody と参照を共有しない）

## 指紋の材料（`launchIdentity`）

- [ ] 2つのキーの値を外した `body` と、値があったキーの名前の `turnKeys` を返す（launchIdentity は2つのキーの値を外し、キーの有無だけを turnKeys に残す）
- [ ] effort だけが違う2つの `extraBody` は同じ結果になり、`thinking` か `max_tokens` が違えば違う結果になる（effort だけが違う extraBody は launchIdentity が一致し、thinking や max_tokens が違えば一致しない）
- [ ] 反例: `output_config` の有無が違えば違う結果になる（反例: output_config の有無が違えば、値を外しても launchIdentity は一致しない）
- [ ] 引数の `extraBody` を書き換えない（launchIdentity は引数の extraBody を書き換えない）

## 本文への書き込み（`applyTurnBody`）

- [ ] Claude Code が入れた同名のキーを、中身を混ぜずに丸ごと置き換える（`output_config` の `format` や `context_management` の既定の edits は残らない）（applyTurnBody は Claude Code が付けた同名のキーを中身を混ぜずに丸ごと置き換える）
- [ ] ターンに無いキー、`messages`・`thinking`・`max_tokens`・`model` は変えない（applyTurnBody はターンに無いキーと messages・thinking・max_tokens・model には触らない）
- [ ] 反例: 本文に無いキーは足さない（反例: Claude Code が本文から落としたキーは足さない（変更前も上流へ送っていなかった））
- [ ] ターンに書くキーが無ければ本文を解析せず、引数と同じ `Buffer` を返す（JSON でない本文でも例外にならない）（ターンに書くキーが無ければ、本文を解析せず同じ Buffer をそのまま返す）
- [ ] 4xx 相当の入力: 本文が配列・`null`・数なら `must be a JSON object` のエラー、壊れた JSON なら `SyntaxError` を投げる（本文が JSON のオブジェクトでなければエラーにする）
- [ ] ターンの値と参照を共有せず、続けて呼んでも前の本文の値が混ざらない（applyTurnBody はターンの値と参照を共有せず、続けて呼んでも前の本文の値が混ざらない）

## プロセスの使い回し（`tui-process.ts`、偽 claude）

- [ ] 状態遷移: effort を high → low → high と変えた3ターンは claude を1回だけ起動し、上流の本文の `output_config` はそれぞれ `high`・`low`・`high` になる。前のターンの値は次のターンに残らない（effort だけを変えた次のターンは Claude Code を作り直さず、そのターンの output_config を上流へ送る）
- [ ] 起動時の settings.json の `CLAUDE_CODE_EXTRA_BODY` は起動したターンの値（`effort: "high"`）のままで、effort を変えたターンで書き直さない（起動時の settings には起動したターンの output_config を残し、effort を変えても書き直さない）
- [ ] thinking オフのターンは `context_management: { edits: [] }` が上流の本文の最上位に入る（thinking オフのターンは context_management を上流の本文の最上位に書く）
- [ ] 状態遷移: thinking オンからオフに変えたターンは claude を作り直す（依頼どおり許容する作り直し）（thinking のオン・オフを切り替えたターンは Claude Code を作り直す）
- [ ] 反例: Claude Code が本文から `output_config` を落としたら（偽 claude の `FAKE_DROP_BODY_KEYS`）、ターンの値があっても上流へ足さない（反例: Claude Code が本文から落とした output_config は、ターンの値があっても上流へ足さない）
- [ ] 反例: `output_config` の有無だけが変わったターンは作り直す（反例: output_config の有無だけが変わったターンは、値を指紋から外していても Claude Code を作り直す）
- [ ] 反例: `max_tokens` が変わったターンは、これまでどおり作り直す（反例: max_tokens が変わったターンは、これまでどおり Claude Code を作り直す）
- [ ] 同時実行: 同じセッションへ effort の違う2つの要求を同時に送ると、それぞれの本文にそれぞれの effort が入る（同時実行: 同じセッションへ effort の違う要求が並んでも、それぞれの本文にそれぞれの effort を書く）
- [ ] 4xx: 上流が 400 を返したターンの後も、次のターンは自分の effort で送る（反例: 上流が 400 を返したターンのあとも、次のターンは自分の effort で送り、前のターンの値を引き継がない）。4xx の後は既存どおり worker を破棄するため、同じ worker での値の持ち越しは1件目の状態遷移のテストで検出する
- [ ] 既存の `tests/tui-process.test.ts` の20件は書き換えずに合格する（偽 claude が `CLAUDE_CODE_EXTRA_BODY` を本文へ混ぜても、既存テストは `extraBody: {}` なので本文が変わらない）

権限: このリポジトリに利用者の権限の区別は無い。上流の URL は既存の `TurnRelay` の検査（HTTPS か loopback の HTTP だけ）のままで、本変更で緩めない。

## 反例の Red の確かめ方

次の書き換えを1つずつ入れ、`node --experimental-transform-types --test tests/turn-body.test.ts tests/tui-process.test.ts` で表のテストが AssertionError で落ちることを確かめてから元に戻す（設計時にすべて確認済み）。

| # | 書き換え | 落ちるテスト |
| --- | --- | --- |
| 1 | `applyTurnBody` の `if (Object.hasOwn(payload, key))` を外し、無いキーも足す | 反例: Claude Code が本文から落とした output_config は…（tui-process）、反例: Claude Code が本文から落としたキーは足さない…（turn-body） |
| 2 | `launchIdentity` の `turnKeys` を常に `[]` にする | launchIdentity は2つのキーの値を外し…、反例: output_config の有無が違えば…、反例: output_config の有無だけが変わったターンは… |
| 3 | `fingerprint` の材料を変更前の `extraBody: input.extraBody` に戻す | effort だけを変えた次のターンは…、起動時の settings には… |
| 4 | `transformRequest` から `applyTurnBody` を外す（`replaceTranscript` だけにする） | effort だけを変えた次のターンは… |
| 5 | `applyTurnBody` を丸ごとの置き換えでなく `{ ...payload[key], ...value }` の浅い混ぜ合わせにする | applyTurnBody は Claude Code が付けた同名のキーを中身を混ぜずに丸ごと置き換える |
| 6 | `turnBodyOf` の `structuredClone` を外す | turnBodyOf の戻り値は extraBody と参照を共有しない |

## 全体確認

- [ ] `npm test` が199件すべて合格する
- [ ] `npm run check`（`tsc --noEmit`）が合格する
- [ ] 変更したファイルが design.md の「範囲」の表のものだけである（`git status --short`。`docs/devflow/20261107-1433/implementation-notes.md` を含む）

## 実機（`scripts/verify-turn-body.mts`、claude-sonnet-5-5、合計8回・やり直しを含め12回以内）

- [ ] `compare` の最後の行が `summary: 30 passed, 0 failed` である。内訳は次のとおり
- [ ] ターン2（high → low）とターン3（low → medium）で、変更後の claude の `--settings` のパスが前のターンと同じ（作り直しが起きない）
- [ ] 4ターンすべてで、上流の本文の `thinking`・`output_config`・`context_management`・`max_tokens`・`model` が変更前と一致する
- [ ] 4ターンすべてで、`anthropic-beta` の集合が変更前と一致する
- [ ] 4ターンすべてで、変更後の `cache_read_input_tokens` が変更前以上である
- [ ] `run` 2回の出力と `compare` の出力全文を `implementation-notes.md` に貼った。`FAIL` があればその行と「実機の判定に不合格がある」ことを書き、PR を作らずに止めた
