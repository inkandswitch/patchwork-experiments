// One Chrome at a time across every probe and session that honours the same
// lock: a directory, made with mkdir (atomic), held while Chrome runs,
// removed when the probe ends however it ends. Waits 20 s between tries; a
// lock untouched for 30 minutes is taken over as stale (whoever held it died
// without removing it); a holder touches it every minute, so a long probe's
// lock never looks stale.
//
//   await chromeLock(lockDir(args), { log })   // returns once held
//
// There is no running without it: lockDir() is --lock, else $CHROME_LOCK,
// and chromeLock() refuses to go on with neither. Released on "exit"; on
// SIGINT, SIGTERM and SIGHUP, when nothing else handles the signal (Chrome's
// guard, chrome-guard.mjs, stops Chrome and then exits, which releases it),
// it exits 130, 143 or 129, which releases it too: Node's default for those
// signals ends the process without an "exit", which would have left the
// lock behind for everyone for half an hour. src/chrome-lock.test.js checks
// each way out.
import { mkdirSync, rmdirSync, statSync, utimesSync } from "node:fs";
import { resolve } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIGNALS = [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]];

/** The lock's directory: --lock, else $CHROME_LOCK, else null (and chromeLock refuses). */
export function lockDir(args, env = process.env) {
  if (typeof args?.lock === "string") return resolve(args.lock);
  if (env.CHROME_LOCK) return resolve(env.CHROME_LOCK);
  return null;
}

export async function chromeLock(dir, { log = (s) => console.error(s), wait = 20_000, stale = 30 * 60_000, beat = 60_000 } = {}) {
  if (!dir) throw new Error("No Chrome lock: pass --lock <dir> or set CHROME_LOCK (one Chrome at a time across every probe and session; this probe won't start Chrome without it).");
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let age = 0;
      try {
        age = Date.now() - statSync(dir).mtimeMs;
      } catch {}
      if (age > stale) {
        log(`the Chrome lock is ${Math.round(age / 60000)} min old: taking it over as stale`);
        try {
          rmdirSync(dir);
        } catch {}
        continue;
      }
      log("waiting for the Chrome lock (another probe's Chrome is running)…");
      await sleep(wait);
    }
  }
  process.on("exit", () => {
    try {
      rmdirSync(dir);
    } catch {}
  });
  for (const [signal, code] of SIGNALS) {
    process.on(signal, () => {
      // another handler (Chrome's guard) stops Chrome and exits; alone, exit here: either way "exit" releases the lock
      if (process.listenerCount(signal) === 1) process.exit(code);
    });
  }
  const touch = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(dir, now, now);
    } catch {}
  }, beat);
  touch.unref?.();
  log(`holding the Chrome lock ${dir}`);
}
