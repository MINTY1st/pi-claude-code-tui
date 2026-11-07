import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bracketedPaste, createTerminalResponder, plainScreen, type ScreenState, screenState, turnFinished } from "./tui-screen.ts";

export interface TuiSessionOptions {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  /** inert MCP が tools/list に答えたら作るファイル */
  listedMarker: string;
  /** cwd のフォルダ信頼確認に Yes と答えてよいか */
  trustFolder: boolean;
  readyTimeoutMs?: number;
}

const COLUMNS = 200;
const ROWS = 50;
const DEFAULT_READY_TIMEOUT_MS = 45_000;
const POLL_MS = 50;
// 描かれた直後に送ったキーは再描画で失われることがあるため、同じ画面が続いてから送る（magpie の実測）
const SETTLE_MS = 300;
const DOWN_INTERVAL_MS = 1_000;
// 貼り付けを取り込み終える前の Enter は貼り付けの一部になる
const PASTE_SETTLE_MS = 150;
// /clear を打つとコマンドの候補一覧が描かれ、それが落ち着く前の Enter は候補の選択に使われる
const SLASH_MENU_MS = 800;
const SCREEN_KEEP = 128 * 1024;
const EXIT_GRACE_MS = 3_000;
const HELPER_PATH = fileURLToPath(new URL("./pty-helper.py", import.meta.url));

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** 対話 TUI の Claude Code を PTY で動かし、入力待ちの検知と貼り付けを受け持つ */
export class TuiSession {
  private raw = "";
  private readonly respond = createTerminalResponder();
  private exited = false;
  private failure?: Error;
  private stderr = "";
  private readonly exit: Promise<void>;

  private constructor(
    private readonly child: ChildProcess,
    private readonly options: TuiSessionOptions,
  ) {
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.receive(chunk));
    child.stdin!.on("error", () => undefined);
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-2_000)));
    this.exit = new Promise((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", (error) => {
        this.failure = new Error(`Unable to start Python PTY helper: ${error.message}`);
        resolve();
      });
    });
    void this.exit.then(() => (this.exited = true));
  }

  static start(options: TuiSessionOptions): TuiSession {
    const child = spawn("python3", [HELPER_PATH, String(COLUMNS), String(ROWS), options.command, ...options.args], {
      cwd: options.cwd,
      env: { ...options.env, TERM: "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new TuiSession(child, options);
  }

  isAlive(): boolean {
    return !this.exited;
  }

  lastScreen(): string {
    return plainScreen(this.raw).replace(/\s+/g, " ").trim().slice(-600);
  }

  async ready(signal?: AbortSignal): Promise<void> {
    const timeoutMs = this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const trust = { yesSince: 0, lastDown: 0 };
    let promptSince = 0;
    await this.poll(timeoutMs, () => this.readyFailure(), (state) => {
      if (state === "sign-in") throw new Error("Claude Code asks to sign in; run claude auth login first");
      if (state === "trust-no" || state === "trust-yes") {
        this.answerTrust(state, trust);
        return false;
      }
      if (state !== "prompt" || !existsSync(this.options.listedMarker)) {
        promptSince = 0;
        return false;
      }
      promptSince ||= Date.now();
      return Date.now() - promptSince >= SETTLE_MS;
    }, signal);
  }

  /** 中身は relay が Pi の会話に差し替えるため、貼る文は1回分のリクエストを起こすきっかけでしかない */
  async submit(text: string): Promise<void> {
    this.raw = "";
    this.write(bracketedPaste(text));
    await sleep(PASTE_SETTLE_MS);
    this.write("\r");
  }

  /**
   * 入力待ちに戻るまで待つ。lastActivityAt を渡すと、締め切りは「最後に上流から届いた時刻 + timeoutMs」になる。
   * 画面はスピナーが毎秒描き直すので、止まっていても変化し続け、進捗の目安にならない
   */
  async waitIdle(timeoutMs: number, lastActivityAt?: () => number): Promise<void> {
    await this.poll(timeoutMs, () => "Claude Code timed out: it did not finish its turn", () => turnFinished(plainScreen(this.raw)), undefined, lastActivityAt);
  }

  /** ターンごとに TUI 側の履歴を空にし、ツールの往復をまたいで同じプロセスを使い回す */
  async clear(timeoutMs: number): Promise<void> {
    this.write("/clear");
    await sleep(SLASH_MENU_MS);
    this.raw = "";
    this.write("\r");
    await this.poll(timeoutMs, () => "Claude Code did not come back from /clear", (state) => state === "prompt");
  }

  async close(): Promise<void> {
    if (this.exited) return;
    // pty-helper は stdin が閉じると端末を切り、閉じたウィンドウと同じく Claude Code に終了を知らせる
    this.child.stdin!.end();
    const timer = setTimeout(() => this.child.kill("SIGKILL"), EXIT_GRACE_MS);
    await this.exit;
    clearTimeout(timer);
  }

  private receive(chunk: string): void {
    for (const reply of this.respond(chunk)) this.write(reply);
    this.raw = (this.raw + chunk).slice(-SCREEN_KEEP);
  }

  private write(text: string): void {
    if (!this.exited) this.child.stdin!.write(text);
  }

  private answerTrust(state: ScreenState, trust: { yesSince: number; lastDown: number }): void {
    if (!this.options.trustFolder) {
      throw new Error(`Claude Code asks whether to trust ${this.options.cwd}; answer it once in a terminal`);
    }
    const now = Date.now();
    if (state === "trust-no") {
      trust.yesSince = 0;
      if (now - trust.lastDown < DOWN_INTERVAL_MS) return;
      trust.lastDown = now;
      this.write("\x1b[B");
      return;
    }
    trust.yesSince ||= now;
    if (now - trust.yesSince < SETTLE_MS) return;
    trust.yesSince = 0;
    this.raw = "";
    this.write("\r");
  }

  private readyFailure(): string {
    return existsSync(this.options.listedMarker)
      ? "Claude Code showed no prompt"
      : "Claude Code did not finish loading Pi's tool list";
  }

  private async poll(
    timeoutMs: number,
    describe: () => string,
    done: (state: ScreenState) => boolean,
    signal?: AbortSignal,
    lastActivityAt?: () => number,
  ): Promise<void> {
    const startedAt = Date.now();
    for (;;) {
      const deadline = Math.max(startedAt, lastActivityAt?.() ?? 0) + timeoutMs;
      signal?.throwIfAborted();
      if (this.failure) throw this.failure;
      if (this.exited) throw new Error(`Claude Code ended: ${this.lastScreen() || this.stderr.trim()}`);
      if (done(screenState(plainScreen(this.raw)))) return;
      if (Date.now() >= deadline) throw new Error(`${describe()} within ${timeoutMs}ms: ${this.lastScreen()}`);
      await sleep(POLL_MS);
    }
  }
}
