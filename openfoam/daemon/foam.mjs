// Running OpenFOAM commands. Two ways to get an OpenFOAM environment:
//
//   launcher   a program that runs `-c "<cmd>"` inside OpenFOAM's shell. The
//              macOS app (gerlero/openfoam-app, `brew install --cask
//              gerlero/openfoam/openfoam`) installs one as `openfoam`; it
//              mounts the app's volume and sources the environment itself.
//   bashrc     a Linux install's etc/bashrc (e.g.
//              /usr/lib/openfoam/openfoam2606/etc/bashrc), sourced by bash
//              before each command. This is how a server runs it.
//
// Every command runs in its own process group, so cancelling a run kills
// mpirun and all its ranks, not just the shell.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, createWriteStream } from "node:fs";
import { availableParallelism } from "node:os";

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Find the macOS launcher if none was named. */
export function findLauncher() {
  for (const p of ["/opt/homebrew/bin/openfoam", "/usr/local/bin/openfoam"]) if (existsSync(p)) return p;
  try {
    return execFileSync("/bin/sh", ["-c", "command -v openfoam"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * @param {{ launcher?: string, bashrc?: string, mpirunArgs?: string }} o
 * @returns {{ describe: string, argv: (cmd: string) => [string, string[]], mpirun: (np: number, cmd: string) => string }}
 */
export function foamEnvironment({ launcher, bashrc, mpirunArgs = "" } = {}) {
  if (bashrc) {
    if (!existsSync(bashrc)) throw new Error(`no OpenFOAM bashrc at ${bashrc}`);
    return {
      describe: `bash, sourcing ${bashrc}`,
      argv: (cmd) => ["bash", ["-c", `source ${q(bashrc)} > /dev/null 2>&1; ${cmd}`]],
      mpirun: (np, cmd) => `mpirun -np ${np} ${mpirunArgs} ${cmd} -parallel`,
    };
  }
  const l = launcher ?? findLauncher();
  if (!l) throw new Error("no OpenFOAM found: install it (macOS: brew install --cask gerlero/openfoam/openfoam), or pass --launcher or --bashrc");
  return {
    describe: l,
    argv: (cmd) => [l, ["-c", cmd]],
    mpirun: (np, cmd) => `mpirun -np ${np} ${mpirunArgs} ${cmd} -parallel`,
  };
}

/** How many cores a run gets by default: all but two, at most 8 (mesh and memory stay laptop-sized). */
export function defaultCores() {
  return Math.max(1, Math.min(8, availableParallelism() - 2));
}

/**
 * Run one command in the case directory, its output to `logFile` and to
 * `onLine` line by line.
 * @returns {{ done: Promise<{ code: number|null, signal: string|null }>, kill: () => void }}
 */
export function run(env, cmd, { cwd, logFile, onLine }) {
  const [bin, args] = env.argv(cmd);
  const child = spawn(bin, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}` } });
  const log = logFile ? createWriteStream(logFile) : null;
  let carry = "";
  const take = (chunk) => {
    log?.write(chunk);
    const lines = (carry + chunk.toString("utf8")).split("\n");
    carry = lines.pop() ?? "";
    for (const l of lines) onLine?.(l);
  };
  child.stdout.on("data", take);
  child.stderr.on("data", take);
  const done = new Promise((resolve) => {
    child.on("error", (err) => {
      onLine?.(`(couldn't start: ${err.message})`);
      resolve({ code: 127, signal: null });
    });
    child.on("close", (code, signal) => {
      if (carry) onLine?.(carry);
      log?.end();
      resolve({ code, signal });
    });
  });
  const kill = () => {
    // not the process group: OpenMPI's launcher (prterun) makes its own, and
    // gives every rank another, so a group kill leaves the solver running.
    // Every descendant, then, launcher first (it stops its ranks cleanly).
    const tree = descendants(child.pid);
    for (const pid of [child.pid, ...tree]) signal(pid, "SIGTERM");
    setTimeout(() => {
      for (const pid of [child.pid, ...tree, ...descendants(child.pid)]) signal(pid, "SIGKILL");
    }, 3000).unref();
  };
  return { done, kill };
}

function signal(pid, sig) {
  try {
    process.kill(pid, sig);
  } catch {
    /* already gone */
  }
}

/** Every process under `root`, parents before children (from `ps`, so it works on macOS and Linux). */
export function descendants(root) {
  let table;
  try {
    table = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  } catch {
    return [];
  }
  const kids = new Map();
  for (const line of table.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!pid) continue;
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const out = [];
  const walk = (p) => {
    for (const c of kids.get(p) ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

/** The OpenFOAM version this environment runs (e.g. "v2606"), or null. */
export async function foamVersion(env) {
  let out = "";
  const r = run(env, "echo FOAMVERSION=$WM_PROJECT_VERSION", { onLine: (l) => (out += l + "\n") });
  await r.done;
  return out.match(/FOAMVERSION=(\S+)/)?.[1] ?? null;
}
