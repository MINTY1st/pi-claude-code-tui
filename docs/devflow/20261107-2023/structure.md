# 構成: Pi のツール一覧に無いツール名を、ツールの結果としてモデルへ返す

この文書は、design.md の変更をどのファイルのどの行にどう入れるかを決める。行番号は HEAD `5ffc96a` のものである。

## 層と責務、依存の向き

変更に関わる層は次の3つで、依存の向きは変えない（上が下を import する）。

| 層 | ファイル | 責務 | この変更での役割 |
| --- | --- | --- | --- |
| Pi との境界 | `src/stream.ts` | Claude Code の応答（Anthropic のイベントと最終メッセージ）を Pi の `AssistantMessage` に変換する | `tool_use` を `toolCall` に変換するときに `piToolName` を呼ぶ。名前の検査をしない |
| Claude Code の実行 | `src/tui-process.ts`（対話 TUI 経路）、`src/claude-print-process.ts`（-p 経路） | Claude Code を動かし、上流の応答を `RunClaudeOutput` として返す | ツール名の検査を消す。応答の `tool_use` を書き換えずに返す |
| 純粋な変換 | `src/tool-config.ts`（`src/transcript.ts` が再 export） | Pi のツール定義と Claude Code のツール定義の相互変換 | `piToolName` を持つ |

依存の向き: `stream.ts` → `transcript.ts` → `tool-config.ts`。`stream.ts` は今も `TOOL_PREFIX` などを `./transcript.ts` から import しているため、`piToolName` も `./transcript.ts` から import する。`stream.ts` から `./tool-config.ts` を直接 import しない。

ツール名の検査は、どの層にも置かない。一覧に無い名前を「ツールが無い」というツールの結果に変えるのは Pi 本体（`pi-agent-core` の `prepareToolCall`）の1か所だけであり、このパッケージはそこへ名前を届けるだけにする。

## 型

```ts
// src/tool-config.ts（TOOL_PREFIX の定義の直後に置く）
export function piToolName(nativeName: string): string;
```

```ts
// src/claude-print-process.ts の RunClaudeInput（変更後）。toolNames の1行だけを消し、ほかのフィールドと順序は変えない
export interface RunClaudeInput {
  model: string;
  cwd?: string;
  frames: NativeFrame[];
  systemPrompt: string;
  manifest: ToolManifestEntry[];
  extraBody: Record<string, unknown>;
  // toolNames: Set<string>;  ← 消す
  signal?: AbortSignal;
  // ...以下は変えない
}
```

```ts
// src/stream.ts（変更後のシグネチャ）
function nativeContent(content: NativeContentBlock[]): AssistantMessage["content"];
class EventTranslator {
  constructor(
    private readonly model: Model<any>,
    private readonly output: AssistantMessage,
    private readonly stream: AssistantMessageEventStream,
  );
}
```

## ファイルごとの変更

### `src/tool-config.ts`

`export const TOOL_PREFIX = "mcp__pi__";`（4行目）と空行の直後に、次の関数を足す。コメントは「なぜ例外にしないか」だけを書く。

```ts
// Pi の一覧に無い名前も例外にしない。Pi の agent loop が「Tool <name> not found」のツール結果をモデルへ返して続けるため
export function piToolName(nativeName: string): string {
  return nativeName.startsWith(TOOL_PREFIX) ? nativeName.slice(TOOL_PREFIX.length) : nativeName;
}
```

`prepareTools` は変えない（戻り値の `names` も残す）。

### `src/transcript.ts`

12行目の再 export に `piToolName` を足す。並びはアルファベット順にする。

```ts
export { buildExtraBody, normalizeInputSchema, piToolName, prepareTools, TOOL_PREFIX, type ToolManifestEntry } from "./tool-config.ts";
```

11行目の `import { nativeSystemBlocks, prepareTools, sanitizeSurrogates, TOOL_PREFIX } from "./tool-config.ts";` は変えない（`transcript.ts` の中では `piToolName` を使わない）。

### `src/stream.ts`

1. import（24〜34行目）: `TOOL_PREFIX,` の行を消し、`piToolName,` を `NATIVE_TOOL_CHANGES_BETA,` と `prepareFrames,` の間に足す。`stream.ts` の中で `TOOL_PREFIX` はほかに使っていないため、消しても型検査は通る。
2. `nativeContent`（127行目）: 第2引数 `toolNames: Set<string>` を消す。`tool_use` の分岐の中身（146〜149行目の4行）を次の1行にする。

   ```ts
   converted.push({ type: "toolCall", id: block.id, name: piToolName(block.name), arguments: block.input as never });
   ```

3. `EventTranslator` のコンストラクタ（163行目）: `private readonly toolNames: Set<string>,` の行を消す。
4. `finish`（200行目）: `nativeContent(message.content, this.toolNames)` を `nativeContent(message.content)` にする。
5. `startBlock` の `tool_use` の分岐（244〜246行目）: 検査の3行を消し、`push` するオブジェクトの `name,` を `name: piToolName(native.name),` にする。`id`・`arguments`・`nativeIndex`・`partialJson` の行と `toolcall_start` の push は変えない。
6. `streamClaudeCode`（379行目）: `new EventTranslator(model, output, stream, preparedTools.names)` を `new EventTranslator(model, output, stream)` にする。
7. `runRequest` の引数（391行目）: `toolNames: preparedTools.names,` の行を消す。

