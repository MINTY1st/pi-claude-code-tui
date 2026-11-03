# pi-claude-code-tui

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.21-339933)
![Status: Experimental](https://img.shields.io/badge/status-experimental-orange)

An experimental [Pi](https://pi.dev) provider that runs Claude Code's interactive terminal UI in a pseudo-terminal (PTY), rather than `claude -p`.

Pi manages conversation history, approvals, and tool execution. Claude Code handles model communication. Compatible processes are reused, with Pi's conversation restored for each model call.

## Requirements

- Node.js 24.21 or later, Pi, and Claude Code.
- Python 3.9 or later as `python3`, with `os.forkpty`, `os.waitid`, and `os.WNOWAIT`.
- Linux or macOS. Tested on WSL2 with Claude Code 2.1.316 and Haiku 5.5; macOS is untested, and native Windows is unsupported.

## Install

```sh
pi install git:github.com/MINTY1st/pi-claude-code-tui
```

Restart Pi after installation. Disable any other extension registering the same Claude Code provider.

The first npm release is pending. The planned name is **`@minty1st/pi-claude-code-tui`**, subject to scope ownership verification. Once published, install with `pi install npm:@minty1st/pi-claude-code-tui`. The unscoped npm name belongs to an unrelated package.

## Usage

Authenticate Claude Code:

```sh
claude auth login
```

Run `claude` once in your working directory, complete folder trust, and exit. This extension does not approve folder trust automatically by default.

Start Pi and select **Claude Code Subscription (Experimental)** in the model picker. Use `/claude-code-status` inside Pi to check detection and authentication.

To try a source checkout without other extensions:

```sh
pi -ne -e /absolute/path/to/pi-claude-code-tui/src/index.ts \
  --provider claude-code --model haiku
```

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PI_CLAUDE_CODE_TUI` | TUI enabled | `0` selects `claude -p`; errors never trigger an automatic fallback. |
| `PI_CLAUDE_CODE_TUI_TRUST` | No automatic approval | `1` approves folder trust automatically. Use only for directories you trust. |
| `PI_CLAUDE_CODE_COMMAND` | `claude` | Claude Code executable name or path. |
| `PI_CLAUDE_CODE_CONFIG_DIR` | Unset | Passed to Claude Code as `CLAUDE_CONFIG_DIR`. |
| `PI_CLAUDE_CODE_ALLOW_USAGE_CREDITS` | Not allowed | `1` accepts responses that use usage credits. |

Claude Code manages authentication. The extension does not read or copy credential files; authenticated request headers pass through a local relay.

## Limitations

- Claude Code updates may break terminal-output detection. One live test timed out; retries passed, but the cause remains unknown.
- Pi's prompt is carried in a user message, not as system-level instructions. Complex tool schemas may be simplified; mid-conversation tool changes work only on supported models.
- Each call replays Pi's history after `/clear`, rather than resuming a native Claude Code conversation. Only the first upstream request is forwarded; additional requests in that call are rejected.
- One process is cached per session, two across the extension, with a 15-minute idle expiry. Concurrent requests and requests without a session ID use disposable workers.
- Cleanup covers the same process group only, not descendants escaping with `setsid`/`setpgid` or SIGKILL of the PTY helper itself.

## Development

From a source checkout:

```sh
npm ci
npm test
npm run check
npm pack --dry-run
```

Tests use a fake Claude Code and local upstream, not the real model service. PTY tests start real child processes and require `python3`.

## Credits and license

- [earendil-works/pi-claude-code](https://github.com/earendil-works/pi-claude-code), by Armin Ronacher — the upstream provider, conversation conversion, and relay implementation.
- [yetone/magpie](https://github.com/yetone/magpie), by yetone — reference for PTY operation, terminal queries, input settling, and readiness detection. This package uses relay-based response capture rather than magpie's JSONL/tap approach.

An unofficial fork, licensed under [MIT](LICENSE). Original copyright notices are preserved; see [third-party notices](THIRD_PARTY_NOTICES.md) for magpie's full MIT notice.
