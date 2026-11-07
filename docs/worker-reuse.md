# Worker reuse (interactive TUI)

Starting Claude Code's TUI takes 2–7 seconds, so processes are reused across calls.

## Cache

- At most one worker per Pi session and two in total (`MAX_CACHED`).
- A worker idle for 15 minutes is closed.
- When the cache is full, the least recently used idle worker is evicted to make room. If every cached worker is busy, the new call uses a disposable worker that is closed afterwards.
- Concurrent calls in the same session and calls without a session ID always use disposable workers.
- A worker is replaced if its `/clear` did not come back or its process has exited.

## When a worker can be reused

A cached worker is reused only if its fingerprint matches the new call. The fingerprint is a hash of:

- working directory, environment, model, Pi's system prompt and tool manifest, `timeoutMs` and upstream URL,
- the launch body: `tools`, `max_tokens` and `thinking`,
- which per-turn keys are present (not their values).

Anything else that Claude Code only reads at startup must be part of the fingerprint, because the extra body is passed through `CLAUDE_CODE_EXTRA_BODY` in the launch `settings.json`.

## Per-turn values

`claude/auto` changes the effort level often (about one in five continuation turns in one measurement). To avoid a restart for each change, `output_config` and `context_management` are handled per turn (`src/turn-body.ts`):

- Their **values** are left out of the fingerprint.
- For every turn, the relay writes the current values into the top level of the request body, after the transcript has been replaced. A key is replaced as a whole and only if Claude Code's body already contains it.
- The launch `settings.json` still contains the values of the turn that started the worker. Without them, Claude Code adds different `anthropic-beta` headers.

`thinking` stays in the launch body and fingerprint. Removing it from `CLAUDE_CODE_EXTRA_BODY` changes the beta headers Claude Code sends, so switching reasoning on or off still restarts the worker.

These choices were verified against the real API: with per-turn values, the upstream body and beta headers match the previous behavior, and `cache_read_input_tokens` does not decrease.

## Print mode

The `claude -p` path has its own cache (`src/claude-print-cache.ts`): up to two processes, each kept for at most 5 minutes.
