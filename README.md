# pi-claude-code-tui

[![npm](https://img.shields.io/npm/v/@minty1st/pi-claude-code-tui)](https://www.npmjs.com/package/@minty1st/pi-claude-code-tui)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.21-339933)
![Status: Experimental](https://img.shields.io/badge/status-experimental-orange)

An experimental [Pi](https://pi.dev) provider that runs Claude Code's interactive terminal UI in a pseudo-terminal (PTY), rather than `claude -p`.

**Why:** Headless `claude -p` has been [reported](https://github.com/anthropics/claude-code/issues/97074) to use roughly 1.8× more of the five-hour usage window per token than the interactive UI. This provider drives the interactive UI instead. It has not been measured here, and usage behavior is not guaranteed.

Pi manages conversation history, approvals, and tool execution. Claude Code handles model communication. Compatible processes are reused, with Pi's conversation restored for each model call.

## Requirements

- Node.js 24.21 or later, Pi, and Claude Code.
- Python 3.9 or later as `python3`, with `os.forkpty`, `os.waitid`, and `os.WNOWAIT`.
- Linux or macOS. Tested on WSL2 with Claude Code 2.1.316 and Haiku 5.5; macOS is untested, and native Windows is unsupported.

## Install

```sh
pi install npm:@minty1st/pi-claude-code-tui
```

Or install the latest source from GitHub with `pi install git:github.com/MINTY1st/pi-claude-code-tui`. Use the scoped name above: the unscoped npm name `pi-claude-code-tui` belongs to an unrelated package.

Restart Pi after installation. Disable any other extension registering the same Claude Code provider.

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

Pi's request timeout (`retry.provider.timeoutMs`, defaulting to `httpIdleTimeoutMs`, 300 seconds) is an idle timeout: a turn fails only when nothing arrives from upstream for that long. A turn that keeps streaming, such as a long review, can run past it. The screen is not used as a sign of progress, because Claude Code's spinner redraws it every second even when the turn is stuck.

## Limitations

- Claude Code updates may break terminal-output detection. One live test timed out; retries passed, but the cause remains unknown.
- Pi's prompt is carried in a user message, not as system-level instructions. Complex tool schemas may be simplified; mid-conversation tool changes work only on supported models.
- Cross-provider tool-call IDs are normalized for Anthropic on outgoing replay only; saved history is unchanged. See [replay and folder trust](docs/cross-provider-replay.md).
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

[The CI workflow](.github/workflows/ci.yml) runs `npm ci --ignore-scripts`, `npm test`, and `npm run check` on Node 24.22.2 for every pull request and every push to `main`.

## Publishing

An owner-pushed `vX.Y.Z` tag triggers [the publishing workflow](.github/workflows/publish.yml).
The tagged commit must be in `main`, and the tag, manifest, and lockfile versions must match.
Tests and type checks run without publishing credentials; a separate job publishes the verified tarball.
After the package is published, a third job creates the GitHub Release for the tag with generated notes; only that job has `contents: write`.
The notes group pull requests by the labels `fix`, `feature`, `docs`, and `ci`/`chore` as defined in [.github/release.yml](.github/release.yml).

One-time npm setup: in this package's **Settings → Trusted Publisher**, select GitHub Actions,
set the owner and repository to this repository, and enter `publish.yml` as the workflow filename.
Allow direct publishing; leave the environment name empty. No npm token or GitHub secret is needed.
Keep repository write access limited to the owner. The workflow also checks the triggering actor,
but cannot distinguish the owner's terminal from an agent using the owner's credentials.

After merging a version update, explicitly request a release or push its tag:

```sh
git switch main
git pull --ff-only origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

Only stable versions are supported. Existing npm versions cannot be overwritten.
Do not create a release tag until the trusted publisher is configured.

## Credits and license

- [earendil-works/pi-claude-code](https://github.com/earendil-works/pi-claude-code), by Armin Ronacher — the upstream provider, conversation conversion, and relay implementation.
- [yetone/magpie](https://github.com/yetone/magpie), by yetone — reference for PTY operation, terminal queries, input settling, and readiness detection. This package uses relay-based response capture rather than magpie's JSONL/tap approach.

An unofficial fork, licensed under [MIT](LICENSE). Original copyright notices are preserved; see [third-party notices](THIRD_PARTY_NOTICES.md) for magpie's full MIT notice.
