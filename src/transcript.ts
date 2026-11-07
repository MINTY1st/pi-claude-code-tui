import {
  getDeclaredTools,
  getInitialSystemMessage,
  hasToolRedefinitions,
  type AssistantMessage,
  type ImageContent,
  type Message,
  type TextContent,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { nativeSystemBlocks, prepareTools, sanitizeSurrogates, TOOL_PREFIX } from "./tool-config.ts";
export { buildExtraBody, normalizeInputSchema, piToolName, prepareTools, TOOL_PREFIX, type ToolManifestEntry } from "./tool-config.ts";
import { normalizeFrameToolIds } from "./tool-call-ids.ts";
import { withoutForeignThinking } from "./thinking-replay.ts";
import type { NativeContentBlock, NativeFrame, NativeMessage } from "./native-types.ts";

export const NATIVE_REPLAY_DIAGNOSTIC = "claude-code.native-assistant.v1";
export const NATIVE_TOOL_CHANGES_BETA = "mid-conversation-tool-changes-2026-07-01";

const DEFERRED_TOOL_PLACEHOLDER = {
  name: "__pi_deferred_placeholder__",
  description: "Reserved placeholder. Never available. Never call this.",
  input_schema: { type: "object", properties: {}, required: [] },
  defer_loading: true,
};

export interface NativeSystemInjection {
  /** Insert immediately before this zero-based assistant message, or at the request tail. */
  beforeAssistant: number | null;
  content: Array<Record<string, unknown>>;
}

export interface NativeTranscriptPlan {
  requestTools: Array<Record<string, unknown>>;
  systemInjections: NativeSystemInjection[];
}

interface ReplayCarrier {
  version: 1;
  message: NativeMessage;
  projection: AssistantProjection;
  initialUserPrefix?: unknown[];
  initialSystemMessages?: unknown[];
}

interface AssistantProjection {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assistantProjection(message: AssistantMessage): AssistantProjection {
  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  const toolCalls = message.content
    .filter((block) => block.type === "toolCall")
    .map((block) => ({ id: block.id, name: block.name, input: clone(block.arguments) as Record<string, unknown> }));
  return { text, toolCalls };
}

function isReplayCarrier(value: unknown): value is ReplayCarrier {
  if (!value || typeof value !== "object") return false;
  const carrier = value as Partial<ReplayCarrier>;
  return carrier.version === 1 && !!carrier.message && !!carrier.projection;
}

function replayCarrier(message: AssistantMessage): ReplayCarrier | undefined {
  const diagnostic = message.diagnostics?.find((item) => item.type === NATIVE_REPLAY_DIAGNOSTIC);
  const candidate = diagnostic?.details?.carrier;
  return isReplayCarrier(candidate) ? candidate : undefined;
}

function replayMetadata(messages: Message[], key: "initialUserPrefix" | "initialSystemMessages"): unknown[] | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const value = replayCarrier(message)?.[key];
    if (value) return clone(value);
  }
  return undefined;
}

export function getInitialUserPrefix(messages: Message[]): unknown[] | undefined {
  return replayMetadata(messages, "initialUserPrefix");
}

export function getInitialSystemMessages(messages: Message[]): unknown[] | undefined {
  return replayMetadata(messages, "initialSystemMessages");
}

function projectionsEqual(left: AssistantProjection, right: AssistantProjection): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function imageBlock(block: ImageContent): Record<string, unknown> {
  return {
    type: "image",
    source: { type: "base64", media_type: block.mimeType, data: block.data },
  };
}

function userContent(content: string | (TextContent | ImageContent)[]): unknown[] {
  if (typeof content === "string") return content ? [{ type: "text", text: sanitizeSurrogates(content) }] : [];
  return content.map((block) =>
    block.type === "text" ? { type: "text", text: sanitizeSurrogates(block.text) } : imageBlock(block),
  );
}

function toolResultContent(message: ToolResultMessage): string | unknown[] {
  const hasImages = message.content.some((block) => block.type === "image");
  if (!hasImages) {
    return sanitizeSurrogates(
      message.content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
    );
  }
  return message.content.map((block) =>
    block.type === "text" ? { type: "text", text: sanitizeSurrogates(block.text) } : imageBlock(block),
  );
}

function canonicalAssistantContent(message: AssistantMessage): NativeContentBlock[] {
  const blocks: NativeContentBlock[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text.trim()) {
      blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
    } else if (block.type === "thinking" && block.thinking.trim() && block.thinkingSignature) {
      if (block.redacted) {
        blocks.push({ type: "redacted_thinking", data: block.thinkingSignature });
      } else {
        blocks.push({
          type: "thinking",
          thinking: sanitizeSurrogates(block.thinking),
          signature: block.thinkingSignature,
        });
      }
    } else if (block.type === "toolCall") {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: `${TOOL_PREFIX}${block.name}`,
        input: clone(block.arguments) as Record<string, unknown>,
      });
    }
  }
  return blocks;
}

