import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import { capturedMessage, completeUsage } from "./response-checks.ts";
import { TurnRelay } from "./turn-relay.ts";
import { guardUsageCredits, type RateLimitInfo } from "./billing.ts";
import type {
  AnthropicStreamEvent,
  NativeFrame,
  NativeMessage,
  NativeOutputEvent,
  NativeResult,
  NativeUsage,
} from "./native-types.ts";
import type { NativeSystemInjection, ToolManifestEntry } from "./transcript.ts";
import { childExit, claudeSettingsJson, killProcessTree, processEnvironment, spawnCommand } from "./claude-spawn.ts";
import { configuredCommand, readyClaudeCommand } from "./claude-executable.ts";
import { deriveInitialSystemMessages, deriveInitialUserPrefix, rewriteInitialRequest } from "./initial-request.ts";

export interface RunClaudeInput {
  model: string;
  /** Working directory exposed to Claude and used for Pi tool paths. */
  cwd?: string;
  frames: NativeFrame[];
  systemPrompt: string;
  manifest: ToolManifestEntry[];
  extraBody: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  upstreamUrl?: string;
  /** Native blocks Claude Code injected ahead of the first canonical user message. */
  initialUserPrefix?: unknown[];
  /** Native system messages Claude Code injected immediately after that user message. */
  initialSystemMessages?: unknown[];
  /** Pi system/tool deltas to restore at their historical assistant boundaries. */
  nativeSystemInjections?: NativeSystemInjection[];
  /** Beta features appended to Claude Code's own request header by the turn relay. */
  betas?: string[];
  onEvent?: (event: AnthropicStreamEvent) => void;
  /** Pi session whose linear continuation may reuse a warm Claude process. */
  sessionId?: string;
}

