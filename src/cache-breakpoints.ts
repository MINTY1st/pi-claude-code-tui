export interface NativeRequestMessage {
  role?: string;
  content?: unknown;
}

export function withoutCacheControl(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCacheControl);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key !== "cache_control") output[key] = withoutCacheControl(child);
  }
  return output;
}

function setCacheBreakpoint(message: NativeRequestMessage): void {
  if (typeof message.content === "string") {
    message.content = [
      { type: "text", text: message.content, cache_control: { type: "ephemeral", ttl: "1h" } },
    ];
    return;
  }
  if (!Array.isArray(message.content) || message.content.length === 0) return;
  const last = message.content.at(-1);
  if (!last || typeof last !== "object") return;
  (last as Record<string, unknown>).cache_control = { type: "ephemeral", ttl: "1h" };
}

export function setReplayCacheBreakpoints(messages: NativeRequestMessage[]): void {
  const userIndexes = messages
    .map((message, index) => (message.role === "user" ? index : -1))
    .filter((index) => index >= 0);
  if (userIndexes.length >= 3) {
    // Claude permits four cache breakpoints. Its two system-prompt markers
    // consume half of them, so once a prior queried user exists, move the
    // native environment marker to that exact previous query boundary. This
    // avoids relying on automatic lookback (notably unreliable with images).
    for (const message of messages) {
      if (message.role === "system") message.content = withoutCacheControl(message.content);
    }
    setCacheBreakpoint(messages[userIndexes.at(-2)!]!);
  }
  const final = messages.at(-1);
  if (final) setCacheBreakpoint(final);
}
