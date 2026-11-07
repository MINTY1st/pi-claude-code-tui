import assert from "node:assert/strict";
import * as http from "node:http";
import test from "node:test";
import { isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai";
import type { AnthropicStreamEvent } from "../src/native-types.ts";
import { incompleteUpstreamMessage } from "../src/relay-failure.ts";
import { normalizeError } from "../src/stream.ts";
import { TurnRelay } from "../src/turn-relay.ts";

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void | Promise<void>;

const MESSAGE_START = `data: ${JSON.stringify({ type: "message_start", message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`;

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing address");
      resolve(address.port);
    });
  });
}

async function closedPort(): Promise<number> {
  const server = http.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Pi 本体（AgentSession._isRetryableError）と同じ判定を、stream.ts が作る errorMessage に対して行う
function retryable(relay: TurnRelay): boolean {
  const errorMessage = normalizeError(new Error(incompleteUpstreamMessage(relay)));
  return isRetryableAssistantError({ stopReason: "error", errorMessage } as AssistantMessage);
}

/** TUI の代わりに1回だけ要求を送り、relay が後始末を終えるまで待つ。戻り値は TUI が受け取った status */
async function sendTurn(relay: TurnRelay, baseUrl: string): Promise<number | undefined> {
  let status: number | undefined;
  try {
    const response = await fetch(`${baseUrl}/v1/messages`, { method: "POST", body: "{}" });
    status = response.status;
    await response.text();
  } catch {
    // relay が TUI 側の接続を destroy したときの fetch の失敗は、この試験では見ない
  }
  await relay.settled();
  return status;
}

async function withRelay(
  upstream: Handler | number,
  run: (relay: TurnRelay, baseUrl: string, hits: () => number) => Promise<void>,
  options: { onEvent?: (event: AnthropicStreamEvent) => void; transformRequest?: (body: Buffer) => Buffer } = {},
): Promise<void> {
  let count = 0;
  const server = typeof upstream === "number" ? undefined : http.createServer(async (request, response) => {
    count += 1;
    for await (const _ of request);
    await upstream(request, response);
  });
  const port = server ? await listen(server) : (upstream as number);
  const relay = new TurnRelay(`http://127.0.0.1:${port}`, options.onEvent, options.transformRequest);
  try {
    await run(relay, await relay.start(), () => count);
  } finally {
    await relay.close();
    server?.closeAllConnections();
    await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  }
}

test("上流に接続できないとき、connect として code と message を残し、Pi が再試行する文言にする", async () => {
  await withRelay(await closedPort(), async (relay, baseUrl) => {
    assert.equal(await sendTurn(relay, baseUrl), 502);
    assert.equal(relay.failure?.kind, "connect");
    assert.match(relay.failure?.detail ?? "", /^(Aggregate)?Error \[ECONNREFUSED\]/);
    assert.match(relay.failure?.detail ?? "", /connect ECONNREFUSED/);
    assert.equal(relay.status, undefined);
    assert.match(incompleteUpstreamMessage(relay), /^Claude Code upstream connection error: /);
    assert.equal(retryable(relay), true);
  });
});

test("上流が応答ヘッダーの前に切ったとき、connect として socket hang up を残し、Pi が再試行する", async () => {
  await withRelay((request) => void request.socket.destroy(), async (relay, baseUrl) => {
    assert.equal(await sendTurn(relay, baseUrl), 502);
    assert.equal(relay.failure?.kind, "connect");
    assert.equal(relay.failure?.detail, "Error [ECONNRESET]: socket hang up");
    assert.equal(retryable(relay), true);
  });
});

test("200 の途中で上流が切れたとき、disconnect として残し、Pi が再試行する", async () => {
  await withRelay((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(MESSAGE_START);
    setTimeout(() => response.socket?.destroy(), 20);
  }, async (relay, baseUrl) => {
    await sendTurn(relay, baseUrl);
    assert.equal(relay.status, 200);
    assert.equal(relay.failure?.kind, "disconnect");
    assert.equal(relay.failure?.detail, "Error [ECONNRESET]: aborted");
    assert.match(incompleteUpstreamMessage(relay), /^Claude Code upstream connection lost: /);
    assert.equal(retryable(relay), true);
  });
});

test("400 の本文の途中で上流が切れたとき、message を出さず Pi も再試行しない", async () => {
  await withRelay((_request, response) => {
    response.writeHead(400, { "content-type": "application/json" });
    response.write('{"type":"error",');
    setTimeout(() => response.socket?.destroy(), 20);
  }, async (relay, baseUrl) => {
    await sendTurn(relay, baseUrl);
    assert.equal(relay.status, 400);
    assert.equal(relay.failure?.kind, "disconnect");
    assert.ok(!incompleteUpstreamMessage(relay).includes("aborted"));
    assert.equal(relay.capture.message, undefined);
    assert.equal(retryable(relay), false);
  });
});

test("onEvent が投げた例外は capture として元の message を残し、Pi は再試行しない", async () => {
  const onEvent = () => {
    throw new Error("Claude Code returned unavailable tool foo");
  };
  await withRelay((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(MESSAGE_START);
  }, async (relay, baseUrl, hits) => {
    await sendTurn(relay, baseUrl);
    assert.equal(relay.failure?.kind, "capture");
    assert.equal(relay.failure?.detail, "CaptureError: Claude Code stream handling failed: Error: Claude Code returned unavailable tool foo");
    assert.match(incompleteUpstreamMessage(relay), /relay failure CaptureError: .*unavailable tool foo/);
    assert.equal(retryable(relay), false);
    assert.equal(hits(), 1);
  }, { onEvent });
});

test("SSE の data が JSON として壊れているとき、capture として SyntaxError の message を残し、Pi は再試行しない", async () => {
  await withRelay((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end('data: {"type":\n\n');
  }, async (relay, baseUrl) => {
    await sendTurn(relay, baseUrl);
    assert.equal(relay.failure?.kind, "capture");
    assert.match(relay.failure?.detail ?? "", /^CaptureError: Claude Code stream handling failed: SyntaxError: .+/);
    assert.equal(retryable(relay), false);
  });
});

test("transformRequest が投げたとき、request として残し、上流へは送らず、Pi は再試行しない", async () => {
  const transformRequest = (): Buffer => {
    throw new Error("PI_CLAUDE_CODE_BAD_TRANSCRIPT");
  };
  await withRelay(() => assert.fail("upstream must not be called"), async (relay, baseUrl, hits) => {
    assert.equal(await sendTurn(relay, baseUrl), 502);
    assert.deepEqual(relay.failure, { kind: "request", summary: "Error", detail: "Error: PI_CLAUDE_CODE_BAD_TRANSCRIPT" });
    assert.equal(hits(), 0);
    assert.equal(retryable(relay), false);
  }, { transformRequest });
});

test("400 の応答を最後まで受けたとき、failure を残さず、本文は TUI にそのまま返し、Pi は再試行しない", async () => {
  const body = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages: text content blocks must be non-empty" } });
  await withRelay((_request, response) => {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(body);
  }, async (relay, baseUrl) => {
    assert.equal(await sendTurn(relay, baseUrl), 400);
    assert.equal(relay.failure, undefined);
    assert.equal(relay.capture.message, undefined);
    assert.equal(relay.errorText(), "messages: text content blocks must be non-empty");
    assert.equal(retryable(relay), false);
  });
});

test("接続失敗のあとに届いた再送は拒否し、最初の failure を保ったまま拒否回数を文言に出す", async () => {
  await withRelay(await closedPort(), async (relay, baseUrl) => {
    await sendTurn(relay, baseUrl);
    assert.equal(await sendTurn(relay, baseUrl), 400);
    assert.equal(relay.denied, 1);
    assert.equal(relay.failure?.kind, "connect");
    assert.match(incompleteUpstreamMessage(relay), /native retries denied 1/);
    assert.equal(retryable(relay), true);
  });
});

test("beginTurn で前のターンの failure を消す", async () => {
  await withRelay(await closedPort(), async (relay, baseUrl) => {
    await sendTurn(relay, baseUrl);
    assert.ok(relay.failure);
    relay.beginTurn();
    assert.equal(relay.failure, undefined);
    assert.equal(retryable(relay), false);
  });
});

test("経路違いの要求には 404 を返し、failure を残さない", async () => {
  await withRelay(await closedPort(), async (relay, baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/other`, { method: "POST", body: "{}" });
    assert.equal(response.status, 404);
    await relay.settled();
    assert.equal(relay.failure, undefined);
    assert.equal(relay.used, false);
  });
});
