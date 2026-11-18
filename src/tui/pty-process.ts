import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startNodePty } from "./node-pty-process.ts";

/** python は pty-helper.py（os.forkpty）、node-pty は @lydell/node-pty（Windows では ConPTY） */
export type PtyBackend = "python" | "node-pty";

export interface PtySpec {
  command: string;
  commandArguments: string[];
  cwd: string;
  environment: Record<string, string | undefined>;
  columns: number;
  rows: number;
}

/** 端末の中で動く Claude Code。onExit は終了か起動の失敗で1回だけ知らせる */
export interface PtyProcess {
  onData(listener: (text: string) => void): void;
  onExit(listener: (failure?: Error) => void): void;
  write(text: string): void;
  /** 端末を閉じ、閉じたウィンドウと同じく Claude Code に終了を知らせる */
  close(): void;
  /** close で終わらないときに強制終了する */
  kill(): void;
  /** 終了の理由の手がかり（Python の補助スクリプトの stderr の末尾） */
  diagnostics(): string;
}

const HELPER_PATH = fileURLToPath(new URL("./pty-helper.py", import.meta.url));
const STDERR_KEEP = 2_000;

/** Windows には os.forkpty が無いため ConPTY を使う。Linux と macOS は確かめてきた Python の補助スクリプトのまま */
export function defaultPtyBackend(platform: NodeJS.Platform): PtyBackend {
  return platform === "win32" ? "node-pty" : "python";
}

export function startPty(backend: PtyBackend, spec: PtySpec): PtyProcess {
  return backend === "node-pty" ? startNodePty(spec) : startPythonPty(spec);
}

function startPythonPty(spec: PtySpec): PtyProcess {
  const child = spawn("python3", [HELPER_PATH, String(spec.columns), String(spec.rows), spec.command, ...spec.commandArguments], {
    cwd: spec.cwd,
    env: spec.environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stdout!.setEncoding("utf8");
  child.stdin!.on("error", () => undefined);
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-STDERR_KEEP)));
  const exited = new Promise<Error | undefined>((resolve) => {
    child.once("exit", () => resolve(undefined));
    child.once("error", (error) => resolve(new Error(`Unable to start Python PTY helper: ${error.message}`)));
  });
  return {
    onData: (listener) => void child.stdout!.on("data", listener),
    onExit: (listener) => void exited.then(listener),
    write: (text) => void child.stdin!.write(text),
    // pty-helper は stdin が閉じると端末を切る
    close: () => void child.stdin!.end(),
    kill: () => void child.kill("SIGKILL"),
    diagnostics: () => stderr,
  };
}
