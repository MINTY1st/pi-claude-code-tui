# pi-claude-code-tui

Claude Code の対話 TUI を PTY で動かし、Pi のモデルプロバイダとして使う実験的な拡張。Pi が会話・承認・ツール実行を管理し、Claude Code にはモデルとの通信と Pi のツール一覧の提示を任せる。

[earendil-works/pi-claude-code](https://github.com/earendil-works/pi-claude-code) からの非公式の派生版。元の MIT ライセンスと著作権表示を保持している。Anthropic・Claude Code・Pi の公式提供ではなく、サービス側の利用条件上の許可やプラン枠での利用を保証しない。

ソースコードは [MINTY1st/pi-claude-code-tui](https://github.com/MINTY1st/pi-claude-code-tui) で管理する。npm には公開しておらず、`private: true` により npm への誤公開を防いでいる。

## 動作条件

- Pi と Claude Code をインストールし、`claude auth login` を済ませる。
- TUI 経路は Linux／macOS と Python 3.9 以上の `python3` と、`os.forkpty`・`os.waitid`・`os.WNOWAIT` が利用できる環境を必要とする。実機検証は WSL2・Claude Code 2.1.316・Haiku 5.5 で行った。macOS は未実機検証で、Windows ネイティブの ConPTY には対応していない。
- Node.js 24.21 以上が必要。検証に使用した版は 24.22.2 である。

## ローカルで起動する

リポジトリを clone して、依存関係をインストールする。

```sh
git clone https://github.com/MINTY1st/pi-claude-code-tui.git
cd pi-claude-code-tui
npm ci
```

初回公開用 PR が未マージの場合は、`git switch --track origin/feat/tui-mode` でそのブランチへ切り替えてから `npm ci` を実行する。

利用する作業フォルダで、一度通常の `claude` を起動し、フォルダの信頼確認を自分で済ませてから終了する。拡張は既定では信頼確認に自動で Yes と答えない。

次に、拡張の絶対パスを指定して Pi を起動する。

```sh
pi -e /absolute/path/to/pi-claude-code-tui/src/index.ts
```

モデル選択で **Claude Code Subscription (Experimental)** を選ぶ。既存の同名プロバイダ拡張を読み込んでいる環境では、競合を避けるため、まず他の拡張を無効にした起動で検証する。

```sh
pi -ne -e /absolute/path/to/pi-claude-code-tui/src/index.ts \
  --provider claude-code --model haiku
```

普段の Pi の設定・モデル・拡張は、このリポジトリを変更しただけでは切り替わらない。

## 設定

| 環境変数 | 動作 |
|---|---|
| `PI_CLAUDE_CODE_TUI` | 未指定では TUI。`0` のときだけ従来の `claude -p` を使用する。TUI の失敗時に自動で `-p` へ切り替えない。 |
| `PI_CLAUDE_CODE_TUI_TRUST` | `1` のとき、指定した作業フォルダの信頼確認に自動で Yes と答える。既定では答えずエラーにする。信頼するフォルダでのみ使用する。 |
| `PI_CLAUDE_CODE_COMMAND` | Claude Code の実行ファイル。既定は PATH 上の `claude`。 |
| `PI_CLAUDE_CODE_CONFIG_DIR` | Claude Code に渡す設定ディレクトリ。`CLAUDE_CONFIG_DIR` に対応する。 |
| `PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS` | `1` のとき、使用量クレジットへの計上を検知しても停止しない。従量課金を明示的に許容する設定であり、既定では許容しない。 |

ログイン・ログアウトは `claude auth login`／`claude auth logout` で行う。Pi の `/claude-code-status` で検出状況を確認できる。拡張は Claude Code の認証ファイルを読んだり複製したりしないが、認証済みリクエストのヘッダーはローカル relay を通過する。

## 課金と利用条件

プラン枠での利用や将来の互換性は保証しない。上流がサードパーティ利用として使用量クレジットを要求した場合は、自動再試行しない課金エラーとして返す。API キー・外部プロキシ・Bedrock・Vertex・Foundry の継承設定も、認証や課金が意図せず変わらないよう拒否する。

TUI 経路では Pi のプロンプトを API の system ではなく最初の user に置く。Claude Code 本来の system は残るため、Pi の指示は system 指示と同じ優先順位にはならない。実機試験では system 配置が HTTP 400、user 配置が成功だったが、これを利用条件上の許可や課金保証と解釈しない。

課金ガードは応答後のヘッダーから使用量クレジットへの計上を検知する。最初の請求自体を未然に防ぐものではない。従量課金を避けたい場合は、Claude 側の設定でも使用量クレジットを無効にする。

利用条件上の許可と技術レビューの承認は別に扱う。利用前に Claude Code と契約プランに適用される利用条件を確認する。試験結果は [docs/spike-2026-11-03.md](docs/spike-2026-11-03.md) を参照する。

## テスト

```sh
npm test
npm run check
npm pack --dry-run
```

単体テストでは偽の Claude Code とローカル上流を使用し、実サービスへのモデルリクエストは送らない。Python の PTY で実際に子プロセスを起動するため、テストにも `python3` が必要である。

## 制限

- 実機試験で、試験スクリプトの100秒期限に1回到達した。直後の最小条件・コンテキストありの再試行はそれぞれ約8秒で成功したが、その1回の原因は未特定である。詳細は [試験記録](docs/spike-2026-11-03.md#単発の実機タイムアウト) を参照する。

- 終了時の子孫の清掃は forkpty の同一プロセスグループが対象であり、setsid／setpgid で脱出した子孫や helper 自体への SIGKILL までは保証しない。
- Claude Code の画面表示に依存する。更新で表示が変わると入力待ちやターン終了を検出できない場合がある。
- ターンごとに `/clear` し、Pi の全履歴を relay で復元する。通常の Claude Code セッション再開と同じ方式ではない。
- Pi セッションごとに1プロセス、拡張全体で最大2プロセスをキャッシュする。各プロセスは待機15分で破棄する。セッション ID がない要求や、同一セッションへの競合要求は使い捨てプロセスで処理する。
- ツールスキーマの `oneOf`・`allOf`・`anyOf`・nullable などは単純化される場合がある。途中のツール追加・削除の履歴保持は対応モデルに限る。

内部構成は [ARCHITECTURE.md](ARCHITECTURE.md) を参照する。
