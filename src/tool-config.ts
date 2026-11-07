import { renderSystemMessageUpdate, type SimpleStreamOptions, type SystemMessage, type Tool } from "@earendil-works/pi-ai";
import { supportsAdaptiveThinking } from "./model-catalog.ts";

export const TOOL_PREFIX = "mcp__pi__";

export function sanitizeSurrogates(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/gu, "\uFFFD");
}

export function nativeSystemBlocks(message: SystemMessage): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  const text = renderSystemMessageUpdate(message);
  if (text) blocks.push({ type: "text", text: sanitizeSurrogates(text) });
  for (const tool of message.toolsRemoved ?? []) {
    blocks.push({
      type: "tool_removal",
      tool: { type: "tool_reference", name: `${TOOL_PREFIX}${tool.name}` },
    });
  }
  for (const tool of message.toolsAdded ?? []) {
    blocks.push({
      type: "tool_addition",
      tool: { type: "tool_reference", name: `${TOOL_PREFIX}${tool.name}` },
    });
  }
  return blocks;
}

function withoutNullVariant(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutNullVariant);
  if (!schema || typeof schema !== "object") return schema;

  const input = schema as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) output[key] = withoutNullVariant(value);

  if (Array.isArray(output.type) && output.type.includes("null")) {
    const remaining = output.type.filter((value) => value !== "null");
    output.type = remaining.length === 1 ? remaining[0] : remaining;
  }

  if (Array.isArray(output.anyOf)) {
    const nonNull = output.anyOf.filter(
      (branch) => !(branch && typeof branch === "object" && (branch as Record<string, unknown>).type === "null"),
    );
    if (nonNull.length === 1 && nonNull.length !== output.anyOf.length) {
      const replacement = nonNull[0];
      delete output.anyOf;
      if (replacement && typeof replacement === "object") Object.assign(output, replacement);
    }
  }
  return output;
}

export function normalizeInputSchema(schema: unknown): Record<string, unknown> {
  const normalized = withoutNullVariant(schema) as Record<string, unknown>;
  for (const key of ["oneOf", "allOf", "anyOf"]) delete normalized[key];
  if (!normalized.type) normalized.type = "object";
  if (normalized.type === "object" && (!normalized.properties || typeof normalized.properties !== "object")) {
    normalized.properties = {};
  }
  return normalized;
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function prepareTools(tools: Tool[]): {
  manifest: ToolManifestEntry[];
  nativeTools: Array<Record<string, unknown>>;
  names: Set<string>;
} {
  const names = new Set<string>();
  const manifest: ToolManifestEntry[] = [];
  const nativeTools: Array<Record<string, unknown>> = [];

  for (const tool of tools) {
    if (!/^[A-Za-z0-9_-]{1,50}$/u.test(tool.name) || names.has(tool.name)) {
      throw new Error("Claude Code tool names must be unique ASCII identifiers of at most 50 characters");
    }
    names.add(tool.name);
    const schema = normalizeInputSchema(tool.parameters);
    manifest.push({ name: tool.name, description: tool.description, inputSchema: schema });
    nativeTools.push({
      name: `${TOOL_PREFIX}${tool.name}`,
      description: tool.description,
      input_schema: schema,
    });
  }
  return { manifest, nativeTools, names };
}

export function buildExtraBody(
  modelId: string,
  nativeTools: Array<Record<string, unknown>>,
  options?: SimpleStreamOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = { tools: nativeTools };
  if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  if (options?.reasoning) {
    // Opus 4.7 以降の API は display 省略時に omitted となり思考本文を返さないため、Pi 本体と同じ summarized を明示する
    if (supportsAdaptiveThinking(modelId)) body.thinking = { type: "adaptive", display: "summarized" };
    body.output_config = {
      effort: options.reasoning === "minimal" ? "low" : options.reasoning,
    };
  } else {
    body.thinking = { type: "disabled" };
    // Native clear-thinking edits are invalid when thinking is disabled.
    body.context_management = { edits: [] };
  }
  return body;
}
