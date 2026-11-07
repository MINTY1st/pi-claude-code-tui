// 使い方: node --experimental-transform-types docs/devflow/20261107-1953/examples/verify-move.mts [基準のコミット]
// 基準のコミット（既定は HEAD）の src/claude-cli.ts にある最上位の文が、structure.md の表どおりのファイルへ
// 1文字も変わらずに移ったか（export の付け外しだけは許す）、新しいファイルどうしの import が
// 決めた向きだけか、src/claude-cli.ts が再 export だけの入口になったかを確かめる。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const base = process.argv[2] ?? "HEAD";

// structure.md「移す先の表」と同じ内容。表を変えたらここも変える。
const DESTINATION: Record<string, string[]> = {
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

// 新しいファイルが import してよい新しいファイル（これ以外の向きは循環のもとになるため禁止）。
const ALLOWED_IMPORTS: Record<string, string[]> = {
  "src/claude-spawn.ts": [],
  "src/claude-executable.ts": ["src/claude-spawn.ts"],
  "src/claude-models.ts": ["src/claude-spawn.ts", "src/claude-executable.ts"],
  "src/initial-request.ts": [],
  "src/claude-print-process.ts": ["src/claude-spawn.ts", "src/claude-executable.ts", "src/initial-request.ts"],
  "src/claude-print-cache.ts": ["src/claude-print-process.ts"],
};

const ENTRY = "src/claude-cli.ts";
const errors: string[] = [];

function parse(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function statementName(statement: ts.Statement): string {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((declaration) => declaration.name.getText()).join(",");
  }
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
    return statement.expression.expression.getText() + "()";
  }
  const named = statement as ts.Statement & { name?: ts.Identifier };
  if (named.name) return named.name.text;
  throw new Error("名前を決められない文: " + statement.getText().slice(0, 80));
}

function isExported(statement: ts.Statement): boolean {
  return !!ts.canHaveModifiers(statement) &&
    !!ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

// 先頭のコメント（JSDoc と // の行）を含めた文の全文から、宣言の直前の export だけを取り除いて比べる。
function normalized(statement: ts.Statement): string {
  const full = statement.getFullText().trim();
  const body = statement.getText();
  const leading = full.slice(0, full.length - body.length);
  return leading + body.replace(/^export /u, "");
}

function topLevel(source: ts.SourceFile): Map<string, ts.Statement> {
  const map = new Map<string, ts.Statement>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) continue;
    map.set(statementName(statement), statement);
  }
  return map;
}

const original = parse(ENTRY, execFileSync("git", ["show", base + ":" + ENTRY], { encoding: "utf8" }));
const originalStatements = topLevel(original);
const originalExports = [...originalStatements].filter(([, s]) => isExported(s)).map(([name]) => name);

const expected = new Map<string, string>();
for (const [file, names] of Object.entries(DESTINATION)) for (const name of names) expected.set(name, file);
for (const name of originalStatements.keys()) {
  if (!expected.has(name)) errors.push("表に無い元の文: " + name);
}
for (const name of expected.keys()) {
  if (!originalStatements.has(name)) errors.push("元のファイルに無い表の名前: " + name);
}

for (const [file, names] of Object.entries(DESTINATION)) {
  let source: ts.SourceFile;
  try {
    source = parse(file, readFileSync(file, "utf8"));
  } catch {
    errors.push("ファイルが無い: " + file);
    continue;
  }
  const moved = topLevel(source);
  const order = [...moved.keys()];
  if (JSON.stringify(order) !== JSON.stringify(names)) {
    errors.push(file + " の文の並びが表と違う: " + JSON.stringify(order));
  }
  for (const name of names) {
    const before = originalStatements.get(name);
    const after = moved.get(name);
    if (!before || !after) continue;
    if (normalized(before) !== normalized(after)) errors.push(name + " の中身が元と違う（" + file + "）");
  }
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    if (!specifier.startsWith("./")) continue;
    const target = "src/" + specifier.slice(2);
    if (target in DESTINATION && !ALLOWED_IMPORTS[file].includes(target)) {
      errors.push(file + " が " + target + " を import している（決めた向きではない）");
    }
    if (target === ENTRY) errors.push(file + " が入口の " + ENTRY + " を import している（循環する）");
  }
}

const entry = parse(ENTRY, readFileSync(ENTRY, "utf8"));
const reexported: string[] = [];
for (const statement of entry.statements) {
  if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !statement.exportClause) {
    errors.push(ENTRY + " に再 export 以外の文がある: " + statement.getText().slice(0, 80));
    continue;
  }
  if (ts.isNamedExports(statement.exportClause)) {
    for (const element of statement.exportClause.elements) reexported.push(element.name.text);
  }
}
for (const name of originalExports) {
  if (!reexported.includes(name)) errors.push(ENTRY + " が再 export していない: " + name);
}
for (const name of reexported) {
  if (!originalExports.includes(name)) errors.push(ENTRY + " が元に無い名前を再 export している: " + name);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("ok: " + originalStatements.size + " 文を照合し、" + reexported.length + " 個の名前の再 export を確かめた");
