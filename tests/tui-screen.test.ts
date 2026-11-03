import assert from "node:assert/strict";
import test from "node:test";
import { bracketedPaste, createTerminalResponder, plainScreen, screenState, terminalReplies, turnFinished } from "../src/tui-screen.ts";

test("plainScreen は CSI・OSC のエスケープを空白に置き換える", () => {
  assert.equal(plainScreen("\x1b[2J\x1b[1;1H❯ \x1b]0;title\x07ok"), "  ❯  ok");
});

test("terminalReplies はカーソル位置と端末属性の問い合わせに答える", () => {
  assert.deepEqual(terminalReplies("abc\x1b[6n"), ["\x1b[1;1R"]);
  assert.deepEqual(terminalReplies("\x1b[c"), ["\x1b[?62;c"]);
  assert.deepEqual(terminalReplies("\x1b[0c\x1b[6n"), ["\x1b[1;1R", "\x1b[?62;c"]);
  assert.deepEqual(terminalReplies("plain"), []);
});

test("反例: 端末問い合わせの全分割位置と一文字ずつの配送でも、各問い合わせに一度だけ返信する", () => {
  for (const query of ["\x1b[6n", "\x1b[c", "\x1b[0c"]) {
    const expected = terminalReplies(query);
    for (let index = 0; index <= query.length; index++) {
      const respond = createTerminalResponder();
      assert.deepEqual([...respond(query.slice(0, index)), ...respond(query.slice(index))], expected);
      assert.deepEqual(respond("plain"), []);
    }
    const respond = createTerminalResponder();
    assert.deepEqual([...query].flatMap((character) => respond(character)), expected);
  }
});

test("同じ問い合わせが複数回続いても、省略せず受信順にそれぞれ返信する", () => {
  const respond = createTerminalResponder();
  assert.deepEqual(respond("\x1b[c\x1b[6n\x1b[0c\x1b[6n"), ["\x1b[?62;c", "\x1b[1;1R", "\x1b[?62;c", "\x1b[1;1R"]);
});

const trust = (selected: "No" | "Yes") =>
  "Quick safety check: Is this a project you created or one you trust? trust this folder " +
  (selected === "No" ? "❯ No, exit   Yes, I trust this folder" : "  No, exit ❯ Yes, I trust this folder");

test("screenState はフォルダ信頼確認で、どちらが選ばれているかを返す", () => {
  assert.equal(screenState(trust("No")), "trust-no");
  assert.equal(screenState(trust("No") + " " + trust("Yes")), "trust-yes");
  assert.equal(screenState(trust("Yes") + " " + trust("No")), "trust-no");
});

test("screenState は応答中を入力待ちより優先する", () => {
  assert.equal(screenState("✻ Thinking… (esc to interrupt) ❯ "), "busy");
  assert.equal(screenState("● ok ✻ Churned for 1s ❯ "), "prompt");
  assert.equal(screenState("Claude Code v2.1.316"), "starting");
});

test("screenState は ❯ の後ろが NBSP の入力欄も入力待ちとみなす（2.1.316 の実機の描画）", () => {
  assert.equal(screenState("──── ❯\u00a0 ──── ⏸ manual mode on · ? for shortcuts"), "prompt");
});

test("screenState はログインを求める画面を見分ける", () => {
  assert.equal(screenState("Select login method: ❯ 1. Claude account with subscription"), "sign-in");
});

test("turnFinished は、ターン終了の行の後ろに入力欄が描かれたときだけ真になる", () => {
  assert.equal(turnFinished("❯\u00a0continue"), false);
  assert.equal(turnFinished("❯\u00a0continue ✻ Thinking… (esc to interrupt)"), false);
  assert.equal(turnFinished("● ok ✻ Worked for 0s ❯\u00a0"), true);
  assert.equal(turnFinished("● API Error: 400 denied ✻ Worked for 0s ──── ❯\u00a0 ────"), true);
  assert.equal(turnFinished("✻ Worked for 0s"), false);
  // スピナーにも ✻ が使われるため、手前の ✻ からターン終了の行と一致させない
  assert.equal(turnFinished("✻ Thinking… (esc to interrupt) ● ok ✻ Worked for 0s ❯\u00a0"), true);
});

test("反例: 分・時を含む終了時間でも、入力待ちがあれば終了とみなす", () => {
  for (const duration of ["1m 2s", "2m", "1h 2m 3s", "1h 3s"]) {
    assert.equal(turnFinished(`✻ Worked for ${duration}\r\n❯\u00a0`), true, duration);
    assert.equal(turnFinished(`✻ Worked for ${duration}`), false, duration);
    assert.equal(turnFinished(`✻ Worked for ${duration}\r\n✻ Thinking… (esc to interrupt) ❯\u00a0`), false, duration);
  }
});

test("bracketedPaste は文字列を貼り付けの開始と終了で囲む", () => {
  assert.equal(bracketedPaste("continue"), "\x1b[200~continue\x1b[201~");
});
