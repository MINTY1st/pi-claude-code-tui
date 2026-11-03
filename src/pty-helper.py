"""Relay a command through a PTY and reap its process group on every exit path."""

from __future__ import annotations

import fcntl
import os
import select
import signal
import struct
import sys
import termios
import time
from types import FrameType
from typing import NoReturn

EXIT_GRACE_SECONDS = 0.25
CHILD_POLL_SECONDS = 0.1


def end_on_signal(number: int, _frame: FrameType | None) -> NoReturn:
    raise SystemExit(128 + number)


def signal_group(pid: int, number: int) -> None:
    if pid <= 1 or pid == os.getpgrp():
        raise RuntimeError("Refusing to signal the helper process group")
    try:
        os.killpg(pid, number)
    except ProcessLookupError:
        pass


def reap_group(pid: int) -> int:
    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, signal.SIG_IGN)
    # Reap the leader only after group cleanup, so its PID cannot be reused mid-cleanup.
    signal_group(pid, signal.SIGHUP)
    signal_group(pid, signal.SIGCONT)
    time.sleep(EXIT_GRACE_SECONDS)
    signal_group(pid, signal.SIGKILL)
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


def write_all(file_descriptor: int, data: bytes) -> None:
    while data:
        data = data[os.write(file_descriptor, data) :]


def relay(master: int, child_pid: int) -> None:
    # 孫が PTY を保持すると EOF は来ない。WNOWAIT で子の PID を確保したまま終了を検出する。
    while os.waitid(os.P_PID, child_pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is None:
        ready, _, _ = select.select([master, 0], [], [], CHILD_POLL_SECONDS)
        if master in ready:
            data = os.read(master, 65536)
            if not data:
                return
            write_all(1, data)
        if 0 in ready:
            data = os.read(0, 65536)
            if not data:
                return
            write_all(master, data)


def main() -> int:
    columns, rows, command = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
    pid, master = os.forkpty()
    if pid == 0:
        os.execvp(command[0], command)
    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, end_on_signal)
    try:
        fcntl.ioctl(
            master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0)
        )
        relay(master, pid)
    except OSError:
        pass
    finally:
        os.close(master)
        status = reap_group(pid)
    return status


if __name__ == "__main__":
    sys.exit(main())
