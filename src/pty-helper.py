"""Run a command in a pseudo-terminal and relay bytes between it and this process's stdin/stdout.

Usage: python3 pty-helper.py <cols> <rows> <command> [args...]
Node has no PTY in its standard library, and node-pty needs a native build; Python's pty module is
available on Linux and macOS without one. Exits with the child's exit code.
"""
import fcntl
import os
import select
import struct
import sys
import termios


def main() -> int:
    cols, rows, command = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3:]
    pid, master = os.forkpty()
    if pid == 0:
        os.execvp(command[0], command)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    stdin_open = True
    while True:
        readable = [master] + ([0] if stdin_open else [])
        ready, _, _ = select.select(readable, [], [])
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            os.write(1, data)
        if 0 in ready:
            data = os.read(0, 65536)
            if data:
                os.write(master, data)
            else:
                # stdin を閉じられたら、閉じたウィンドウと同じく端末を切って子に終了を知らせる
                stdin_open = False
                os.close(master)
                break
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    sys.exit(main())
