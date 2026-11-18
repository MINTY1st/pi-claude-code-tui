import { createRequire } from "node:module";
import type { IPty } from "@lydell/node-pty";
import { cmdCommandLine, killPidTree } from "../claude/claude-spawn.ts";
import type { PtyProcess, PtySpec } from "./pty-process.ts";

type NodePty = typeof import("@lydell/node-pty");

// optionalDependencies なので、入っていない環境でも拡張の読み込みは失敗させず、起動したときに失敗として返す
const loadNodePty = (): NodePty => createRequire(import.meta.url)("@lydell/node-pty") as NodePty;

/**
 * Windows で起動するファイルと引数。.cmd と .bat は CreateProcess で直接動かないため cmd.exe 越しにし、
 * node-pty が引用し直さないよう、組み立てたコマンド行を文字列で渡す
 */
export function windowsPtyCommand(command: string, commandArguments: string[], comspec: string): { file: string; commandLine: string[] | string } {
  if (!/\.(?:cmd|bat)$/iu.test(command)) return { file: command, commandLine: commandArguments };
  return { file: comspec, commandLine: `/d /s /c "${cmdCommandLine(command, commandArguments)}"` };
}

function definedEnvironment(environment: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function spawnPty(spec: PtySpec, load: () => NodePty): IPty {
  const environment = definedEnvironment(spec.environment);
  const target = process.platform === "win32"
    ? windowsPtyCommand(spec.command, spec.commandArguments, environment.COMSPEC || process.env.COMSPEC || "cmd.exe")
    : { file: spec.command, commandLine: spec.commandArguments };
  return load().spawn(target.file, target.commandLine, { name: environment.TERM ?? "xterm-256color", cols: spec.columns, rows: spec.rows, cwd: spec.cwd, env: environment });
}

export function startNodePty(spec: PtySpec, load: () => NodePty = loadNodePty): PtyProcess {
  let pty: IPty | undefined;
  let exited: Promise<Error | undefined>;
  try {
    const started = spawnPty(spec, load);
    pty = started;
    exited = new Promise((resolve) => started.onExit(() => resolve(undefined)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    exited = Promise.resolve(new Error(`Unable to start Claude Code through node-pty: ${message}`));
  }
  let ended = !pty;
  void exited.then(() => (ended = true));
  const alive = (): IPty | undefined => (ended ? undefined : pty);
  return {
    onData: (listener) => void pty?.onData(listener),
    onExit: (listener) => void exited.then(listener),
    write: (text) => alive()?.write(text),
    // Windows では疑似コンソールを閉じ、つながったプロセスに閉じたウィンドウと同じ知らせを送る。Unix では SIGHUP
    close: () => alive()?.kill(),
    kill: () => {
      const target = alive();
      if (target) killPidTree(target.pid);
    },
    diagnostics: () => "",
  };
}
