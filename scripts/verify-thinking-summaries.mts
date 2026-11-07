// 本物の claude（claude-opus-5-5）で、showThinkingSummaries: true を渡すと思考の本文が空でなくなることと、
// 上流へ送る本文・キャッシュが変更前と変わらないことを確かめる（devflow 20261107-1918）。
// 1回の run で count 回の要求を、それぞれ別の Pi セッション・別の Claude Code で送る（実機の要求は count 回）。
// 使い方:
//   node --experimental-transform-types scripts/verify-thinking-summaries.mts run <リポジトリの根> <出力.jsonl> <1〜4>
//   node --experimental-transform-types scripts/verify-thinking-summaries.mts compare <変更前.jsonl> <変更後.jsonl>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const MODEL = "claude-opus-5-5";
// adaptive thinking は簡単な要求だと思考を省くため、途中の計算が要る問題にする
const PROMPT = "What is 37 * 43 - 29 * 31? Think it through, then reply with only the final number.";
const REDACT_BETA = "redact-thinking-2026-02-12";
const BODY_KEYS = ["thinking", "output_config", "context_management", "max_tokens", "model"] as const;
const MAX_COUNT = 4;

interface Recorded { betas: string[]; sent: Record<string, unknown> }
interface ThinkingShape { length: number; signatureLength: number }
interface RunRecord {
  run: number; ok: boolean; error?: string; betas?: string[]; sent?: Record<string, unknown>;
  cacheRead?: number; blockTypes?: string[]; thinking?: ThinkingShape[]; redacted?: number; text?: string;
}

function startProxy(records: Recorded[]): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    const beta = String(request.headers["anthropic-beta"] ?? "");
    records.push({
      betas: [...new Set(beta.split(",").map((value) => value.trim()).filter(Boolean))].sort(),
      sent: Object.fromEntries(BODY_KEYS.map((key) => [key, parsed[key]])),
    });
    const headers = { ...request.headers, host: "api.anthropic.com", "content-length": String(body.length) };
    const upstream = https.request({ hostname: "api.anthropic.com", method: "POST", path: request.url, headers }, (reply) => {
      response.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(response);
    });
    upstream.on("error", () => response.destroy());
    upstream.end(body);
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => {
    done({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() });
  }));
}

type Block = { type: string; text?: string; thinking?: string; signature?: string };

function shapeOf(content: Block[]): Pick<RunRecord, "blockTypes" | "thinking" | "redacted" | "text"> {
  return {
    blockTypes: content.map((block) => block.type),
    thinking: content.filter((block) => block.type === "thinking").map((block) => ({ length: (block.thinking ?? "").length, signatureLength: (block.signature ?? "").length })),
    redacted: content.filter((block) => block.type === "redacted_thinking").length,
    text: content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("").slice(0, 40),
  };
}

async function run(root: string, outPath: string, count: number): Promise<boolean> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new Error(`count must be 1..${MAX_COUNT}`);
  const tui = await import(pathToFileURL(join(root, "src/tui-process.ts")).href);
  const config = await import(pathToFileURL(join(root, "src/tool-config.ts")).href);
  const cwd = join(tmpdir(), "pi-verify-thinking-summaries");
  mkdirSync(cwd, { recursive: true });
  const records: Recorded[] = [];
  const proxy = await startProxy(records);
  const lines: RunRecord[] = [];
  try {
    for (let index = 1; index <= count; index += 1) {
      try {
        const output = await tui.runTuiRequest({
          model: MODEL, cwd, frames: [{ type: "user", message: { role: "user", content: [{ type: "text", text: PROMPT }] } }],
          systemPrompt: "", manifest: [], extraBody: config.buildExtraBody(MODEL, [], { reasoning: "high" }), toolNames: new Set(),
          upstreamUrl: proxy.url, sessionId: `verify-thinking-summaries-${index}`, timeoutMs: 180_000, env: { PI_CLAUDE_CODE_TUI_TRUST: "1" },
        });
        const recorded = records.splice(0);
        if (recorded.length !== 1) throw new Error(`expected 1 upstream request, got ${recorded.length}`);
        lines.push({ run: index, ok: true, ...recorded[0], cacheRead: output.usage.cache_read_input_tokens ?? 0, ...shapeOf(output.message.content as Block[]) });
      } catch (error) {
        lines.push({ run: index, ok: false, error: String(error instanceof Error ? error.message : error).slice(0, 400), ...records.splice(0)[0] });
        break;
      } finally {
        await tui.closeTuiProcesses();
      }
    }
  } finally {
    proxy.close();
  }
  writeFileSync(outPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  for (const line of lines) console.log(JSON.stringify(line));
  return lines.length === count && lines.every((line) => line.ok);
}

