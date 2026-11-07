# PR 用 CI とリリースノート自動作成の実装ノート

## 実装結果

[structure.md](structure.md) の完成形をそのまま反映した。設計からの逸脱はない。作業順序も同書 5 章のとおりに進めた。

| パス | 種別 | 結果 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | 追加 | 完成形と一致 |
| `.github/workflows/publish.yml` | 変更 | 末尾に `release` ジョブを追記。既存行の変更なし |
| `.github/release.yml` | 追加 | 完成形と一致 |
| `tests/ci-workflow.test.ts` | 追加 | 7 テスト |
| `tests/release-notes-config.test.ts` | 追加 | 4 テスト |
| `tests/release-workflow.test.ts` | 変更 | 分割を 3 ジョブ構成に変更し、6 テストを追加（計 10 テスト） |
| `README.md` | 変更 | Development 節に 1 段落、Publishing 節に 2 行を追記 |

## Red の観測

- `tests/release-workflow.test.ts`: `release` ジョブが無い状態で `releasing` が `undefined` になり、`AssertionError` で失敗した。
- `tests/release-notes-config.test.ts` と `tests/ci-workflow.test.ts`: 対象 YAML が存在しないため `ENOENT` で失敗した。新規ファイルを追加するテストでは、AssertionError より前に対象ファイルの読み込みで止まる。

## 検証結果

- `npm test`: 137 件合格、0 件失敗。
- `npm run check`: 成功。
- `git diff --stat`: `src/` と `scripts/` に差分なし。

## 未対応

[design.md](design.md) 7 章の未決事項は変更していない。ラベル `fix`・`feature`・`docs`・`ci`・`chore` はリポジトリに存在しないままで、作成も本変更に含めない。

---

更新履歴: 2026-11-07 初版（devflow/20261107-1024）
