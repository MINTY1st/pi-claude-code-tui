import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { registerSessionResourceCleanup } from "@earendil-works/pi-ai";
import { usageCreditsAllowed, usageCreditsChargeError } from "./billing.ts";
import { processEnvironment, readyClaudeCommand, type RunClaudeInput, type RunClaudeOutput } from "./claude-cli.ts";
import { envFlagEnabled } from "./env.ts";
import type { AnthropicStreamEvent, NativeMessage, NativeResult } from "./native-types.ts";
import { TuiSession } from "./pty-session.ts";
import { TOOL_PREFIX } from "./transcript.ts";
import { initialContext, replaceTranscript } from "./tui-transcript.ts";
import { TurnRelay } from "./turn-relay.ts";
import { abortTuiRequests, trackTuiRequest } from "./tui-lifecycle.ts";

export const TUI_MODE_ENV = "PI_CLAUDE_CODE_TUI";
export const TUI_TRUST_ENV = "PI_CLAUDE_CODE_TUI_TRUST";

// 貼る文は relay が Pi の会話に差し替えるので、1回分のリクエストを起こすきっかけでしかない
const TRIGGER = "continue";
const DEFAULT_TIMEOUT_MS = 180_000;
const CLEAR_TIMEOUT_MS = 15_000;
// 起動に2〜7秒かかるため、-p 版（5分）より長く残す
const IDLE_LIFETIME_MS = 15 * 60 * 1_000;
const MAX_CACHED = 2;
// 親が Claude Code や SDK だとこれらが引き継がれ、entrypoint が cli でなくなるか、セッションの記録が混ざる
const PARENT_SESSION_VARIABLES = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_EXECPATH", "CLAUDE_PID"];
const INERT_MCP_PATH = fileURLToPath(new URL("./inert-mcp.mjs", import.meta.url));

/** 既定は対話 TUI。PI_CLAUDE_CODE_TUI=0 で従来の claude -p に戻す */
export function tuiModeEnabled(env: Record<string, string | undefined>): boolean {
  return env[TUI_MODE_ENV] !== "0";
}

export function tuiArgs(input: { model: string; mcpConfig: string; settingsPath: string }): string[] {
  return [
    "--model", input.model,
    "--tools", "",
    "--settings", input.settingsPath,
    "--setting-sources", "",
    "--strict-mcp-config",
    "--mcp-config", input.mcpConfig,
    "--allowedTools", "mcp__pi",
    "--permission-mode", "default",
  ];
}

export function tuiEnvironment(env: Record<string, string | undefined>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !PARENT_SESSION_VARIABLES.includes(key)) output[key] = value;
  }
  return output;
}