function readRecords(path: string): RunRecord[] {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as RunRecord);
}

function hypothesisChecks(after: RunRecord[]): Array<[boolean, string]> {
  const redactFree = after.every((record) => !(record.betas ?? []).includes(REDACT_BETA));
  const shapes = after.flatMap((record) => record.thinking ?? []);
  const filled = shapes.length > 0 && shapes.every((shape) => shape.length >= 1);
  return [
    [redactFree, `(1) no ${REDACT_BETA} after: ${JSON.stringify(after.map((record) => (record.betas ?? []).includes(REDACT_BETA)))}`],
    [filled, `(2) thinking text after: ${JSON.stringify(after.map((record) => record.thinking ?? []))}`],
  ];
}

function pairChecks(before: RunRecord[], after: RunRecord[]): Array<[boolean, string]> {
  const results: Array<[boolean, string]> = [];
  for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
    const b = before[index]!;
    const a = after[index]!;
    for (const key of BODY_KEYS) {
      results.push([isDeepStrictEqual(b.sent?.[key], a.sent?.[key]), `(3) run ${index + 1} body.${key}: before=${JSON.stringify(b.sent?.[key])} after=${JSON.stringify(a.sent?.[key])}`]);
    }
    results.push([(a.cacheRead ?? 0) >= (b.cacheRead ?? 0), `(4) run ${index + 1} cache_read_input_tokens: before=${b.cacheRead} after=${a.cacheRead}`]);
  }
  return results;
}

function infoLines(before: RunRecord[], after: RunRecord[]): string[] {
  const beforeBetas = new Set(before.flatMap((record) => record.betas ?? []));
  const afterBetas = new Set(after.flatMap((record) => record.betas ?? []));
  return [
    `before thinking: ${JSON.stringify(before.map((record) => record.thinking ?? []))}`,
    `anthropic-beta only after: ${JSON.stringify([...afterBetas].filter((beta) => !beforeBetas.has(beta)).sort())}`,
    `anthropic-beta only before: ${JSON.stringify([...beforeBetas].filter((beta) => !afterBetas.has(beta)).sort())}`,
  ];
}

function compare(beforePath: string, afterPath: string): boolean {
  const before = readRecords(beforePath);
  const after = readRecords(afterPath);
  const complete = [...before, ...after].every((record) => record.ok) && Math.min(before.length, after.length) >= 2;
  const hypothesis = hypothesisChecks(after);
  const results: Array<[boolean, string]> = [
    [complete, `records complete: before=${JSON.stringify(before.map((record) => record.ok))} after=${JSON.stringify(after.map((record) => record.ok))}`],
    ...hypothesis,
    ...pairChecks(before, after),
  ];
  for (const [pass, detail] of results) console.log(`${pass ? "PASS" : "FAIL"} ${detail}`);
  for (const line of infoLines(before, after)) console.log(`INFO ${line}`);
  const failed = results.filter(([pass]) => !pass).length;
  console.log(`summary: ${results.length - failed} passed, ${failed} failed`);
  console.log(`hypothesis: ${hypothesis.every(([pass]) => pass) ? "confirmed" : "rejected"}`);
  return failed === 0;
}

const [command, first, second, third] = process.argv.slice(2);
let passed: boolean;
if (command === "run" && first && second && third) passed = await run(resolve(first), resolve(second), Number(third));
else if (command === "compare" && first && second) passed = compare(resolve(first), resolve(second));
else throw new Error("usage: verify-thinking-summaries.mts run <repo-root> <out.jsonl> <count> | compare <before.jsonl> <after.jsonl>");
process.exitCode = passed ? 0 : 1;