`startBlock`（ストリームの途中）と `nativeContent`（最終メッセージ）の両方が同じ `piToolName` を通るため、`finish` の「ストリームと最終応答の一致」の比較（201行目）は一覧に無い名前でも一致する。この比較は変えない。

### `src/tui-process.ts`

1. 12行目の `import { TOOL_PREFIX } from "./transcript.ts";` を消す（ほかに使っていない）。
2. `assertKnownTools`（71〜78行目）と、その後ろの空行1行を消す。
3. `TuiWorker.output`（169行目）の `assertKnownTools(message, input.toolNames);` を消す。

`assertCompleteCapture`・トークン使用量の検査・使用量クレジットの検査は変えない。

### `src/claude-print-process.ts`

1. 19行目の import を `import type { NativeSystemInjection, ToolManifestEntry } from "./transcript.ts";` にする（`TOOL_PREFIX` を使わなくなり、残る2つは型だけのため）。
2. `RunClaudeInput` の `toolNames: Set<string>;`（32行目）を消す。
3. `ClaudeProcess.run` の中の検査（446〜451行目の `for` 文6行）と、その後ろの空行1行を消す。

`maxTurnsBoundary` の判定・`result` の検査・トークン使用量の検査は変えない。

### `README.md`

63行目の最後の文を次の2文に置き換える。ほかの行は変えない。

> 4xx responses, billing errors and malformed streams are reported without that wording and are not retried. A tool call outside Pi's current tool list is passed to Pi as is, and Pi answers the model with a "Tool ... not found" tool result instead of failing the turn.

### `package.json`・`package-lock.json`

次のコマンドを1回だけ実行する。`node_modules` には既に `@earendil-works/pi-agent-core@1.5.0` が入っているため、`--package-lock-only --offline` で通る（設計時に実測済み。差分は両ファイルの devDependencies に1行ずつ）。

```bash
npm install --package-lock-only --offline --save-dev @earendil-works/pi-agent-core@^1.5.0
```

peerDependencies には足さない（実行時にこのパッケージは `pi-agent-core` を import しないため）。

## テストのファイル

| ファイル | 変更 |
| --- | --- |
| `tests/unknown-tool.test.ts`（新規） | `docs/devflow/20261107-2023/examples/unknown-tool.test.ts` をそのままコピーする。5件 |
| `tests/tui-process.test.ts` | 82行目の `toolNames: new Set(),` を消す。244行目の `toolNames: new Set(["read"]), ` を消す。253〜257行目のテスト「Pi に登録されていないツールを返す応答は採用しない」を下の「反転後のテスト」に置き換える |
| `tests/claude-cli.test.ts` | 278行目・305行目・379行目の `toolNames: ...,` の行を消す。408行目（`assert.equal((await readFile(processLog, "utf8")).trim().split("\n").length, 6);`）の直後に下の「-p 経路の追加」を入れる |
| `tests/billing.test.ts` | 99行目の `toolNames: new Set(),` を消す |

ほかのテストは変えない。特に `tests/relay-failure.test.ts` と `tests/turn-relay-failure.test.ts` の文字列は変えない（design.md「範囲に入らないもの」）。

反転後のテスト（`tests/tui-process.test.ts`）:

```ts
test("Pi に登録されていないツールを返す応答も、例外にせず tool_use のまま Pi へ返す（Pi の agent loop がツールの無いことをモデルへ返すため）", async () => {
  for (const name of ["mcp__pi__unknown", "write"]) {
    const tool: NativeContentBlock = { type: "tool_use", id: "t", name, input: {} };
    await withFixture({}, async (_upstream, input) => {
      const output = await runTuiRequest(input("読む"));
      assert.deepEqual(output.message.content, [tool]);
      assert.equal(output.message.stop_reason, "tool_use");
    }, { content: tool });
  }
});
```

-p 経路の追加（`tests/claude-cli.test.ts`。`common` は `manifest: []`・`extraBody: { tools: [] }` で、Pi のツール一覧が空の状態を表す）:

```ts

    // Pi のツール一覧に無いツールでも例外にせず、Pi の agent loop にツールの無いことを返させる（2026-11-07 の実測）
    const unknownTool = await runClaudeRequest({
      ...common,
      sessionId: "unknown-tool-session",
      frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text: "call-tool" }] } }],
    });
    assert.equal(unknownTool.message.stop_reason, "tool_use");
    assert.deepEqual(unknownTool.message.content.map((block) => block.type === "tool_use" && block.name), ["mcp__pi__echo"]);
```

### `examples/unknown-tool.test.ts` の仕組み

