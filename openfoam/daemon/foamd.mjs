#!/usr/bin/env node
// foamd: an OpenFOAM daemon for Patchwork.
//
//   node daemon/foamd.mjs [--sync wss://…] [--state ~/.patchwork-openfoam]
//                         [--cores N] [--jobs N] [--launcher /path/to/openfoam] [--bashrc /path/to/etc/bashrc]
//                         [--mpirun-args "…"] [--title "…"] [--new-server]
//
// It is an automerge peer, not a web service: it syncs with the same server
// Patchwork does, and owns one `openfoam-server` document, its inbox. It
// prints that document's URL; paste it into a case's "Server" field. A case
// asks for a run by adding it to the inbox's `requests`; this takes them
// oldest first, one at a time, and writes progress and results into each
// run's own document. Nothing listens on a port, so it runs the same on a
// laptop or on a server anywhere.
//
// --cores is the cores each run gets; --jobs how many runs go at once (1 by
// default). CFD is limited by memory bandwidth, so a laptop gains little from
// a second run; a big server does best as several runs of a few dozen cores
// each (192 cores: --jobs 6 --cores 32).
//
// State (--state, default ~/.patchwork-openfoam): config.json (the inbox URL
// and this daemon's id, so a restart keeps its inbox), automerge/ (a local
// copy of every doc it touches), runs/<id>/ (each run's OpenFOAM case,
// kept for ParaView).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir, hostname, platform, arch } from "node:os";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { dirname as dirOf } from "node:path";
import { fileURLToPath } from "node:url";
import { foamEnvironment, foamVersion, defaultCores } from "./foam.mjs";
import { runJob } from "./runner.mjs";
import { newServer, pendingRequests, activeRuns, isTerminal, HEARTBEAT_MS, PROTOCOL_VERSION, SERVER_TYPE } from "../src/protocol.js";

const VERSION = "0.1.0";

/**
 * This daemon's own code: the git commit it runs from, and whether the
 * package has changes on top (a run's case is written by this code, so it
 * belongs with what a run was made from). Null outside a git checkout.
 */
function codeCommit() {
  const here = dirOf(fileURLToPath(import.meta.url));
  try {
    const head = spawnSync("git", ["-C", here, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" });
    if (head.status !== 0) return null;
    const dirty = spawnSync("git", ["-C", here, "status", "--porcelain", "--", ".."], { encoding: "utf8" });
    return { commit: head.stdout.trim(), dirty: dirty.status === 0 && dirty.stdout.trim().length > 0 };
  } catch {
    return null;
  }
}
const CODE = codeCommit();

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const k = a.slice(2);
    if (["new-server", "help"].includes(k)) out[k] = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`--${k} needs a value`);
      out[k] = v;
    }
  }
  const known = new Set(["sync", "state", "cores", "jobs", "launcher", "bashrc", "mpirun-args", "title", "new-server", "help"]);
  for (const k of Object.keys(out)) if (!known.has(k)) throw new Error(`unknown option --${k}`);
  return out;
}

