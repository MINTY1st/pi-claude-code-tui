// 本物の claude で、effort の変更が TUI プロセスを作り直さないことと、上流へ送る本文・ヘッダが変更前と変わらないことを確かめる。
// 1回の run で4ターン（effort high → low → medium → thinking オフ）を同じ Pi セッションとして送る（実機の要求は4回）。
// 使い方:
//   node --experimental-transform-types scripts/verify-turn-body.mts run <リポジトリの根> <出力.jsonl> [claude-sonnet-5-5|claude-haiku-5-5]
//   node --experimental-transform-types scripts/verify-turn-body.mts compare <変更前.jsonl> <変更後.jsonl>
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

// claude-opus-5-5 と claude-fable-5-1 は thinking オフの形をどれも 400 で拒否するため使わない（devflow 20261107-1406）
const MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5"];
const TURNS: Array<{ reasoning?: "low" | "medium" | "high" }> = [{ reasoning: "high" }, { reasoning: "low" }, { reasoning: "medium" }, {}];
const BODY_KEYS = ["thinking", "output_config", "context_management", "max_tokens", "model"] as const;
const SESSION_ID = "verify-turn-body";

interface Recorded { betas: string[]; sent: Record<string, unknown> }
interface TurnRecord { turn: number; reasoning: string; settingsPaths: string[]; ok: boolean; error?: string; betas?: string[]; sent?: Record<string, unknown>; cacheRead?: number; text?: string }

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

// 利用者の Pi が同じ拡張で動かしている claude を数えないよう、このプロセスの子孫だけを見る
function descendantSettingsPaths(): string[] {
  const rows = execFileSync("ps", ["-eo", "pid=,ppid=,args="], { encoding: "utf8" }).split("\n").map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line)).filter((row) => !!row);
  const mine = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) if (mine.has(Number(row[2])) && !mine.has(Number(row[1]))) { mine.add(Number(row[1])); grew = true; }
  }
  const paths = rows.filter((row) => mine.has(Number(row[1]))).map((row) => /--settings\s+(\S*pi-claude-code-tui-[^/\s]+\/settings\.json)/u.exec(row[3]!)?.[1]).filter((path) => !!path);
  return [...new Set(paths as string[])].sort();
}

async function run(root: string, outPath: string, model: string): Promise<boolean> {
  if (!MODELS.includes(model)) throw new Error(`model must be one of ${MODELS.join(", ")}`);
  const tui = await import(pathToFileURL(join(root, "src/tui-process.ts")).href);
  const config = await import(pathToFileURL(join(root, "src/tool-config.ts")).href);
  const cwd = join(tmpdir(), "pi-verify-turn-body");
  mkdirSync(cwd, { recursive: true });
  const records: Recorded[] = [];
  const proxy = await startProxy(records);
  const frames: Array<{ type: "user" | "assistant"; message: { role: "user" | "assistant"; content: unknown[] } }> = [];
  const lines: TurnRecord[] = [];
  try {
    for (const [index, options] of TURNS.entries()) {
      const turn = index + 1;
      frames.push({ type: "user", message: { role: "user", content: [{ type: "text", text: `Reply with exactly: OK${turn}` }] } });
      const extraBody = config.buildExtraBody(model, [], options);
      const base: TurnRecord = { turn, reasoning: options.reasoning ?? "off", settingsPaths: [], ok: false };
      try {
        const output = await tui.runTuiRequest({
          model, cwd, frames: structuredClone(frames), systemPrompt: "", manifest: [], extraBody, toolNames: new Set(),
          upstreamUrl: proxy.url, sessionId: SESSION_ID, timeoutMs: 180_000, env: { PI_CLAUDE_CODE_TUI_TRUST: "1" },
        });
        const texts = (output.message.content as Array<{ type: string; text?: string }>).filter((block) => block.type === "text");
        frames.push({ type: "assistant", message: { role: "assistant", content: texts.length ? texts : [{ type: "text", text: "OK" }] } });
        const recorded = records.splice(0);
        if (recorded.length !== 1) throw new Error(`expected 1 upstream request, got ${recorded.length}`);
        lines.push({ ...base, ok: true, settingsPaths: descendantSettingsPaths(), ...recorded[0], cacheRead: output.usage.cache_read_input_tokens ?? 0, text: texts.map((block) => block.text).join("").slice(0, 40) });
      } catch (error) {
        lines.push({ ...base, settingsPaths: descendantSettingsPaths(), error: String(error instanceof Error ? error.message : error).slice(0, 400), ...records.splice(0)[0] });
        break;
      }
    }
  } finally {
    await tui.closeTuiProcesses();
    proxy.close();
  }
  writeFileSync(outPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
  for (const line of lines) console.log(JSON.stringify(line));
  return lines.length === TURNS.length && lines.every((line) => line.ok);
}

function readRecords(path: string): TurnRecord[] {
  return readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as TurnRecord);
}

function compare(beforePath: string, afterPath: string): boolean {
  const before = readRecords(beforePath);
  const after = readRecords(afterPath);
  const results: Array<[boolean, string]> = [];
  for (const [index] of TURNS.entries()) {
    const b = before[index];
    const a = after[index];
    const turn = index + 1;
    if (!b?.ok || !a?.ok) {
      results.push([false, `turn ${turn} request: before=${b?.ok ?? "missing"} after=${a?.ok ?? "missing"}`]);
      continue;
    }
    if (turn === 2 || turn === 3) {
      const reused = a.settingsPaths.length === 1 && isDeepStrictEqual(a.settingsPaths, after[index - 1]!.settingsPaths);
      results.push([reused, `turn ${turn} no-respawn after: ${JSON.stringify(after[index - 1]!.settingsPaths)} -> ${JSON.stringify(a.settingsPaths)}`]);
    }
    for (const key of BODY_KEYS) {
      results.push([isDeepStrictEqual(b.sent?.[key], a.sent?.[key]), `turn ${turn} body.${key}: before=${JSON.stringify(b.sent?.[key])} after=${JSON.stringify(a.sent?.[key])}`]);
    }
    results.push([isDeepStrictEqual(b.betas, a.betas), `turn ${turn} anthropic-beta: before=${JSON.stringify(b.betas)} after=${JSON.stringify(a.betas)}`]);
    results.push([(a.cacheRead ?? 0) >= (b.cacheRead ?? 0), `turn ${turn} cache_read_input_tokens: before=${b.cacheRead} after=${a.cacheRead}`]);
  }
  for (const [pass, detail] of results) console.log(`${pass ? "PASS" : "FAIL"} ${detail}`);
  const failed = results.filter(([pass]) => !pass).length;
  console.log(`summary: ${results.length - failed} passed, ${failed} failed`);
  return failed === 0;
}

const [command, first, second, model = "claude-sonnet-5-5"] = process.argv.slice(2);
let passed: boolean;
if (command === "run" && first && second) passed = await run(resolve(first), resolve(second), model);
else if (command === "compare" && first && second) passed = compare(resolve(first), resolve(second));
else throw new Error("usage: verify-turn-body.mts run <repo-root> <out.jsonl> [model] | compare <before.jsonl> <after.jsonl>");
process.exitCode = passed ? 0 : 1;
