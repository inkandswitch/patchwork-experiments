// A finite check of chrome-guard.mjs: a stand-in for Chrome (a shell that
// keeps a helper `sleep 600` in its process group, as Chrome keeps its
// renderers, and itself becomes `sleep 600`) is started and guarded by a
// stand-in driver, which then ends in each of the five ways a driver can:
// a normal exit, SIGINT, SIGTERM, an uncaught throw, SIGKILL (no handler
// runs; the watchdog must), and SIGKILL under a parent that never reaps it
// (it stays a zombie, which `kill -0` calls alive; the watchdog must not).
// Each time, within 3 s nothing of the stand-in's process group is left,
// and its profile directory is gone.
//
//   node probes/chrome-guard-check.mjs      (exit 0: all six held)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = fileURLToPath(new URL("./chrome-guard.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The stand-in driver: guard a stand-in Chrome, say its group and profile, then end as told. */
const DRIVER = `
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { guardChrome, killChrome } from ${JSON.stringify(GUARD)};
const [how, profile] = process.argv.slice(1);
const chrome = spawn("/bin/sh", ["-c", "sleep 600 & exec sleep 600"], { stdio: "ignore", detached: true });
const stop = (code) => { killChrome(chrome); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 100); };
guardChrome(chrome, { profile, stop });
console.log(JSON.stringify({ group: chrome.pid }));
// the check says when to end, once it has seen the stand-in running
process.stdin.once("data", () => {
  if (how === "exit") process.exit(0);
  if (how === "throw") throw new Error("a driver's bug");
});
setInterval(() => {}, 1000);
`;

/** Is anything of process group `g` alive? */
const groupAlive = (g) => spawnSync("pgrep", ["-g", String(g)]).status === 0;

/** Is process `p` a zombie (dead, not yet reaped)? */
const zombie = (p) => /Z/.test(spawnSync("ps", ["-o", "stat=", "-p", String(p)]).stdout?.toString() ?? "");

async function run(how) {
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "chrome-guard-check-"));
  // "zombie": the driver's parent is a shell that execs `sleep`, which never wait()s for it
  const neglect = how === "zombie";
  const driver = neglect
    ? spawn("/bin/sh", ["-c", `"$0" --input-type=module -e "$1" "$2" "$3" & echo "driver=$!"; exec sleep 600`, process.execPath, DRIVER, how, profile], { stdio: ["pipe", "pipe", "pipe"] })
    : spawn(process.execPath, ["--input-type=module", "-e", DRIVER, how, profile], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  driver.stdout.on("data", (d) => (out += d));
  driver.stderr.on("data", () => {});
  const lines = () => out.split("\n").filter(Boolean).map((l) => (l.startsWith("driver=") ? { driver: Number(l.slice(7)) } : JSON.parse(l)));
  for (let i = 0; i < 50 && !lines().some((l) => l.group); i++) await sleep(100);
  const group = lines().find((l) => l.group)?.group;
  const pid = neglect ? lines().find((l) => l.driver)?.driver : driver.pid;
  if (!group || !pid) return { how, ok: false, why: "the stand-in driver never said" };
  for (let i = 0; i < 50 && !groupAlive(group); i++) await sleep(20);
  if (!groupAlive(group) || !existsSync(profile)) return { how, ok: false, why: "the stand-in never started" };
  if (how === "SIGINT" || how === "SIGTERM" || how === "SIGKILL") driver.kill(how);
  else if (neglect) process.kill(pid, "SIGKILL");
  else driver.stdin.write("go\n");
  const t0 = Date.now();
  let gone = false;
  while (Date.now() - t0 < 3000) {
    if (!groupAlive(group) && !existsSync(profile)) {
      gone = true;
      break;
    }
    await sleep(100);
  }
  const ms = Date.now() - t0;
  // the case is only the case if the driver really was left a zombie meanwhile
  const wasZombie = neglect ? zombie(pid) : null;
  if (neglect) driver.kill("SIGKILL"); // its neglectful parent; init reaps the zombie
  if (!gone) {
    // don't leave it behind ourselves
    try {
      process.kill(-group, "SIGKILL");
    } catch {}
  }
  if (neglect && !wasZombie) return { how, ok: false, ms, why: "the driver wasn't left a zombie, so this didn't check it" };
  return { how, ok: gone, ms, ...(gone ? null : { left: { group: groupAlive(group), profile: existsSync(profile) } }) };
}

const results = [];
for (const how of ["exit", "SIGINT", "SIGTERM", "throw", "SIGKILL", "zombie"]) results.push(await run(how));
console.log(JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `FAIL: ${failed.map((r) => r.how).join(", ")}` : "PASS: the stand-in Chrome was gone within 3 s every way the driver ended");
process.exit(failed.length ? 1 : 0);
