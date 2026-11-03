import type { AssistantMessage } from "@earendil-works/pi-ai";
import { API_ID } from "./model-catalog.ts";

// Only Anthropic-issued thinking signatures can be replayed; other providers
// (OpenAI responses, OpenAI-compatible proxies) sign with their own format.
const ANTHROPIC_SIGNED_APIS = new Set<string>([API_ID, "anthropic-messages"]);

export function withoutForeignThinking(message: AssistantMessage): AssistantMessage {
  if (ANTHROPIC_SIGNED_APIS.has(message.api)) return message;
  return { ...message, content: message.content.filter((block) => block.type !== "thinking") };
}