function fingerprint(input: RunClaudeInput, env: Record<string, string>): string {
  const material = { cwd: resolve(input.cwd ?? process.cwd()), env, extraBody: input.extraBody, manifest: input.manifest, model: input.model, systemPrompt: input.systemPrompt, timeoutMs: input.timeoutMs, upstreamUrl: input.upstreamUrl };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function assertCompleteCapture(relay: TurnRelay): NativeMessage {
  if (!relay.used) throw new Error("Claude Code's interactive mode sent no request for the turn");
  if (relay.status === 200 && relay.capture.complete && relay.capture.message) return relay.capture.message;
  let detail = `status ${relay.status ?? "unknown"}, capture ${relay.capture.complete ? "complete" : "incomplete"}`;
  if (relay.failure) detail += `, relay failure ${relay.failure}`;
  const upstreamError = relay.errorText();
  if (upstreamError) detail += `, upstream said: ${upstreamError.slice(0, 500)}`;
  throw new Error(`Incomplete Claude Code upstream response (${detail})`);
}

function assertKnownTools(message: NativeMessage, toolNames: Set<string>): void {
  for (const block of message.content) {
    if (block.type !== "tool_use") continue;
    if (!block.name.startsWith(TOOL_PREFIX) || !toolNames.has(block.name.slice(TOOL_PREFIX.length))) {
      throw new Error("Claude Code returned a tool outside Pi's current tool inventory");
    }
  }
}

class TuiWorker {
  busy = false;
  lastUsed = Date.now();
  private pendingClear?: Promise<void>;
  private broken = false;
  private expiryTimer?: NodeJS.Timeout;
  private closing?: Promise<void>;

  private constructor(readonly fingerprint: string, private readonly root: string, private readonly relay: TurnRelay, private readonly session: TuiSession) {}

  static async create(input: RunClaudeInput, env: Record<string, string>, print: string): Promise<TuiWorker> {
    const command = await readyClaudeCommand({ ...process.env, ...input.env }, input.signal);
    const root = await mkdtemp(join(tmpdir(), "pi-claude-code-tui-"));
    const relay = new TurnRelay(input.upstreamUrl ?? "https://api.anthropic.com", input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let session: TuiSession | undefined;
    try {
      const paths = { tools: join(root, "tools.json"), settings: join(root, "settings.json"), listed: join(root, "listed") };
      await Promise.all([
        writeFile(paths.tools, JSON.stringify(input.manifest), "utf8"),
        writeFile(paths.settings, JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(input.extraBody) } }), "utf8"),
      ]);
      const mcpConfig = JSON.stringify({ mcpServers: { pi: { command: process.execPath, args: [INERT_MCP_PATH, paths.tools, paths.listed] } } });
      session = TuiSession.start({
        command,
        args: tuiArgs({ model: input.model, mcpConfig, settingsPath: paths.settings }),
        cwd: input.cwd ?? process.cwd(),
        env: tuiEnvironment({ ...env, ANTHROPIC_BASE_URL: await relay.start() }),
        listedMarker: paths.listed,
        trustFolder: envFlagEnabled(env[TUI_TRUST_ENV]),
        readyTimeoutMs: input.timeoutMs,
      });
      await session.ready(input.signal);
      return new TuiWorker(print, root, relay, session);
    } catch (error) {
      await session?.close();
      await relay.close();
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  release(sessionId: string): void {
    this.busy = false;
    this.expiryTimer = setTimeout(() => {
      if (workers.get(sessionId) === this) workers.delete(sessionId);
      void this.close().catch(() => undefined);
    }, IDLE_LIFETIME_MS);
    this.expiryTimer.unref();
  }

  reserve(): void {
    clearTimeout(this.expiryTimer);
    this.busy = true;
  }

  usable(print: string): boolean {
    return !this.busy && !this.broken && this.session.isAlive() && this.fingerprint === print && Date.now() - this.lastUsed < IDLE_LIFETIME_MS;
  }

  async run(input: RunClaudeInput): Promise<RunClaudeOutput> {
    input.signal?.throwIfAborted();
    await this.pendingClear;
    input.signal?.throwIfAborted();
    if (this.broken) throw new Error("Claude Code's interactive mode did not come back from /clear");
    const deliver = (event: AnthropicStreamEvent) => input.onEvent?.(event);
    const pinned = { userPrefix: input.initialUserPrefix, systemMessages: input.initialSystemMessages };
    this.relay.beginTurn(deliver, (body) => replaceTranscript(body, input.frames, input.systemPrompt, input.nativeSystemInjections, pinned), input.betas);
    const abort = () => void this.close();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      await this.session.submit(TRIGGER);
      await this.session.waitIdle(input.timeoutMs ?? DEFAULT_TIMEOUT_MS, () => this.relay.lastActivityAt);
      await this.relay.settled();
      input.signal?.throwIfAborted();
      return this.output(input);
    } finally {
      input.signal?.removeEventListener("abort", abort);
      this.relay.finishTurn();
      this.lastUsed = Date.now();
      // 次のターンまでに TUI 側の履歴を空にしておく（Pi がツールを実行している間に済ませる）
      this.pendingClear = this.session.clear(CLEAR_TIMEOUT_MS).catch(() => void (this.broken = true));
    }
  }

  private output(input: RunClaudeInput): RunClaudeOutput {
    const message = assertCompleteCapture(this.relay);
    assertKnownTools(message, input.toolNames);
    const usage = message.usage;
    if (!usage || typeof usage.input_tokens !== "number" || typeof usage.output_tokens !== "number") {
      throw new Error("Claude Code response did not include complete token usage");
    }
    const rateLimit = this.relay.rateLimit;
    if (rateLimit?.isUsingOverage === true && !usageCreditsAllowed({ ...process.env, ...input.env })) throw usageCreditsChargeError(rateLimit);
    const result: NativeResult = { type: "result", subtype: "success", is_error: false, num_turns: 1, usage };
    const initial = this.relay.originalRequestBody ? initialContext(this.relay.originalRequestBody) : undefined;
    return {
      message,
      result,
      usage,
      exitCode: 0,
      relay: { upstreamRequests: Number(this.relay.used), blockedRequests: this.relay.denied, requestId: this.relay.requestId },
      initialUserPrefix: input.initialUserPrefix ?? initial?.userPrefix,
      initialSystemMessages: input.initialSystemMessages ?? initial?.systemMessages,
      rateLimit,
    };
  }

  close(): Promise<void> {
    return this.closing ??= this.dispose();
  }

  private async dispose(): Promise<void> {
    clearTimeout(this.expiryTimer);
    this.broken = true;
    this.relay.abort();
    await this.session.close();
    await this.relay.close();
    await rm(this.root, { recursive: true, force: true });
  }
}

