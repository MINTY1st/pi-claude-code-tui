#!/usr/bin/env node
// テスト用の偽 claude。対話 TUI が PTY に描くものを最小限まねる（2.1.316 の実機の描画から）
// 環境変数: FAKE_SCREEN=trust|sign-in（起動時の画面）、FAKE_LOG（受け取った入力を書き出すファイル）
import { appendFileSync } from "node:fs";

const PROMPT = "\r\n────\r\n❯\u00a0\x1b[7m \x1b[27m\r\n────\r\n";
const log = (text) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, JSON.stringify(text) + "\n");
let screen = process.env.FAKE_SCREEN ?? "prompt";
let trustChoice = "No";
let pasted = "";

const draw = {
  trust: () => process.stdout.write(`\x1b[2J trust this folder\r\n ${trustChoice === "No" ? "❯ No, exit\r\n   Yes, I trust this folder" : "  No, exit\r\n ❯ Yes, I trust this folder"}\r\n`),
  "sign-in": () => process.stdout.write("Select login method:\r\n ❯ 1. Claude account with subscription\r\n"),
  prompt: () => process.stdout.write(PROMPT),
};

process.stdin.setRawMode(true);
process.stdout.write("\x1b[6n\x1b[c");
let answered = "";
process.stdin.on("data", (chunk) => {
  const text = chunk.toString("utf8");
  log(text);
  if (answered.length < 2 && (text.includes("\x1b[1;1R") || text.includes("\x1b[?62;c"))) {
    answered += text.includes("\x1b[1;1R") ? "R" : "c";
    if (answered.length >= 1) draw[screen]();
    return;
  }
  if (screen === "trust") {
    if (text === "\x1b[B") { trustChoice = "Yes"; draw.trust(); }
    else if (text === "\r" && trustChoice === "Yes") { screen = "prompt"; draw.prompt(); }
    else if (text === "\r") process.exit(1);
    return;
  }
  if (screen !== "prompt") return;
  if (text.startsWith("\x1b[200~")) { pasted = text; process.stdout.write(`\r❯ ${text.slice(6, -6)}\r\n`); return; }
  if (text === "/clear") { pasted = "/clear"; return; }
  if (text === "\r" && pasted) {
    const command = pasted === "/clear";
    pasted = "";
    process.stdout.write("✻ Thinking… (esc to interrupt)\r\n");
    setTimeout(() => process.stdout.write(`${command ? "" : "● ok\r\n"}✻ Worked for 0s\r\n${PROMPT}`), 200);
  }
});