export interface RunClaudeOutput {
  message: NativeMessage;
  result: NativeResult;
  usage: NativeUsage;
  exitCode: number;
  relay: {
    upstreamRequests: number;
    blockedRequests: number;
    requestId?: string;
  };
  initialUserPrefix?: unknown[];
  initialSystemMessages?: unknown[];
  /** Latest plan-limit status Claude Code reported for this turn. */
  rateLimit?: RateLimitInfo;
}

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;
  private failure?: Error;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  end(error?: Error): void {
    this.ended = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  async next(signal: AbortSignal | undefined, timeoutMs: number): Promise<T | undefined> {
    if (this.values.length) return this.values.shift();
    if (this.ended) {
      if (this.failure) throw this.failure;
      return undefined;
    }
    signal?.throwIfAborted();

    return new Promise<T | undefined>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        fn();
      };
      const waiter = (item: IteratorResult<T>) =>
        finish(() => {
          if (item.done && this.failure) reject(this.failure);
          else resolve(item.done ? undefined : item.value);
        });
      const onAbort = () => finish(() => reject(signal?.reason ?? new Error("Claude Code request aborted")));
      const timer = setTimeout(() => finish(() => reject(new Error("Claude Code stream timed out"))), timeoutMs);
      this.waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

async function writeFrame(child: ChildProcess, frame: NativeFrame): Promise<void> {
  if (!child.stdin?.writable) throw new Error("Claude Code stdin closed during history replay");
  if (!child.stdin.write(`${JSON.stringify(frame)}\n`)) {
    await new Promise<void>((resolve, reject) => {
      child.stdin!.once("drain", resolve);
      child.stdin!.once("error", reject);
    });
  }
}

function nativeErrorText(event: Extract<NativeOutputEvent, { type: "assistant" }>): string | undefined {
  const messageError = (event.message as Record<string, unknown>).error;
  if (!event.error && !messageError) return undefined;
  return event.message.content
    .filter((block): block is Extract<(typeof event.message.content)[number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

const CLAUDE_PROCESS_MAX_AGE_MS = 5 * 60 * 1_000;

export interface ClaudeLaunchPlan {
  env: Record<string, string>;
  fingerprint: string;
  timeoutMs: number;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function frameHistoryHash(frames: NativeFrame[]): string {
  return digest(
    frames.map((frame) => ({
      type: frame.type,
      message: frame.message,
    })),
  );
}

export function launchPlan(input: RunClaudeInput): ClaudeLaunchPlan {
  const timeoutMs = input.timeoutMs ?? 180_000;
  const env = processEnvironment(input.env, input.extraBody);
  return {
    env,
    timeoutMs,
    fingerprint: digest({
      command: configuredCommand(env),
      cwd: resolve(input.cwd ?? process.cwd()),
      env,
      extraBody: input.extraBody,
      manifest: input.manifest,
      model: input.model,
      systemPrompt: input.systemPrompt,
      timeoutMs,
      upstreamUrl: input.upstreamUrl ?? "https://api.anthropic.com",
    }),
  };
}

export class ClaudeProcess {
  busy = false;
  readonly createdAt = Date.now();
  lastUsed = this.createdAt;

  private tipHash?: string;
  private expiryTimer?: NodeJS.Timeout;
  private closed = false;
  private stderr = "";

  private constructor(
    readonly fingerprint: string,
    private readonly root: string,
    private readonly child: ChildProcess,
    private readonly relay: TurnRelay,
    private readonly queue: AsyncQueue<NativeOutputEvent>,
    private readonly readTask: Promise<void>,
    private readonly exitOutcome: Promise<{ code?: number; error?: Error }>,
    private readonly timeoutMs: number,
  ) {
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-65_536)));
  }

  static async create(input: RunClaudeInput, plan: ClaudeLaunchPlan): Promise<ClaudeProcess> {
    input.signal?.throwIfAborted();
    const command = await readyClaudeCommand({ ...process.env, ...input.env }, input.signal);

    const root = await mkdtemp(join(tmpdir(), "pi-claude-code-"));
    const toolsPath = join(root, "tools.json");
    const settingsPath = join(root, "settings.json");
    const systemPath = join(root, "system.md");
    const inertMcpPath = fileURLToPath(new URL("./inert-mcp.mjs", import.meta.url));
    let child: ChildProcess | undefined;
    let relay: TurnRelay | undefined;

    try {
      await Promise.all([
        writeFile(toolsPath, JSON.stringify(input.manifest), "utf8"),
        writeFile(settingsPath, claudeSettingsJson(input.extraBody), "utf8"),
        writeFile(systemPath, input.systemPrompt, "utf8"),
      ]);

      relay = new TurnRelay(input.upstreamUrl ?? "https://api.anthropic.com");
      const env = { ...plan.env, ANTHROPIC_BASE_URL: await relay.start() };
      const mcp = {
        mcpServers: {
          pi: { command: process.execPath, args: [inertMcpPath, toolsPath] },
        },
      };
      const args = [
        "-p",
        "--model",
        input.model,
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "",
        "--system-prompt-file",
        systemPath,
        "--settings",
        settingsPath,
        "--setting-sources",
        "",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--max-turns",
        "1",
        "--permission-mode",
        "dontAsk",
        "--no-session-persistence",
        "--mcp-config",
        JSON.stringify(mcp),
      ];

      child = spawnCommand(command, args, {
        // Claude Code tells the model its process cwd. Keep transport files
        // private while exposing Pi's real working directory to the model.
        cwd: input.cwd ?? process.cwd(),
        env,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const queue = new AsyncQueue<NativeOutputEvent>();
      const reader = createInterface({ input: child.stdout!, crlfDelay: Infinity });
      const readTask = (async () => {
        try {
          for await (const line of reader) {
            if (!line.trim()) continue;
            try {
              queue.push(JSON.parse(line) as NativeOutputEvent);
            } catch (error) {
              throw new Error(`Invalid Claude Code stream-json output: ${line.slice(0, 300)}`, { cause: error });
            }
          }
          queue.end();
        } catch (error) {
          queue.end(error instanceof Error ? error : new Error(String(error)));
        }
      })();
      const exitOutcome = childExit(child).then(
        (code) => ({ code }),
        (error: unknown) => ({ error: error instanceof Error ? error : new Error(String(error)) }),
      );
      return new ClaudeProcess(plan.fingerprint, root, child, relay, queue, readTask, exitOutcome, plan.timeoutMs);
    } catch (error) {
      relay?.abort();
      if (child && child.exitCode === null) killProcessTree(child);
      await relay?.close();
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }

  isAlive(): boolean {
    return !this.closed && this.child.exitCode === null && !!this.child.stdin?.writable;
  }

  isExpired(now = Date.now()): boolean {
    return now - this.createdAt >= CLAUDE_PROCESS_MAX_AGE_MS;
  }

  canContinue(input: RunClaudeInput): boolean {
    if (!this.tipHash || input.frames.length === 0) return false;
    return frameHistoryHash(input.frames.slice(0, -1)) === this.tipHash;
  }

  clearExpiryTimer(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
  }

  /** Mark the worker idle and schedule its close for the end of its lifetime. */
  armExpiryTimer(expire: () => void): void {
    this.clearExpiryTimer();
    this.lastUsed = Date.now();
    const remainingLifetime = CLAUDE_PROCESS_MAX_AGE_MS - (this.lastUsed - this.createdAt);
    this.expiryTimer = setTimeout(expire, Math.max(0, remainingLifetime));
    this.expiryTimer.unref?.();
  }

  commit(input: RunClaudeInput, message: NativeMessage): boolean {
    // Claude Code executes MCP calls internally before emitting its max-turns
    // result. Our inert MCP response is therefore part of its hidden history,
    // while Pi will append the real tool result. That state is not a faithful
    // continuation and must be discarded; the next request replays from Pi.
    if (message.content.some((block) => block.type === "tool_use")) {
      this.tipHash = undefined;
      return false;
    }
    this.tipHash = frameHistoryHash([
      ...input.frames,
      { type: "assistant", message: { role: "assistant", content: message.content } },
    ]);
    return true;
  }

  async run(input: RunClaudeInput, continuation: boolean): Promise<RunClaudeOutput> {
    if (!this.isAlive()) throw new Error("Claude Code process is no longer available");
    input.signal?.throwIfAborted();

    let sawMessageStop = false;
    const deliver = (event: AnthropicStreamEvent) => {
      if (event.type === "message_stop") sawMessageStop = true;
      input.onEvent?.(event);
    };
    const canonicalInitialUser = input.frames.find((frame) => frame.type === "user")?.message.content ?? [];
    this.relay.beginTurn(
      deliver,
      input.initialUserPrefix || input.initialSystemMessages || input.nativeSystemInjections
        ? (body) =>
            rewriteInitialRequest(
              body,
              input.initialUserPrefix,
              canonicalInitialUser,
              input.initialSystemMessages,
              input.nativeSystemInjections,
            )
        : undefined,
      input.betas,
    );

    const abort = () => {
      this.relay.abort();
      this.closeNow();
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    const assistants: NativeMessage[] = [];
    let result: NativeResult | undefined;
    let nativeError: string | undefined;
    let rateLimit: RateLimitInfo | undefined;

    try {
      const frames = continuation ? input.frames.slice(-1) : input.frames;
      for (const frame of frames) {
        await writeFrame(this.child, frame);
        if (frame.shouldQuery === false) {
          for (;;) {
            const event = await this.queue.next(input.signal, this.timeoutMs);
            if (!event) throw await this.exitError("Claude Code exited before acknowledging history replay");
            if (event.type === "result") {
              if (event.num_turns !== 0 || event.is_error) {
                throw new Error("Claude Code rejected zero-turn history replay");
              }
              break;
            }
          }
        }
      }

      for (;;) {
        const event = await this.queue.next(input.signal, this.timeoutMs);
        if (!event) throw await this.exitError("Claude Code exited before completing its response");
        if (event.type === "assistant") {
          const error = nativeErrorText(event);
          if (error !== undefined) nativeError = error;
          else assistants.push(event.message);
        } else if (event.type === "result") {
          result = event;
          break;
        } else if (event.type === "rate_limit_event") {
          if (event.rate_limit_info && typeof event.rate_limit_info === "object") rateLimit = event.rate_limit_info;
        } else if (event.type === "stream_event" && !this.relay.used) {
          deliver(event.event);
        }
      }
      await this.relay.settled();
      input.signal?.throwIfAborted();

      let message: NativeMessage | undefined;
      if (this.relay.used) {
        message = capturedMessage(this.relay);
        sawMessageStop = true;
      } else {
        message = assistants.at(-1);
      }

      if (!message || !sawMessageStop || !result) {
        throw new Error(
          `Incomplete Claude Code response: assistant, message_stop and one result required${this.stderr ? ` (${this.stderr.trim().slice(-500)})` : ""}`,
        );
      }

      const nativeFailureHandled = this.relay.denied > 0 || message.stop_reason === "refusal";
      if (nativeError && !nativeFailureHandled) throw new Error(`Claude Code API error: ${nativeError}`);
      const hasTools = message.content.some((block) => block.type === "tool_use");
      const maxTurnsBoundary = hasTools && result.subtype === "error_max_turns";
      if (!maxTurnsBoundary && !nativeFailureHandled && (result.is_error || result.subtype !== "success")) {
        throw new Error(`Claude Code request failed: ${result.subtype ?? "unknown result"}`);
      }

      const usage = completeUsage(message.usage ?? result.usage);

      // The response is already charged at this point, but stopping here keeps
      // Pi's agent loop from issuing more requests against usage credits.
      guardUsageCredits(rateLimit, { ...process.env, ...input.env });

      return {
        message,
        result,
        usage,
        exitCode: this.child.exitCode ?? 0,
        relay: {
          upstreamRequests: Number(this.relay.used),
          blockedRequests: this.relay.denied,
          requestId: this.relay.requestId,
        },
        initialUserPrefix:
          input.initialUserPrefix ?? deriveInitialUserPrefix(this.relay.originalRequestBody, canonicalInitialUser),
        initialSystemMessages:
          input.initialSystemMessages ?? deriveInitialSystemMessages(this.relay.originalRequestBody),
        rateLimit,
      };
    } finally {
      input.signal?.removeEventListener("abort", abort);
      this.relay.finishTurn();
    }
  }

  async close(): Promise<void> {
    this.closeNow();
    await Promise.allSettled([this.readTask, this.exitOutcome, this.relay.close()]);
    await rm(this.root, { recursive: true, force: true });
  }

  private closeNow(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearExpiryTimer();
    this.relay.abort();
    if (this.child.exitCode === null) killProcessTree(this.child);
  }

  private async exitError(fallback: string): Promise<Error> {
    const outcome = await this.exitOutcome;
    if (outcome.error) return outcome.error;
    const detail = this.stderr.trim().slice(-500);
    return new Error(`${fallback} (exit ${outcome.code ?? "unknown"}${detail ? `: ${detail}` : ""})`);
  }
}
