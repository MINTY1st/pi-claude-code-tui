# ADR-0001: PTY process-group cleanup

## Decision

Keep Python's standard library and the existing forkpty helper. Clean up the child's process group on helper exit, using the direct child's PID as the group ID. Refuse to signal the helper's own group or a group ID less than or equal to 1.

Close the PTY, send SIGHUP and SIGCONT, wait `EXIT_GRACE_SECONDS=0.25`, send SIGKILL, then call `waitpid`. Do not reap the direct child before group cleanup; keeping its PID allocated prevents reuse during cleanup. The grace period is shorter than Node's three-second helper-exit deadline.

Poll `waitid(WEXITED | WNOHANG | WNOWAIT)` every `CHILD_POLL_SECONDS=0.1` seconds to detect leader exit without reaping. A grandchild that inherits the PTY can keep it open after leader exit, so EOF and an indefinitely blocking `select` are not sufficient.

## Context

Killing only the Python helper left Claude Code and descendants that ignored SIGHUP alive. Put cleanup in the process that creates the PTY and group. Handle stdin EOF, normal termination signals, leader exit, PTY termination, and relay I/O failures, including stdout errors, through the same `finally` block.

## Decision table

| Question | Choice | Reason |
|---|---|---|
| PTY startup | Keep forkpty | Its child provides the independent session/process group |
| Cleanup unit | Child process group | A single PID misses ordinary descendants |
| Signal sequence | HUP + CONT, grace, KILL | Covers stopped processes and SIGHUP-ignoring processes |
| Reaping order | After group cleanup | Prevents leader PID reuse during cleanup |
| Extra OS-specific mechanisms | None | Avoids separate Linux cgroup/subreaper and macOS implementations |
| Escaped descendants | Outside the guarantee | killpg does not track descendants moved by setsid/setpgid |

## Verification and limits

Start a leader and a same-group grandchild that both ignore SIGHUP. Verify no live processes remain after four conditions: `TuiSession.close`, SIGTERM to the helper, SIGTERM to the leader, and SIGTERM to a leader whose grandchild inherits the PTY. Distinguish a temporarily unreaped zombie, which is no longer running, from a surviving process.

The helper cannot guarantee cleanup after its own external SIGKILL, or for processes stuck in uninterruptible kernel operations. macOS has not been verified on real hardware. The design was evaluated with `fast_grill`; the implementation uses a tested 0.25-second grace period rather than the proposed one second.