- 対話 TUI 経路（既定）で `streamClaudeCode` を通す。偽の Claude Code は既存の `tests/fixtures/fake-claude.mjs` を使う。
- `stream.ts` は `upstreamUrl` を `runTuiRequest` に渡さないため、`TurnRelay.prototype.start` を `testContext.mock.method` で包み、`start` の前に `upstream` をテスト用の HTTP サーバーへ差し替える。本物の API へは要求を出さない。`tests/stream-abort.test.ts` が `TuiSession.prototype` を包むのと同じ書き方である。
- テスト用の上流は、受けた要求の本文を順に `bodies` に保存し、n 回目の要求に `replies[n-1]`（足りなければ最後の要素）の SSE を返す。
- テストごとに別の `sessionId` を使い、`finally` で `closeTuiProcesses()` と `upstream.close()` を呼ぶ。テストの間で Claude Code のプロセスを共有しない。
- agent loop のテストは、`agentLoop([], context, config, undefined, streamClaudeCode)` を呼ぶ。`config` は `model`・`convertToLlm`（恒等関数）・`sessionId`・`env` だけを持つ。Pi のツール一覧には `read` だけを置き、`write` を置かない。

## 例外の扱い

- このパッケージの中では、ツール名を理由に例外を投げない。業務エラー（ツールが無い）からモデルへのツール結果への変換は、Pi 本体の `prepareToolCall` の1か所で行う。
- `stream.ts` の `catch`（`stopReason` を `error` か `aborted` にする処理）と `normalizeError` は変えない。
- relay の `CaptureError`（`onEvent` の中の例外を包む仕組み）は変えない。ツール名で `onEvent` が例外を投げることが無くなるだけである。

## 同時実行と状態

- 足す関数 `piToolName` は純粋関数であり、状態を持たない。
- 保存する値は増えない。`toolCall.name` は応答の `tool_use.name` から毎回導出する。
- replay carrier（`makeReplayDiagnostic`）は Claude Code の応答の native メッセージをそのまま保存し、`projection` は変換後の `AssistantMessage` から作る。どちらも `piToolName` を通した後の名前で一貫するため、次の要求では carrier の native メッセージ（`write` のまま）が再送される（設計時に実測）。
- TUI のプロセスの使い回し（`workers`）と `/clear` の流れは変えない。一覧に無いツールのターンも、正しいツールのターンと同じく1回の上流要求で終わり、後続の要求は relay が拒否する。

## 古い応答の扱い

変更前に保存されたセッションの履歴には、一覧に無い名前の `toolCall` は入っていない（変更前はそのターンが `stopReason: "error"` で終わり、`repairToolHistory` の `withoutFailedTurns` が次の要求の前に取り除く）。この扱いは変えない。変更後に保存される履歴には、一覧に無い名前の `toolCall` と Pi のエラーのツール結果の組が残り、普段のツールの往復と同じく再送される。

## 1関数50行・1ファイル500行

| 対象 | 変更前 | 変更後 |
| --- | --- | --- |
| `src/stream.ts` | 445行 | 437行 |
| `src/tui-process.ts` | 280行 | 269行 |
| `src/claude-print-process.ts` | 506行 | 498行 |
| `src/tool-config.ts` | 116行 | 121行 |
| `nativeContent` | 27行 | 24行 |
| `EventTranslator.startBlock` | 39行 | 36行 |
| `ClaudeProcess.run` | 既存で50行超 | 7行減る。分割はこの依頼で行わない |

関数を足すのは `piToolName`（3行）だけである。行数を合わせるための分割は行わない。

## 実装の順序（TDD）

1. `tests/unknown-tool.test.ts` を、`examples/unknown-tool.test.ts` から「境界値: piToolName ...」のテストと `piToolName` の import の2か所を除いて作る。実行し、3件が AssertionError で失敗し、「Pi のツール一覧にあるツール名の扱いは変わらない」の1件が合格することを確かめる。
2. `tests/tui-process.test.ts` のテストを「反転後のテスト」に置き換え、`tests/claude-cli.test.ts` に「-p 経路の追加」を入れる。両方が AssertionError か `outside Pi's current tool inventory` の例外で失敗することを確かめる。
3. `src/tool-config.ts` に `piToolName` を仮実装（`return nativeName.slice(TOOL_PREFIX.length);`）で足し、`src/transcript.ts` の再 export に加える。「境界値: piToolName ...」のテストと import を `tests/unknown-tool.test.ts` に足し、`"write"` などのアサーションで失敗することを確かめる。正しい実装にして、そのテストを合格させる。
4. `src/stream.ts`・`src/tui-process.ts`・`src/claude-print-process.ts` を「ファイルごとの変更」のとおりに直す。`toolNames` を渡しているテストの6か所を消す。
5. `npm run check` と `npm test` を実行する（設計時の実測: 型検査は合格、219件中219件合格）。
6. `package.json`・`package-lock.json` を更新し、`README.md` を直す。もう一度 `npm test` と `npm run check` を実行する。
7. `grep -rn "unexpected tool\|unavailable tool\|outside Pi's current tool inventory\|toolNames" src` が何も出さないことを確かめる。
