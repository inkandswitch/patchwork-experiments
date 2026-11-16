// @vitest-environment node
// The probes' Chrome lock (probes/chrome-lock.mjs), held by a stand-in
// probe in a child process and ended each way a probe can end: a normal
// exit, an uncaught throw, SIGINT, SIGTERM, SIGHUP on their own, and a
// signal another handler (Chrome's guard) takes and exits on. Each time the
// lock is gone afterwards. Also: no lock, no start; a held lock is waited
// for; a stale one is taken over; a holder keeps its lock fresh.
import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, statSync, utimesSync, writeFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromeLock, lockDir } from "../probes/chrome-lock.mjs";

const LOCK = fileURLToPath(new URL("../probes/chrome-lock.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "chrome-lock-test-"));
const HOLDER = join(work, "holder.mjs");
writeFileSync(
  HOLDER,
  `import { chromeLock } from ${JSON.stringify(LOCK)};
const [dir, other] = process.argv.slice(2);
await chromeLock(dir, { log: () => {}, wait: 20, stale: 60_000, beat: 30 });
if (other === "guard") for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => setTimeout(() => process.exit(7), 50));
console.log("held");
setInterval(() => {}, 1000);
process.stdin.on("data", (d) => {
  const how = String(d).trim();
  if (how === "exit") process.exit(0);
  if (how === "throw") throw new Error("a probe's bug");
});
`,
);

/** Start a holder on `dir`; resolves with it once it says it holds the lock (or after `ms`, held or not). */
function holder(dir, other = "", ms = 5000) {
  const child = spawn(process.execPath, [HOLDER, dir, other], { stdio: ["pipe", "pipe", "ignore"] });
  const exited = new Promise((r) => child.once("exit", (code) => r(code)));
  const held = new Promise((r) => {
    child.stdout.on("data", (d) => String(d).includes("held") && r(true));
    setTimeout(() => r(false), ms);
  });
  return { child, exited, held };
}

let seq = 0;
const fresh = () => join(work, `lock-${++seq}`);

describe("the Chrome lock", () => {
  it("won't start without one: --lock, else $CHROME_LOCK, else refused", async () => {
    expect(lockDir({ lock: "/x/y" }, {})).toBe("/x/y");
    expect(lockDir({}, { CHROME_LOCK: "/a/b" })).toBe("/a/b");
    expect(lockDir({ lock: true }, {})).toBe(null);
    expect(lockDir({}, {})).toBe(null);
    await expect(chromeLock(null)).rejects.toThrow(/No Chrome lock/);
  });

  for (const [how, code] of [["exit", 0], ["throw", 1], ["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    it(`is released when the probe ends by ${how} (exit ${code})`, async () => {
      const dir = fresh();
      const h = holder(dir);
      expect(await h.held).toBe(true);
      expect(existsSync(dir)).toBe(true);
      if (how.startsWith("SIG")) h.child.kill(how);
      else h.child.stdin.write(`${how}\n`);
      expect(await h.exited).toBe(code);
      expect(existsSync(dir)).toBe(false);
    });
  }

  it("leaves a signal to another handler (Chrome's guard) when there is one, and is released when it exits", async () => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const dir = fresh();
      const h = holder(dir, "guard");
      expect(await h.held).toBe(true);
      h.child.kill(signal);
      expect(await h.exited).toBe(7);
      expect(existsSync(dir)).toBe(false);
    }
  });

  it("waits while another holds it, and takes it once released", async () => {
    const dir = fresh();
    mkdirSync(dir);
    const h = holder(dir, "", 400);
    expect(await h.held).toBe(false);
    rmdirSync(dir);
    const again = new Promise((r) => h.child.stdout.on("data", (d) => String(d).includes("held") && r(true)));
    expect(await again).toBe(true);
    h.child.stdin.write("exit\n");
    expect(await h.exited).toBe(0);
    expect(existsSync(dir)).toBe(false);
  });

  it("takes over a lock left untouched past its staleness, and keeps its own fresh while it holds it", async () => {
    const dir = fresh();
    mkdirSync(dir);
    const hourAgo = new Date(Date.now() - 3600_000);
    utimesSync(dir, hourAgo, hourAgo);
    const h = holder(dir);
    expect(await h.held).toBe(true);
    utimesSync(dir, hourAgo, hourAgo);
    await sleep(300);
    expect(Date.now() - statSync(dir).mtimeMs).toBeLessThan(60_000);
    h.child.stdin.write("exit\n");
    expect(await h.exited).toBe(0);
  });
});