const workers = new Map<string, TuiWorker>();

async function acquire(input: RunClaudeInput, env: Record<string, string>): Promise<{ worker: TuiWorker; retained: boolean }> {
  const print = fingerprint(input, env);
  const cached = input.sessionId ? workers.get(input.sessionId) : undefined;
  if (cached?.usable(print)) {
    cached.reserve();
    return { worker: cached, retained: true };
  }
  if (cached && !cached.busy) {
    workers.delete(input.sessionId!);
    await cached.close();
  }
  const worker = await TuiWorker.create(input, env, print);
  worker.reserve();
  // 並行したリクエストや Pi のセッション ID が無いリクエストは、使い捨てのプロセスで受ける
  const retained = !!input.sessionId && !workers.has(input.sessionId) && workers.size < MAX_CACHED;
  if (retained) workers.set(input.sessionId!, worker);
  return { worker, retained };
}

export function runTuiRequest(input: RunClaudeInput): Promise<RunClaudeOutput> {
  return trackTuiRequest(input.sessionId, input.signal, (signal) => runTrackedRequest({ ...input, signal }));
}

async function runTrackedRequest(input: RunClaudeInput): Promise<RunClaudeOutput> {
  input.signal?.throwIfAborted();
  const env = processEnvironment(input.env, input.extraBody);
  const { worker, retained } = await acquire(input, env);
  try {
    const output = await worker.run(input);
    if (retained) worker.release(input.sessionId!);
    else await worker.close();
    return output;
  } catch (error) {
    if (input.sessionId && workers.get(input.sessionId) === worker) workers.delete(input.sessionId);
    await worker.close();
    throw error;
  }
}

export async function closeTuiProcesses(sessionId?: string): Promise<void> {
  const pending = abortTuiRequests(sessionId);
  const targets = sessionId ? [workers.get(sessionId)].filter((worker): worker is TuiWorker => !!worker) : [...workers.values()];
  if (sessionId) workers.delete(sessionId);
  else workers.clear();
  await Promise.allSettled(targets.map((worker) => worker.close()));
  await pending;
}

registerSessionResourceCleanup((sessionId) => {
  void closeTuiProcesses(sessionId);
});
