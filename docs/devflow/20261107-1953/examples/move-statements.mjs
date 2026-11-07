// 使い方: node docs/devflow/20261107-1953/examples/move-statements.mjs
// リポジトリの直下で実行する。HEAD の src/claude-cli.ts ではなく、作業木の src/claude-cli.ts を読み、
// structure.md「移す先の表」どおりに最上位の文を6つの新しいファイルへ書き出し、src/claude-cli.ts を再 export だけの入口に書き換える。
// 文は先頭のコメントごと1文字も変えずに写す。変えるのは EXPORT_ADDED の文の先頭に "export " を足すことだけである。
// 一度実行した後に再び実行すると、入口に移す文が無いため「元のファイルに無い表の名前」で止まり、何も書き出さない。
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const ts = createRequire(process.cwd() + "/package.json")("typescript");
const ENTRY = "src/claude-cli.ts";

// structure.md「移す先の表」と同じ内容。並びもこの順に書き出す。
const DESTINATION = {
  "src/claude-spawn.ts": [
    "withConfigDirectory", "spawnCommand", "childExit", "killProcessTree",
    "conflictingEnvironment", "claudeSettingsJson", "processEnvironment",
  ],
  "src/claude-executable.ts": [
    "INSTALL_HINT", "LOGIN_HINT", "ClaudeStatus", "configuredCommand", "executable", "resolveClaudeExecutable",
    "captureProcess", "getClaudeStatus", "READY_STATUS_TTL_MS", "readyStatusCache", "readyClaudeCommand",
  ],
  "src/claude-models.ts": ["isDiscoveredModel", "discoverClaudeModels"],
  "src/initial-request.ts": [
    "requestMessages", "deriveInitialUserPrefix", "deriveInitialSystemMessages", "contentText",
    "removeRepeatedUserReminders", "injectNativeSystemMessages", "normalizeLeadingSystemCache", "rewriteInitialRequest",
  ],
  "src/claude-print-process.ts": [
    "RunClaudeInput", "RunClaudeOutput", "AsyncQueue", "writeFrame", "nativeErrorText", "CLAUDE_PROCESS_MAX_AGE_MS",
    "ClaudeLaunchPlan", "canonicalJson", "digest", "frameHistoryHash", "launchPlan", "ClaudeProcess",
  ],
  "src/claude-print-cache.ts": [
    "MAX_CACHED_CLAUDE_PROCESSES", "AcquiredProcess", "processCache", "managerTail", "withManagerLock",
    "expireProcess", "discardProcess", "acquireProcess", "closeClaudeProcesses", "cachedClaudeProcessCount",
    "registerSessionResourceCleanup()", "runClaudeRequest",
  ],
};

// structure.md「export を足す名前」と同じ内容。別のファイルから使われるようになる名前だけである。
const EXPORT_ADDED = [
  "withConfigDirectory", "spawnCommand", "childExit", "configuredCommand",
  "deriveInitialUserPrefix", "deriveInitialSystemMessages", "ClaudeLaunchPlan", "launchPlan", "ClaudeProcess",
];

