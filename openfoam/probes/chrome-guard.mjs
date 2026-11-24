// Chrome never outlives the probe driver that started it. Each package's
// probes/ carries its own copy of this file (packages don't import each
// other); keep the copies the same. Plain node, no dependencies.
//
//   const chrome = spawn(CHROME, args, { stdio: "ignore", detached: true });
//   guardChrome(chrome, { profile, stop });   // stop(code): the driver's own
//   ...
//   killChrome(chrome);                       // in the driver's stop
//
// 1. Chrome is spawned `detached`: its own process group, so one signal
//    reaches its helpers (the renderer, GPU and utility processes) too.
// 2. A watchdog (`/bin/sh`, detached and unref'd) polls this node process
//    every second. Once it's gone, by any means (kill -9 included, where no
//    handler of ours runs; a zombie its parent hasn't reaped counts as gone,
//    by `ps`'s state, where `kill -0` would still say it's there), it sends
//    TERM to Chrome's group, KILL after 2 s,
//    and removes the profile. It leaves early, doing nothing, if Chrome's
//    group is already gone, so it never signals a group id that's been
//    reused.
// 3. On "exit" the group gets KILL synchronously (and the profile goes).
//    SIGINT, SIGTERM, SIGHUP, an uncaught exception and an unhandled
//    rejection call the driver's `stop(code)` (130, 143, 129, 1, 1), which
//    exits; without one, they exit, and "exit" does the rest.
//
// probes/chrome-guard-check.mjs checks all six ways out with a stand-in
// for Chrome.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

const WATCHDOG = `
p=$1; g=$2; prof=$3
alive() {
  st=$(ps -o stat= -p "$1" 2>/dev/null) || return 1
  case "$st" in *Z*) return 1 ;; esac
  [ -n "$st" ]
}
while alive "$p"; do
  kill -0 -- "-$g" 2>/dev/null || exit 0
  sleep 1
done
kill -s TERM -- "-$g" 2>/dev/null
i=0
while [ $i -lt 20 ] && kill -0 -- "-$g" 2>/dev/null; do sleep 0.1; i=$((i + 1)); done
kill -s KILL -- "-$g" 2>/dev/null
case "$prof" in /?*/*) rm -rf -- "$prof" ;; esac
exit 0
`;

/** Every guarded Chrome in this process, with its profile and the driver's stop. */
const guarded = new Map();
let installed = false;

/** Signal a Chrome's whole process group (it was spawned detached); its main process alone if that fails. */
export function killChrome(chrome, signal = "SIGTERM") {
  if (!chrome?.pid) return;
  try {
    process.kill(-chrome.pid, signal);
  } catch {
    try {
      chrome.kill(signal);
    } catch {}
  }
}

function onExit() {
  for (const [chrome, { profile }] of guarded) {
    killChrome(chrome, "SIGKILL");
    if (profile) {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
    }
  }
}

function stopAll(code, why) {
  if (why) console.error(why);
  const stops = [...new Set([...guarded.values()].map((g) => g.stop).filter(Boolean))];
  if (!stops.length) process.exit(code);
  for (const stop of stops) {
    try {
      stop(code);
    } catch {
      process.exit(code);
    }
  }
}

function install() {
  if (installed) return;
  installed = true;
  process.on("exit", onExit);
  process.on("SIGINT", () => stopAll(130));
  process.on("SIGTERM", () => stopAll(143));
  process.on("SIGHUP", () => stopAll(129));
  process.on("uncaughtException", (e) => stopAll(1, e?.stack ?? String(e)));
  process.on("unhandledRejection", (e) => stopAll(1, e?.stack ?? String(e)));
}

/**
 * Make sure `chrome` (a ChildProcess spawned with `detached: true`) dies
 * with this process, and its `profile` directory goes with it.
 * @param {import("node:child_process").ChildProcess} chrome
 * @param {{ profile?: string | null, stop?: ((code: number) => void) | null }} [o]
 */
export function guardChrome(chrome, { profile = null, stop = null } = {}) {
  if (!chrome?.pid) return chrome;
  install();
  guarded.set(chrome, { profile, stop });
  chrome.once("exit", () => guarded.delete(chrome));
  const dog = spawn("/bin/sh", ["-c", WATCHDOG, "chrome-guard", String(process.pid), String(chrome.pid), profile ?? ""], { detached: true, stdio: "ignore" });
  dog.unref();
  return chrome;
}
