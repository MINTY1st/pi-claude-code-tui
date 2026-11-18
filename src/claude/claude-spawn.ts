import { spawn, type ChildProcess } from "node:child_process";
import { envFlagEnabled } from "../shared/env.ts";

export function withConfigDirectory(env: Record<string, string | undefined>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) output[key] = value;
  if (output.PI_CLAUDE_CODE_CONFIG_DIR) output.CLAUDE_CONFIG_DIR = output.PI_CLAUDE_CODE_CONFIG_DIR;
  return output;
}

/** cmd.exe /s /c に渡すコマンド行。各引数を二重引用符で囲み、中の二重引用符は重ねる */
export function cmdCommandLine(command: string, commandArguments: string[]): string {
  const quote = (value: string) => `"${value.replace(/"/gu, '""')}"`;
  return [quote(command), ...commandArguments.map(quote)].join(" ");
}

export function spawnCommand(
  command: string,
  args: string[],
  options: Parameters<typeof spawn>[2],
): ChildProcess {
  if (process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(command)) {
    const comspec = options?.env?.COMSPEC || process.env.COMSPEC || "cmd.exe";
    return spawn(comspec, ["/d", "/s", "/c", cmdCommandLine(command, args)], options);
  }
  return spawn(command, args, options);
}

export function childExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) resolve(code);
      else reject(new Error(`Claude Code exited from signal ${signal ?? "unknown"}`));
    });
  });
}

export function killProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  killPidTree(child.pid);
}

/** pid のプロセスとその子を強制終了する。Windows は taskkill /T、それ以外はプロセスグループ（無ければ本人） */
export function killPidTree(pid: number): void {
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // It exited between the checks.
    }
  }
}

function conflictingEnvironment(env: Record<string, string>): string[] {
  const conflicts = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_FOUNDRY_API_KEY"].filter(
    (key) => !!env[key],
  );
  for (const key of ["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) {
    if (envFlagEnabled(env[key])) conflicts.push(key);
  }
  return conflicts;
}

// Claude Code 2.1.317 sends the redact-thinking-2026-02-12 beta unless showThinkingSummaries is true, and that beta
// strips the thinking text even when CLAUDE_CODE_EXTRA_BODY asks for display: "summarized".
export function claudeSettingsJson(extraBody: Record<string, unknown>): string {
  return JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(extraBody) }, showThinkingSummaries: true });
}

export function processEnvironment(
  input: Record<string, string | undefined> | undefined,
  extraBody: Record<string, unknown>,
): Record<string, string> {
  const env = withConfigDirectory({ ...process.env, ...input });
  const conflicts = conflictingEnvironment(env);
  if (conflicts.length) {
    throw new Error(`Claude Code subscription provider refuses conflicting auth/backend overrides: ${conflicts.join(", ")}`);
  }
  delete env.CLAUDE_CODE_EXTRA_BODY;
  Object.assign(env, {
    ENABLE_TOOL_SEARCH: "false",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_MAX_RETRIES: "0",
    DISABLE_AUTO_COMPACT: "1",
    DISABLE_COMPACT: "1",
    CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off",
    DISABLE_TELEMETRY: "1",
    DISABLE_ERROR_REPORTING: "1",
  });
  if (typeof extraBody.max_tokens === "number") env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(extraBody.max_tokens);
  return env;
}