// structure.md「各ファイルの import 文」と同じ内容。
const IMPORTS = {
  "src/claude-spawn.ts": [
    'import { spawn, type ChildProcess } from "node:child_process";',
    'import { envFlagEnabled } from "./env.ts";',
  ],
  "src/claude-executable.ts": [
    'import { constants as fsConstants } from "node:fs";',
    'import { access } from "node:fs/promises";',
    'import { delimiter, extname, isAbsolute, join, resolve } from "node:path";',
    'import { childExit, killProcessTree, spawnCommand, withConfigDirectory } from "./claude-spawn.ts";',
  ],
  "src/claude-models.ts": [
    'import { createInterface } from "node:readline";',
    'import type { DiscoveredClaudeModel } from "./model-catalog.ts";',
    'import { childExit, killProcessTree, processEnvironment, spawnCommand } from "./claude-spawn.ts";',
    'import { INSTALL_HINT, resolveClaudeExecutable } from "./claude-executable.ts";',
  ],
  "src/initial-request.ts": [
    'import type { NativeSystemInjection } from "./transcript.ts";',
    'import { type NativeRequestMessage, setReplayCacheBreakpoints, withoutCacheControl } from "./cache-breakpoints.ts";',
  ],
  "src/claude-print-process.ts": [
    'import { createHash } from "node:crypto";',
    'import { mkdtemp, rm, writeFile } from "node:fs/promises";',
    'import { tmpdir } from "node:os";',
    'import { join, resolve } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    'import { createInterface } from "node:readline";',
    'import type { ChildProcess } from "node:child_process";',
    'import { incompleteUpstreamMessage } from "./relay-failure.ts";',
    'import { TurnRelay } from "./turn-relay.ts";',
    'import { usageCreditsAllowed, usageCreditsChargeError, type RateLimitInfo } from "./billing.ts";',
    'import type {',
    '  AnthropicStreamEvent,',
    '  NativeFrame,',
    '  NativeMessage,',
    '  NativeOutputEvent,',
    '  NativeResult,',
    '  NativeUsage,',
    '} from "./native-types.ts";',
    'import { TOOL_PREFIX, type NativeSystemInjection, type ToolManifestEntry } from "./transcript.ts";',
    'import { childExit, claudeSettingsJson, killProcessTree, processEnvironment, spawnCommand } from "./claude-spawn.ts";',
    'import { configuredCommand, readyClaudeCommand } from "./claude-executable.ts";',
    'import { deriveInitialSystemMessages, deriveInitialUserPrefix, rewriteInitialRequest } from "./initial-request.ts";',
  ],
  "src/claude-print-cache.ts": [
    'import { registerSessionResourceCleanup } from "@earendil-works/pi-ai";',
    'import {',
    '  ClaudeProcess,',
    '  launchPlan,',
    '  type ClaudeLaunchPlan,',
    '  type RunClaudeInput,',
    '  type RunClaudeOutput,',
    '} from "./claude-print-process.ts";',
  ],
};

// structure.md「入口の再 export」と同じ内容。
const ENTRY_TEXT = [
  'export { claudeSettingsJson, killProcessTree, processEnvironment } from "./claude-spawn.ts";',
  "export {",
  "  getClaudeStatus,",
  "  INSTALL_HINT,",
  "  LOGIN_HINT,",
  "  readyClaudeCommand,",
  "  resolveClaudeExecutable,",
  "  type ClaudeStatus,",
  '} from "./claude-executable.ts";',
  'export { discoverClaudeModels } from "./claude-models.ts";',
  'export { injectNativeSystemMessages, rewriteInitialRequest } from "./initial-request.ts";',
  'export type { RunClaudeInput, RunClaudeOutput } from "./claude-print-process.ts";',
  'export { cachedClaudeProcessCount, closeClaudeProcesses, runClaudeRequest } from "./claude-print-cache.ts";',
  "",
].join("\n");

function statementName(statement) {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((declaration) => declaration.name.getText()).join(",");
  }
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
    return statement.expression.expression.getText() + "()";
  }
  if (statement.name) return statement.name.text;
  throw new Error("名前を決められない文: " + statement.getText().slice(0, 80));
}

const text = readFileSync(ENTRY, "utf8");
const source = ts.createSourceFile(ENTRY, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const statements = new Map();
let index = 0;
for (const statement of source.statements) {
  if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) continue;
  statements.set(statementName(statement), { statement, index: index++ });
}
const listed = new Set(Object.values(DESTINATION).flat());
for (const name of statements.keys()) {
  if (!listed.has(name)) throw new Error("表に無い文: " + name);
}

// 元のファイルで隣り合っていた文どうしは、元の区切り（空行の数）をそのまま使う。
function chunk(name, previous) {
  const entry = statements.get(name);
  if (!entry) throw new Error("元のファイルに無い表の名前: " + name);
  const { statement } = entry;
  const full = statement.getFullText();
  const separator = full.match(/^\s*/u)[0];
  const leadingAndBody = full.slice(separator.length);
  const bodyOffset = statement.getStart() - statement.getFullStart() - separator.length;
  let result = leadingAndBody;
  if (EXPORT_ADDED.includes(name)) {
    result = leadingAndBody.slice(0, bodyOffset) + "export " + leadingAndBody.slice(bodyOffset);
  }
  const adjacent = previous !== undefined && statements.get(previous).index + 1 === entry.index;
  return (adjacent ? separator : "\n\n") + result;
}

for (const [file, names] of Object.entries(DESTINATION)) {
  let body = IMPORTS[file].join("\n");
  let previous;
  for (const name of names) {
    body += chunk(name, previous);
    previous = name;
  }
  writeFileSync(file, body + "\n", "utf8");
}
writeFileSync(ENTRY, ENTRY_TEXT, "utf8");
console.log("wrote " + Object.keys(DESTINATION).length + " files and rewrote " + ENTRY);
