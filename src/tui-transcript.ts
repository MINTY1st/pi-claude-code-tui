import { type NativeRequestMessage, setReplayCacheBreakpoints, withoutCacheControl } from "./cache-breakpoints.ts";
import type { NativeFrame } from "./native-types.ts";

const REMINDER_PREFIX = "<system-reminder>";

function isReminderBlock(block: unknown): boolean {
  const text = (block as { type?: unknown; text?: unknown } | null)?.text;
  return typeof text === "string" && text.startsWith(REMINDER_PREFIX);
}

// TUI の先頭 user には、Claude Code のアカウント文脈 (system-reminder) の後ろに /clear の痕跡と貼り付けた文が続く。
// 前者だけが Claude Code 本来の前置きなので、その後ろを Pi の発言に置き換える
function reminderPrefix(content: unknown): unknown[] {
  if (!Array.isArray(content)) return [];
  const end = content.findIndex((block) => !isReminderBlock(block));
  return structuredClone(end < 0 ? content : content.slice(0, end));
}

// /clear 直後の TUI が先頭 user の直後に置く system は環境情報の1件だけ（2.1.316 で実測）。それ以外の system
// （<total_tokens> など）は毎ターン値が変わりキャッシュの接頭辞を崩すため、Pi の履歴へは持ち込まない
function environmentMessages(messages: NativeRequestMessage[]): NativeRequestMessage[] {
  return messages[1]?.role === "system" ? [structuredClone(messages[1])] : [];
}

// Anthropic のキャッシュ区切りは4つまでで、system プロンプトが2つ使う。Pi の履歴に残った区切りを外し、
// 付け直しは setReplayCacheBreakpoints に任せて messages 側を2つ以内に収める
function piMessages(frames: NativeFrame[]): NativeRequestMessage[] {
  return frames.map((frame) => withoutCacheControl(frame.message) as NativeRequestMessage);
}

/** 対話 TUI が送った本文の messages を、Pi の会話で丸ごと置き換える。system・tools などはそのまま残す。 */
export function replaceTranscript(body: Buffer, frames: NativeFrame[]): Buffer {
  const payload = JSON.parse(body.toString("utf8")) as { messages?: NativeRequestMessage[] };
  const messages = payload.messages ?? [];
  if (messages[0]?.role !== "user") throw new Error("Claude Code request is missing its initial user message");
  if (frames[0]?.type !== "user") throw new Error("Pi conversation must start with a user message");

  const [first, ...later] = piMessages(frames);
  const replaced = [
    { role: "user", content: [...reminderPrefix(messages[0].content), ...(first!.content as unknown[])] },
    ...environmentMessages(messages),
    ...later,
  ];
  setReplayCacheBreakpoints(replaced);
  payload.messages = replaced;
  return Buffer.from(JSON.stringify(payload));
}
