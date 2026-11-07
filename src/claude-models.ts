import { createInterface } from "node:readline";
import type { DiscoveredClaudeModel } from "./model-catalog.ts";
import { childExit, killProcessTree, processEnvironment, spawnCommand } from "./claude-spawn.ts";
import { INSTALL_HINT, resolveClaudeExecutable } from "./claude-executable.ts";

function isDiscoveredModel(value: unknown): value is DiscoveredClaudeModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<DiscoveredClaudeModel>;
  return (
    typeof model.value === "string" &&
    typeof model.displayName === "string" &&
    typeof model.description === "string" &&
    (model.resolvedModel === undefined || typeof model.resolvedModel === "string")
  );
}

/** Ask the installed Claude Code process for the account's selectable model catalog. */
export async function discoverClaudeModels(
  envInput: Record<string, string | undefined> = process.env,
  signal?: AbortSignal,
  timeoutMs = 20_000,
): Promise<DiscoveredClaudeModel[]> {
  signal?.throwIfAborted();
  const env = processEnvironment(envInput, {});
  const command = await resolveClaudeExecutable(env);
  if (!command) throw new Error(INSTALL_HINT);

  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "default",
    "--tools",
    "",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
  ];
  const child = spawnCommand(command, args, {
    cwd: process.cwd(),
    env,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-65_536)));

  const abort = () => killProcessTree(child);
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcessTree(child);
  }, timeoutMs);

  const requestId = `pi-models-${Date.now()}`;
  child.stdin?.write(
    `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "initialize" } })}\n`,
  );
  child.stdin?.end(
    `${JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "model-catalog-probe" }] },
      shouldQuery: false,
    })}\n`,
  );

  let models: DiscoveredClaudeModel[] | undefined;
  try {
    const reader = createInterface({ input: child.stdout!, crlfDelay: Infinity });
    for await (const line of reader) {
      if (!line.trim()) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.type !== "control_response") continue;
      const envelope = event.response as Record<string, unknown> | undefined;
      if (envelope?.request_id !== requestId || envelope.subtype !== "success") continue;
      const response = envelope.response as Record<string, unknown> | undefined;
      if (Array.isArray(response?.models)) models = response.models.filter(isDiscoveredModel);
    }
    const exitCode = await childExit(child);
    signal?.throwIfAborted();
    if (timedOut) throw new Error("Claude Code model discovery timed out");
    if (exitCode !== 0) throw new Error(`Claude Code model discovery failed${stderr ? `: ${stderr.trim().slice(-500)}` : ""}`);
    if (!models?.length) throw new Error("Claude Code returned no selectable models");
    return models;
  } catch (error) {
    if (timedOut) throw new Error("Claude Code model discovery timed out", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (child.exitCode === null) killProcessTree(child);
  }
}
