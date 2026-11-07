// tests/tui-screen.test.ts の末尾に追加する部分。先頭の import に promptAfterBusy を足す:
// import { bracketedPaste, createTerminalResponder, plainScreen, promptAfterBusy, screenState, terminalReplies, turnFinished } from "../src/tui-screen.ts";

// 2026-11-05〜06 にタイムアウトした画面（Pi のセッション記録の errorMessage）から終了行だけを除いたもの。
// 応答中の欄の下には「esc to interrupt」が、終わったあとは「? for shortcuts」が描かれる
const BUSY_FRAME = "✶ Frosting… (14s · ↓ 799 tokens) ──── ❯ ──── ⏸ manual mode on · esc to interrupt";
const IDLE_REDRAW = "❯\u00a0? for shortcuts";

test("promptAfterBusy は、応答中の表示より後ろに入力欄が描き直されたときだけ真になる", () => {
  assert.equal(promptAfterBusy(`${BUSY_FRAME} ${IDLE_REDRAW}`), true);
  assert.equal(promptAfterBusy("● ok ──── ❯\u00a0 ────"), true);
});

test("反例: 応答中の画面（入力欄の後ろに esc to interrupt がある）では偽になる", () => {
  assert.equal(promptAfterBusy(BUSY_FRAME), false);
  assert.equal(promptAfterBusy("❯\u00a0continue ✻ Thinking… (esc to interrupt)"), false);
  // スピナーの描き直しは記号と経過秒だけで、入力欄もヒント行も描き直さない
  assert.equal(promptAfterBusy(`${BUSY_FRAME} ✶ e * ✢ n 7 ● · K ✢ * ✶ ✻ 8`), false);
});

test("反例: 入力欄が一度も描かれていない画面では偽になる", () => {
  assert.equal(promptAfterBusy(""), false);
  assert.equal(promptAfterBusy("● ok ✻ Thinking…"), false);
  assert.equal(promptAfterBusy("❯continue"), false);
});

test("境界値: esc to interrupt の直後の入力欄は真、直前の入力欄は偽になる", () => {
  assert.equal(promptAfterBusy("esc to interrupt❯\u00a0"), true);
  assert.equal(promptAfterBusy("❯\u00a0esc to interrupt"), false);
});

test("反例: 終了行がある画面の判定（turnFinished）は promptAfterBusy の追加で変わらない", () => {
  assert.equal(turnFinished(`${BUSY_FRAME} ✻ Brewed for done 1:27 AM ${IDLE_REDRAW}`), true);
  assert.equal(turnFinished(`${BUSY_FRAME} ${IDLE_REDRAW}`), false);
});
