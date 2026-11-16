// One Chrome at a time across every probe that honours the same lock: a
// directory, made with mkdir (atomic), held while Chrome runs, removed on
// exit. Waits 20 s between tries; a lock older than 30 minutes is taken
// over as stale (whoever held it died without removing it).
//
//   await chromeLock(dir, { log })   // returns once held; removed on process exit
import { mkdirSync, rmdirSync, statSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function chromeLock(dir, { log = (s) => console.error(s), wait = 20_000, stale = 30 * 60_000 } = {}) {
  if (!dir) return;
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
  log(`holding the Chrome lock ${dir}`);
}
