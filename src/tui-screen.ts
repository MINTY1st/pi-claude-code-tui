// 対話 TUI の画面判定。VT エミュレータは持たず、PTY の出力からエスケープを除いた文字列で判定する（magpie と同じ方式）

const ANSI = /\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_][^\x1b]*\x1b\\|\x1b./g;
const TRUST_NO = /❯\s*No,\s*exit/g;
const TRUST_YES = /❯\s*Yes,\s*I trust/g;
// スピナーにも ✻ が使われるため、間に別の ✻ を挟まない最短の行だけを終了の行とみなす
const TURN_DONE = /✻ [^❯✻]*? for \d+s/g;
const BUSY_MARK = "esc to interrupt";
// 入力欄の ❯ の後ろは NBSP で描かれる（tmux は画面に描くとき普通の空白に変えるため、tmux 越しでは見えない）
const PROMPT = /❯[ \u00a0]/;

export type ScreenState = "starting" | "trust-no" | "trust-yes" | "sign-in" | "busy" | "prompt";

export function plainScreen(raw: string): string {
  return raw.replace(ANSI, " ");
}

// Claude Code は起動時にカーソル位置と端末属性を問い合わせ、答えが無いと描画を始めない
export function terminalReplies(chunk: string): string[] {
  const replies: string[] = [];
  if (chunk.includes("\x1b[6n")) replies.push("\x1b[1;1R");
  if (chunk.includes("\x1b[c") || chunk.includes("\x1b[0c")) replies.push("\x1b[?62;c");
  return replies;
}

function lastMatchIndex(pattern: RegExp, text: string): number {
  return [...text.matchAll(pattern)].at(-1)?.index ?? -1;
}

// 画面のバッファには前の描画も残るため、どの選択肢が選ばれているかは最後に描かれた ❯ で決める
function trustState(plain: string): ScreenState {
  return lastMatchIndex(TRUST_YES, plain) > lastMatchIndex(TRUST_NO, plain) ? "trust-yes" : "trust-no";
}

// 応答中の表示もバッファに残るため、ターン終了の行（✻ … for Ns）より後ろにあるときだけ応答中とみなす
function isBusy(plain: string): boolean {
  return plain.lastIndexOf(BUSY_MARK) > lastMatchIndex(TURN_DONE, plain);
}

export function screenState(plain: string): ScreenState {
  if (plain.includes("trust this folder")) return trustState(plain);
  if (plain.includes("Select login method")) return "sign-in";
  if (isBusy(plain)) return "busy";
  return PROMPT.test(plain) ? "prompt" : "starting";
}

// 貼り付けた直後の画面にも ❯ が描かれるため、入力欄だけではターンの終わりと区別できない。
// TUI はターンの終わりに必ず「✻ … for Ns」を描くので、その後ろに入力欄が描かれたことで判定する
export function turnFinished(plain: string): boolean {
  const done = lastMatchIndex(TURN_DONE, plain);
  if (done < 0 || isBusy(plain)) return false;
  return PROMPT.test(plain.slice(done));
}

export function bracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}