function assistantContent(original: AssistantMessage): NativeContentBlock[] {
  const message = withoutForeignThinking(original);
  const carrier = replayCarrier(message);
  if (carrier && projectionsEqual(assistantProjection(message), carrier.projection)) {
    return clone(carrier.message.content);
  }

  // A changed projection must not restore stale signed thinking. For messages
  // produced by this provider without a carrier (for example an old session),
  // canonical signed blocks are still the best available replay.
  if (carrier) {
    return canonicalAssistantContent({
      ...message,
      content: message.content.filter((block) => block.type !== "thinking"),
    });
  }
  return canonicalAssistantContent(message);
}

export function prepareFrames(messages: Message[]): NativeFrame[] {
  const frames: NativeFrame[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    let role: "user" | "assistant";
    let blocks: unknown[];

    if (message.role === "user") {
      role = "user";
      blocks = userContent(message.content);
    } else if (message.role === "assistant") {
      role = "assistant";
      blocks = assistantContent(message);
    } else {
      role = "user";
      blocks = [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: toolResultContent(message),
          is_error: message.isError,
        },
      ];
    }

    if (blocks.length === 0) continue;
    const previous = frames.at(-1);
    if (role === "user" && previous?.type === "user") {
      previous.message.content.push(...blocks);
    } else {
      frames.push({ type: role, message: { role, content: blocks } });
    }
  }

  const final = frames.at(-1);
  if (!final || final.type !== "user" || final.message.content.length === 0) {
    throw new Error("Claude Code history must end in a non-empty user or tool-result message");
  }

  for (let index = 0; index < frames.length - 1; index++) {
    if (frames[index]?.type === "user") frames[index]!.shouldQuery = false;
  }
  return normalizeFrameToolIds(frames);
}

/**
 * Build Anthropic's cache-preserving native representation of transcript tool changes.
 * The placeholder keeps deferred-tool prompt scaffolding stable from the first request.
 */
export function prepareNativeTranscript(
  messages: Message[],
  supported: boolean,
): NativeTranscriptPlan | undefined {
  const initial = getInitialSystemMessage(messages);
  const initialTools = initial?.toolsAdded ?? [];
  if (!supported || initialTools.length === 0 || hasToolRedefinitions(messages)) return undefined;

  const declared = getDeclaredTools(messages);
  const prepared = prepareTools(declared);
  const nativeByName = new Map(
    prepared.nativeTools.map((tool) => [String(tool.name).slice(TOOL_PREFIX.length), tool]),
  );
  const initialNames = new Set(initialTools.map((tool) => tool.name));
  const initialNative = initialTools.map((tool) => structuredClone(nativeByName.get(tool.name)!));
  initialNative.at(-1)!.cache_control = { type: "ephemeral", ttl: "1h" };
  const laterNative = declared
    .filter((tool) => !initialNames.has(tool.name))
    .map((tool) => ({ ...structuredClone(nativeByName.get(tool.name)!), defer_loading: true }));

  const systemInjections: NativeSystemInjection[] = [];
  let pending: Array<Array<Record<string, unknown>>> = [];
  let assistantOrdinal = 0;
  const flush = (beforeAssistant: number | null) => {
    for (const content of pending) systemInjections.push({ beforeAssistant, content });
    pending = [];
  };

  for (let index = 1; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role === "system") {
      const blocks = nativeSystemBlocks(message);
      if (blocks.length) pending.push(blocks);
    } else if (message.role === "assistant" && assistantContent(message).length > 0) {
      flush(assistantOrdinal);
      assistantOrdinal += 1;
    }
  }
  flush(null);

  return {
    requestTools: [...initialNative, structuredClone(DEFERRED_TOOL_PLACEHOLDER), ...laterNative],
    systemInjections,
  };
}

export function makeReplayDiagnostic(
  message: NativeMessage,
  output: AssistantMessage,
  initialUserPrefix?: unknown[],
  initialSystemMessages?: unknown[],
) {
  return {
    type: NATIVE_REPLAY_DIAGNOSTIC,
    timestamp: Date.now(),
    details: {
      carrier: {
        version: 1,
        message: clone(message),
        projection: assistantProjection(output),
        ...(initialUserPrefix ? { initialUserPrefix: clone(initialUserPrefix) } : {}),
        ...(initialSystemMessages ? { initialSystemMessages: clone(initialSystemMessages) } : {}),
      },
    },
  };
}
