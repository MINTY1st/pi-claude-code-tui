#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

process.on("SIGHUP", () => undefined);
setInterval(() => undefined, 1_000);
if (process.argv[3] === "child") {
  process.send("ready");
} else {
  const child = spawn(process.execPath, [process.argv[1], process.argv[2], "child"], { stdio: ["ignore", process.argv.includes("--inherit-pty") ? "inherit" : "ignore", process.argv.includes("--inherit-pty") ? "inherit" : "ignore", "ipc"] });
  child.once("message", () => {
    writeFileSync(process.argv[2], JSON.stringify([process.pid, child.pid]));
    process.stdout.write("\r\n❯\u00a0\r\n");
  });
  process.stdin.setRawMode(true);
  process.stdin.resume();
}
