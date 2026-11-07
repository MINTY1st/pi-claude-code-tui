// thinking オフの本文を Claude Code 経由で実機に1回送り、成否を1行の JSON で出す。
// 使い方:
//   node --experimental-transform-types docs/devflow/20261107-1406/examples/probe-thinking-off.mts <modelId> <disabled|between_tools|between_tools-no-cm|current>
//   current は src/tool-config.ts の buildExtraBody(modelId, [], {}) の出力をそのまま送る（実装後の確認用）
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processEnvironment } from "../../../../src/claude-cli.ts";
import { buildExtraBody } from "../../../../src/tool-config.ts";

const [modelId, mode] = process.argv.slice(2);
if (!modelId || !mode) throw new Error("usage: probe-thinking-off.mts <modelId> <disabled|between_tools|between_tools-no-cm|current>");

function bodyFor(kind: string): Record<string, unknown> {
  if (kind === "current") return buildExtraBody(modelId, [], {});
  if (kind === "disabled") return { tools: [], thinking: { type: "disabled" }, context_management: { edits: [] } };
  if (kind === "between_tools") return { tools: [], thinking: { type: "between_tools" }, context_management: { edits: [] } };
  if (kind === "between_tools-no-cm") return { tools: [], thinking: { type: "between_tools" } };
  throw new Error(`unknown mode: ${kind}`);
}

const body = bodyFor(mode);
const root = await mkdtemp(join(tmpdir(), "probe-thinking-off-"));
const settingsPath = join(root, "settings.json");
await writeFile(settingsPath, JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(body) } }), "utf8");
const env = processEnvironment(process.env, body);
const args = [
  "-p", "--model", modelId, "--output-format", "stream-json", "--verbose",
  "--tools", "", "--settings", settingsPath, "--setting-sources", "",
  "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
  "--disable-slash-commands", "--max-turns", "1", "--permission-mode", "dontAsk",
  "--no-session-persistence", "Reply with exactly: OK",
];
const child = spawn(env.CLAUDE_CODE_PATH || "claude", args, { env, cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk));
child.stderr.on("data", (chunk) => (stderr += chunk));
const code: number = await new Promise((done) => child.on("close", (c) => done(c ?? -1)));
await rm(root, { recursive: true, force: true });

const events = stdout.split("\n").filter((line) => line.trim()).map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } });
const contentTypes = events
  .filter((event) => event.type === "assistant")
  .flatMap((event) => (event.message?.content ?? []).map((block: { type: string }) => block.type));
const result = events.find((event) => event.type === "result");
console.log(JSON.stringify({
  modelId, mode, sent: { thinking: body.thinking, context_management: body.context_management },
  exitCode: code, isError: result?.is_error ?? null, apiError: result?.is_error ? String(result?.result ?? "").slice(0, 400) : undefined,
  text: result?.is_error ? undefined : String(result?.result ?? "").slice(0, 80), contentTypes,
  stderr: stderr.trim() ? stderr.trim().slice(-300) : undefined,
}));