const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: timed out after ${ms / 1000} s`)), ms))]);

export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(String(err.message));
    args = { help: true };
  }
  if (args.help) {
    console.error(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 9).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    process.exit(1);
  }
  const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
  const stateDir = resolve(args.state ?? process.env.FOAMD_STATE ?? join(homedir(), ".patchwork-openfoam"));
  mkdirSync(join(stateDir, "runs"), { recursive: true });
  const configFile = join(stateDir, "config.json");
  const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
  config.daemonId ??= randomUUID();
  const save = () => writeFileSync(configFile, JSON.stringify(config, null, 2));
  save();

  const say = (m) => console.log(`${new Date().toTimeString().slice(0, 8)} ${m}`);
  const env = foamEnvironment({ launcher: args.launcher, bashrc: args.bashrc, mpirunArgs: args["mpirun-args"] ?? "" });
  const cores = args.cores ? Math.max(1, Number(args.cores) | 0) : defaultCores();
  const jobs = args.jobs ? Math.max(1, Number(args.jobs) | 0) : 1;
  say(`OpenFOAM via ${env.describe}`);
  const foam = await foamVersion(env);
  if (!foam) throw new Error("OpenFOAM didn't start: check the launcher or bashrc");
  say(`OpenFOAM ${foam}, ${cores} cores a run, ${jobs} run${jobs > 1 ? "s" : ""} at once`);

  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  const { NodeFSStorageAdapter } = await import("@automerge/automerge-repo-storage-nodefs");
  await initSubduction();
  const repo = new Repo({ storage: new NodeFSStorageAdapter(join(stateDir, "automerge")), network: [], subductionWebsocketEndpoints: [SYNC] });
  say(`syncing with ${SYNC}`);

  const daemonInfo = () => ({
    id: config.daemonId,
    host: hostname(),
    platform: `${platform()} ${arch()}`,
    openfoam: foam,
    cores,
    jobs,
    version: VERSION,
    commit: CODE?.commit ?? null,
    dirty: CODE?.dirty ?? null,
    protocol: PROTOCOL_VERSION,
    startedAt,
    heartbeat: Date.now(),
  });
  const startedAt = Date.now();

  let server;
  if (config.serverUrl && !args["new-server"]) {
    server = await within(60_000, repo.find(config.serverUrl), "loading the inbox");
    if (server.doc()?.["@patchwork"]?.type !== SERVER_TYPE) throw new Error(`${config.serverUrl} isn't an openfoam-server doc`);
  } else {
    server = await repo.create2(newServer({ title: args.title ?? `OpenFOAM on ${hostname()}`, daemon: daemonInfo() }));
    config.serverUrl = server.url;
    save();
    say("made a new inbox");
  }
  server.change((d) => {
    d.daemon = daemonInfo();
    if (args.title) d.title = args.title;
  });
  console.log(`\n  inbox: ${server.url}\n  open:  https://patchwork.inkandswitch.com/#doc=${server.url}\n  paste the inbox url into a case's Server field\n`);

  // runs this daemon was in the middle of when it last stopped can't be resumed
  for (const stale of activeRuns(server.doc())) {
    say(`the run ${stale.id} was interrupted`);
    try {
      const h = await within(30_000, repo.find(stale.run), "loading the interrupted run");
      if (!isTerminal(h.doc().status))
        h.change((d) => {
          d.status = "failed";
          d.error = "the daemon stopped while this ran; run it again";
          d.finishedAt = Date.now();
          for (const s of d.stages ?? []) if (s.status === "running") s.status = "failed";
        });
    } catch (err) {
      say(`couldn't mark it failed: ${err.message}`);
    }
    server.change((d) => {
      d.handled[stale.id] = { at: Date.now(), status: "failed" };
    });
  }
  server.change((d) => {
    // the inbox's running map, fresh (and replacing an older daemon's single slot)
    if (!d.active || typeof d.active !== "object" || "request" in d.active || Object.keys(d.active).length) d.active = {};
  });

  const beat = setInterval(() => server.change((d) => (d.daemon.heartbeat = Date.now())), HEARTBEAT_MS);

  const running = new Map(); // request id → AbortController
  let taking = false;
  const waitingFor = new Set();
  let stopping = false;
  const markHandled = (id, status) =>
    server.change((d) => {
      d.handled[id] = { at: Date.now(), status };
      if (d.active && typeof d.active === "object") delete d.active[id];
    });

  /** Settle requests that need no work: cancelled while waiting, or not a run at all. */
  const sweep = async (pending) => {
    for (const r of pending) {
      let h;
      try {
        h = await within(30_000, repo.find(r.run), `loading ${r.id}`);
      } catch {
        continue; // not here yet: try again later
      }
      const doc = h.doc();
      if (!doc?.setup || !doc?.hull) {
        markHandled(r.id, "invalid");
        continue;
      }
      if (isTerminal(doc.status)) markHandled(r.id, doc.status);
      else if (doc.control?.cancel)
        h.change((d) => {
          d.status = "cancelled";
          d.finishedAt = Date.now();
        });
    }
  };

  const waiting = () => pendingRequests(server.doc()).filter((r) => !running.has(r.id));

  // a Mac that idles to sleep mid-run stops the solver and drops the sync
  // connection: hold idle sleep off while anything runs (and only then)
  let awake = null;
  const stayAwake = (on) => {
    if (process.platform !== "darwin") return;
    if (on && !awake) {
      try {
        awake = spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" });
        awake.on("error", () => (awake = null));
      } catch {
        awake = null;
      }
    } else if (!on && awake) {
      awake.kill();
      awake = null;
    }
  };

  /** Start one run; it frees its slot (and looks for the next) when it ends. */
  const start = (next, h) => {
    const abort = new AbortController();
    running.set(next.id, abort);
    stayAwake(true);
    server.change((d) => {
      if (!d.active || typeof d.active !== "object") d.active = {};
      d.active[next.id] = { run: next.run, since: Date.now() };
    });
    say(`running ${next.id} (${h.doc().title})${next.by ? ` for ${next.by}` : ""}; ${running.size} of ${jobs} slots busy`);
    runJob({ repo, handle: h, env, workDir: join(stateDir, "runs"), cores, daemon: { id: config.daemonId, host: hostname(), platform: `${platform()} ${arch()}`, openfoam: foam, version: VERSION, commit: CODE?.commit ?? null, dirty: CODE?.dirty ?? null }, say, signal: abort.signal })
      .then((status) => markHandled(next.id, status))
      .catch((err) => {
        say(`run ${next.id}: ${err?.stack ?? err}`);
        markHandled(next.id, "failed");
      })
      .finally(() => {
        running.delete(next.id);
        if (!running.size) stayAwake(false);
        if (!stopping) setTimeout(take, 200);
      });
  };

  /** Fill free slots with the oldest requests, one at a time, in order. */
  const take = async () => {
    if (taking || stopping) return;
    taking = true;
    try {
      while (running.size < jobs && !stopping) {
        const pending = waiting();
        if (!pending.length) break;
        await sweep(pending);
        const next = waiting()[0];
        if (!next) break;
        let h;
        try {
          h = await within(60_000, repo.find(next.run), `loading ${next.id}`);
        } catch (err) {
          // a run doc can take a few seconds to reach here after its request does
          if (!waitingFor.has(next.id)) say(`${next.id}: not here yet (${err.message}); waiting for it`);
          waitingFor.add(next.id);
          break;
        }
        if (isTerminal(h.doc().status)) {
          markHandled(next.id, h.doc().status);
          continue;
        }
        start(next, h);
      }
    } catch (err) {
      say(`queue: ${err?.stack ?? err}`);
    } finally {
      taking = false;
    }
  };
  server.on("change", () => take());
  const poll = setInterval(take, 5000);
  take();

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    say("stopping");
    clearInterval(beat);
    clearInterval(poll);
    for (const a of running.values()) a.abort();
    // let each runner kill its command and write its status
    for (let i = 0; i < 80 && running.size; i++) await new Promise((r) => setTimeout(r, 100));
    try {
      server.change((d) => {
        d.daemon.heartbeat = 0;
      });
      await repo.flush?.();
      await new Promise((r) => setTimeout(r, 1500));
      say("stopped");
    } catch (err) {
      say(`stopping: ${err?.stack ?? err}`);
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return { repo, server };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
  });
}
