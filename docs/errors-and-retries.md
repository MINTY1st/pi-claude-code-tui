# Errors and retries

Claude Code is started with `CLAUDE_CODE_MAX_RETRIES=0`, and the relay rejects any second request in the same call. Retrying is therefore left entirely to Pi. This document describes which failures Pi will retry and how the others are reported.

## Response checks

After a turn, the captured response must pass the checks in `src/response-checks.ts` (shared by both paths):

- **Completeness** — HTTP 200 and a complete capture (`message_stop` received). Otherwise the call fails with `Incomplete Claude Code upstream response (…)`.
- **Usage** — `input_tokens` and `output_tokens` must be numbers.
- **Billing guard** — if the response was charged to usage credits instead of plan limits (`isUsingOverage`), the call fails unless `PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS=1` (`src/billing.ts`).

## The final error message

`incompleteUpstreamMessage` (`src/relay-failure.ts`) builds the message from:

- the HTTP status and whether the capture was complete,
- the relay failure, including the error's `name`, `code` and `message` (and the inner errors of an `AggregateError`),
- the number of denied native retries, and
- up to 500 characters of the upstream error text.

Relay failures are classified by where they happened: `request`, `connect`, `disconnect` or `capture` (an exception while handling the stream).

## What Pi retries

Pi retries an assistant error when its message matches pi-ai's retry patterns (`isRetryableAssistantError`). Transient relay failures are given matching wording. The final message also includes `status <code>`, so HTTP 429 and 5xx responses match pi-ai's status-code pattern and are retried as well.

| Failure | Message prefix | Retried by Pi |
|---|---|---|
| Could not connect upstream | `Claude Code upstream connection error` | Yes |
| Connection dropped while streaming (status not 4xx) | `Claude Code upstream connection lost` | Yes |
| Turn did not finish before the deadline | `Claude Code timed out: …` | Yes |
| HTTP 429 or 5xx | none (the status code in the message matches) | Yes |
| HTTP 4xx other than 429 (including a drop while reading a 4xx body) | none | No |
| Billing / usage credits | message contains `billing` | No |
| Malformed stream, incomplete usage | none | No |

For a drop while reading a 4xx body, only the error's name and code are included, so words in its message cannot accidentally make it retryable. The upstream error text is still included, so a 4xx whose text contains a word from pi-ai's patterns (such as `overloaded`) may be retried.

Pi's own retry must be enabled (`retry.enabled` in Pi's settings, which is on by default).

## Unknown tools

If the model calls a tool that is not in Pi's current tool list — for example `write` without the `mcp__pi__` prefix — the call is not failed. The prefix is removed if present and the name is passed to Pi as a normal tool call. Pi's agent loop then answers with an error tool result (`Tool … not found`), and the model can correct itself.
