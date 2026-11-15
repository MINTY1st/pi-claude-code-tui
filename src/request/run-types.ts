import type { RateLimitInfo } from "../shared/billing.ts";
import type {
  AnthropicStreamEvent,
  NativeFrame,
  NativeMessage,
  NativeResult,
  NativeUsage,
} from "../shared/native-types.ts";
import type { NativeSystemInjection, ToolManifestEntry } from "./transcript.ts";

/** TUI と print の両方の経路が受け取る、1回の呼び出しの入力と出力 */
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
