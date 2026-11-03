import { createHash } from "node:crypto";
import type { NativeFrame } from "./native-types.ts";

const VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function idField(value: unknown): "id" | "tool_use_id" | undefined {
  if (!value || typeof value !== "object") return undefined;
  const block = value as Record<string, unknown>;
  if (block.type === "tool_use") return "id";
  if (block.type === "tool_result") return "tool_use_id";
  return undefined;
}

function collectIds(frames: NativeFrame[]): Set<string> {
  const ids = new Set<string>();
  for (const frame of frames) {
    for (const value of frame.message.content) {
      const field = idField(value);
      if (field) ids.add(String((value as Record<string, unknown>)[field]));
    }
  }
  return ids;
}

function replacementIds(ids: Set<string>): Map<string, string> {
  const occupied = new Set([...ids].filter((id) => VALID_ID.test(id)));
  const replacements = new Map<string, string>();
  for (const id of ids) {
    if (VALID_ID.test(id)) continue;
    let attempt = 0;
    let candidate: string;
    do {
      const material = JSON.stringify([id, attempt++]);
      candidate = "toolu_" + createHash("sha256").update(material).digest("hex").slice(0, 58);
    } while (occupied.has(candidate));
    replacements.set(id, candidate);
    occupied.add(candidate);
  }
  return replacements;
}

// Reserve all existing IDs before assigning replacements, including IDs later in history.
export function normalizeFrameToolIds(frames: NativeFrame[]): NativeFrame[] {
  const replacements = replacementIds(collectIds(frames));
  return frames.map((frame) => ({
    ...frame,
    message: {
      ...frame.message,
      content: frame.message.content.map((value) => {
        const field = idField(value);
        if (!field) return value;
        const block = value as Record<string, unknown>;
        const replacement = replacements.get(String(block[field]));
        return replacement ? { ...block, [field]: replacement } : value;
      }),
    },
  }));
}
