# Architecture

pi-claude-code-tui is a Pi provider that sends model calls through Claude Code, so requests are billed to the Claude subscription that Claude Code is logged in to. Pi keeps ownership of the conversation, tool execution and approvals; Claude Code only talks to the model.

## Two request paths

| Path | Selected by | How Claude Code runs |
|---|---|---|
| Interactive TUI (default) | `PI_CLAUDE_CODE_TUI` unset or not `0` | Claude Code's terminal UI runs in a pseudo-terminal (PTY). One process is reused per Pi session. |
| Print mode | `PI_CLAUDE_CODE_TUI=0` | `claude -p --input-format stream-json --output-format stream-json`, cached per session for up to 5 minutes. |

`streamClaudeCode` (`src/stream.ts`) picks the path for every call. Errors never fall back from one path to the other.

## The relay

In both paths Claude Code is started with `ANTHROPIC_BASE_URL` pointing to a local HTTP relay (`src/turn-relay.ts`). For each Pi call:

1. Pi's conversation is converted to native Anthropic frames (`src/transcript.ts`).
2. A trigger message is submitted to Claude Code (`continue` in the TUI).
3. When Claude Code sends its `/v1/messages` request, the relay replaces the transcript with Pi's frames, writes per-turn values into the body (`src/turn-body.ts`), forwards it upstream and streams the response back to both Claude Code and Pi.
4. Only the first upstream request of a call is forwarded. Any further request in the same call (for example Claude Code's own retry) is rejected with HTTP 400 and counted as a denied retry.

Authentication headers pass through the relay; the extension never reads Claude Code's credential files.

```mermaid
flowchart LR
    Pi[Pi agent loop] -->|frames, options| S[streamClaudeCode]
    S --> W{TUI enabled?}
    W -->|yes| T[TuiWorker / PTY]
    W -->|no| P[ClaudeProcess / claude -p]
    T --> CC[Claude Code]
    P --> CC
    CC -->|POST /v1/messages| R[TurnRelay]
    R -->|rewritten body| A[Anthropic API]
    A -->|SSE| R
    R -->|events| S
```

## Source map

| Area | Files |
|---|---|
| Extension entry and provider | `index.ts`, `provider.ts`, `model-catalog.ts` |
| Request conversion | `stream.ts`, `transcript.ts`, `tool-config.ts`, `tool-history.ts`, `tool-call-ids.ts`, `thinking-replay.ts`, `cache-breakpoints.ts` |
| Relay and response checks | `turn-relay.ts`, `relay-failure.ts`, `response-checks.ts`, `billing.ts`, `rate-limit-headers.ts` |
| Interactive TUI path | `tui-process.ts`, `turn-body.ts`, `tui-transcript.ts`, `tui-screen.ts`, `tui-lifecycle.ts`, `pty-session.ts`, `pty-helper.py`, `inert-mcp.mjs` |
| Print-mode path | `claude-print-process.ts`, `claude-print-cache.ts`, `initial-request.ts` |
| Claude Code executable and process | `claude-executable.ts`, `claude-models.ts`, `claude-spawn.ts`; `claude-cli.ts` re-exports them |

## Related documents

- [Turn lifecycle](turn-lifecycle.md)
- [Errors and retries](errors-and-retries.md)
- [Worker reuse](worker-reuse.md)
