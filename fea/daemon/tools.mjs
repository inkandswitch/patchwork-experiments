// Finding and running the two programs a run needs: gmsh (the mesher) and
// ccx (CalculiX's solver).
//
// Each is looked for where it was named (--gmsh, --ccx, or $GMSH, $CCX),
// then where this package's own build puts ccx (daemon/install-calculix.sh:
// ~/.patchwork-fea/calculix/bin/ccx), then on PATH under the names packages
// give them (Debian's `ccx`, Homebrew's `ccx_2.23`).

import { spawn, execFileSync } from "node:child_process";
import { existsSync, createWriteStream } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";

const PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

/** How long a killed program's processes have to stop on SIGTERM before SIGKILL: well inside the 5 s a stopped task's thread is given. */
export const KILL_AFTER_MS = 3000;

function onPath(name) {
  for (const dir of [...(process.env.PATH ?? "").split(":"), ...PATHS]) if (dir && existsSync(join(dir, name))) return join(dir, name);
  return null;
}

export function findGmsh(named = process.env.GMSH) {
  if (named) {
    if (!existsSync(named)) throw new Error(`no gmsh at ${named}`);
    return named;
  }
  const found = onPath("gmsh");
  if (!found) throw new Error("no gmsh found: install it (macOS: brew install gmsh; Debian: apt install gmsh), or pass --gmsh");
  return found;
}

export function findCcx(named = process.env.CCX) {
  if (named) {
    if (!existsSync(named)) throw new Error(`no ccx at ${named}`);
    return named;
  }
  const own = join(homedir(), ".patchwork-fea/calculix/bin/ccx");
  if (existsSync(own)) return own;
  for (const name of ["ccx", "ccx_2.23", "ccx_2.22", "ccx_2.21", "ccx_2.20"]) {
    const found = onPath(name);
    if (found) return found;
  }
  throw new Error("no CalculiX (ccx) found: build it with daemon/install-calculix.sh (or Debian: apt install calculix-ccx), or pass --ccx");
}

const capture = (bin, args) => {
  try {
    return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 });
  } catch (err) {
    // both print their version and then exit as if they had failed
    return `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
  }
};

/** "4.15.2", or null if it didn't answer. */
export function gmshVersion(gmsh) {
  return capture("/bin/sh", ["-c", `"${gmsh}" --version 2>&1`]).match(/\d+\.\d+(\.\d+)?/)?.[0] ?? null;
}

/** "2.23", or null. */
export function ccxVersion(ccx) {
  return capture("/bin/sh", ["-c", `"${ccx}" -v 2>&1`]).match(/Version\s+(\d+\.\d+)/i)?.[1] ?? null;
}

/** How many cores a run gets by default: all but two, at most 8. */
export function defaultCores() {
  return Math.max(1, Math.min(8, availableParallelism() - 2));
}

/**
 * Run one program, its output to `logFile` and to `onLine` line by line.
 * `kill` resolves once the last of its processes has been sent SIGKILL.
 * @returns {{ done: Promise<{ code: number|null, signal: string|null }>, kill: () => Promise<void> }}
 */
export function run(bin, args, { cwd, logFile, onLine, env = {} } = {}) {
  const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
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
    // it and everything under it (ccx starts no children today; gmsh's threads are its own)
    const tree = descendants(child.pid);
    for (const pid of [child.pid, ...tree]) signal(pid, "SIGTERM");
    return new Promise((resolve) =>
      setTimeout(() => {
        for (const pid of [child.pid, ...tree, ...descendants(child.pid)]) signal(pid, "SIGKILL");
        resolve();
      }, KILL_AFTER_MS).unref(),
    );
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
