// src/tui-screen.ts に追加する部分（既存の PROMPT・BUSY_MARK・lastMatchIndex をそのまま使う）。
// 置き場所: PROMPT の定義の直後に PROMPT_ALL、turnFinished の直後に promptAfterBusy。

// lastMatchIndex は matchAll を使うため g フラグ付きの正規表現が要る。PROMPT（g なし）は .test 用に残す
const PROMPT_ALL = /❯[ \u00a0]/g;

// 終了行を取りこぼした画面の補助判定。応答中は入力欄の下のヒント行に「esc to interrupt」が描かれるため、
// 最後に描かれた入力欄より後ろにその表示が無ければ、入力欄は応答が終わったあとに描き直されたとみなす。
// 貼り付け直後の画面もこの条件を満たすため、単独では使わず、呼び出し側で上流の完了と画面の静止を併せて確かめる
export function promptAfterBusy(plain: string): boolean {
  const prompt = lastMatchIndex(PROMPT_ALL, plain);
  return prompt >= 0 && prompt > plain.lastIndexOf(BUSY_MARK);
}
