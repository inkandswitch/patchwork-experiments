// The integration bench: the host with the real engines, on real
// automerge-repo over SimNet, in virtual time. Chocolate Doom plays the bot
// demos, the Super NES plays scripted Unarmed; 2 or 4 players at 0, 50 or
// 150 ms one-way latency (fixed, lossless), plus a spectator who joins late
// from a checkpoint. Session periods are the host's defaults (chunk 1 s,
// checkpoint every 60 s, seat documents roll every 10 min).
//
// Every run is a test: it ends paused, and every peer's state at every tick
// it confirmed must equal the state the documents give (the harness traces
// each engine). Alongside, it measures, per engine and configuration:
// rollbacks per second and their depth; CPU per second of play, split into
// simulation (every step, re-steps included), rendering (each peer draws its
// own view every frame), snapshots (snapshot and restore) and the rest of the
// host's frame; durable bytes per minute; and the late joiner's time.
//
//   pnpm bench:integration                  (needs engines/doom/test/freedoom1.wad for Doom)
//   MACHINE_BENCH_OUT=x.json pnpm bench:integration
//   MACHINE_BENCH=doom-2-50 pnpm bench:integration   (one configuration)
//
// Real time comes from process.hrtime, taken before the fake timers replace
// it; the tracing hashes are kept out of every figure.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as A from "@automerge/automerge";
import { initSubduction } from "@automerge/automerge-repo";
import { SimNet } from "../src/host/simnet.js";
import { rig, FRAME, SKEWS } from "../src/host/harness.js";
import { gunzip } from "../src/host/session.js";
import { hashSnapshot } from "../src/wasm-state.js";
import { compile, identify } from "../src/engine.js";
import { content as doomContent, demo } from "../src/doom.js";
import { TWO_PLAYERS, FOUR_PLAYERS, pads, B, Y, A as BUTTON_A, X, LEFT, RIGHT } from "../engines/snes/test/unarmed.js";

await initSubduction();
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const PLAY = 90; // seconds of play
const JOIN = 70; // when the spectator opens the session (after the first checkpoint, at 60 s)
const here = (p) => new URL(p, import.meta.url);
const iwad = process.env.FREEDOOM1 ?? here("../engines/doom/test/freedoom1.wad").pathname;
const only = process.env.MACHINE_BENCH;
const results = [];

// ---- the engines and their inputs

function doom(n) {
  const bot = demo(readFileSync(here(`../engines/doom/test/bot${n}p.lmp`)));
  return {
    wasm: readFileSync(here("../engines/doom/dist/doom.wasm")),
    content: doomContent({ wads: [readFileSync(iwad)], args: bot.args }),
    // Each port plays its bot's recorded ticcmds, at the tick its clock says.
    input: (p, t) => bot.tics[t % bot.tics.length].subarray(p.port * 6, p.port * 6 + 6),
    view: (p) => p.port ?? 0,
  };
}

// Unarmed's scripts reach a round by frame 1200 and end by 1400; from 1500
// each pad keeps fighting on a fixed 150-frame pattern of its own phase, so
// input keeps changing (and predictions keep failing) for the whole run.
const FIGHT = [
  [0, 30, RIGHT],
  [30, 40, Y],
  [40, 46, BUTTON_A],
  [46, 76, LEFT],
  [76, 86, X],
  [86, 92, B],
  [92, 110, RIGHT | Y],
];
function unarmed(script, frame) {
  if (frame < 1500) return pads(script, frame);
  const input = new Uint8Array(10);
  for (let pad = 0; pad < 4; pad++) {
    const phase = (frame + 41 * pad) % 150;
    for (const [from, to, buttons] of FIGHT)
      if (phase >= from && phase < to) {
        input[pad * 2] |= buttons & 0xff;
        input[pad * 2 + 1] |= buttons >> 8;
      }
  }
  return input;
}

function snes(n) {
  const script = n === 2 ? TWO_PLAYERS : FOUR_PLAYERS;
  return {
    wasm: readFileSync(here("../engines/snes/dist/snes.wasm")),
    content: new Uint8Array(readFileSync(here("../engines/snes/test/unarmed.sfc"))),
    input: (p, t) => unarmed(script, t).subarray(p.port * 2, p.port * 2 + 2),
    view: () => 0,
  };
}

// ---- measuring

const hrtime = process.hrtime.bigint; // the real one: vitest's fake timers fake hrtime too
const ns = () => hrtime();
const ms = (t0) => Number(ns() - t0) / 1e6;

// Times each engine's step, snapshot, restore, frame and hash, by the peer
// that owns it (engines nobody owns, such as the documents' replay, are not
// counted). The prototype is patched before any engine is traced, so the
// harness's tracing wraps the timed step. An owned engine's hash() is only
// ever the tracing's (the host hashes checkpoints with hashSnapshot), so that
// bucket is taken out of the host's frame time.
const owner = new WeakMap();
let patched = false;
function patch(engine) {
  if (patched) return;
  patched = true;
  const proto = Object.getPrototypeOf(engine);
  for (const [name, bucket] of [
    ["step", "sim"],
    ["snapshot", "snap"],
    ["restore", "snap"],
    ["frame", "render"],
    ["hash", "trace"],
  ]) {
    const f = proto[name];
    proto[name] = function (...args) {
      const cpu = owner.get(this);
      const t0 = ns();
      try {
        return f.apply(this, args);
      } finally {
        const took = ms(t0);
        if (cpu) cpu[bucket] += took;
        if (bucket === "trace") traced += took;
      }
    };
  }
}

// The hosts' budget clock: real time, less the time the tracing has spent
// hashing (which a host outside the tests never spends).
let traced = 0;
const o = { perf: () => Number(hrtime()) / 1e6 - traced };

const counters = () => ({ sim: 0, snap: 0, render: 0, trace: 0, frame: 0, times: [], rewinds: 0, depths: [] });

// One frame of one peer: the host's frame, then its own view drawn.
function frame(p, view, measuring) {
  const before = p.host.stats ? { ...p.host.stats } : null;
  const traced = p.cpu?.trace ?? 0;
  const t0 = ns();
  p.host.frame();
  const took = ms(t0) - ((p.cpu?.trace ?? 0) - traced);
  if (p.host.loading) return;
  p.host.engine.frame(view(p));
  if (!measuring) return;
  p.cpu.frame += took;
  p.cpu.times.push(took);
  const s = p.host.stats;
  if (before && s.rewinds > before.rewinds) {
    p.cpu.rewinds += s.rewinds - before.rewinds;
    p.cpu.depths.push(s.restepped - before.restepped);
  }
}

async function run(peers, ms, view, measuring) {
  for (let t = 0; t < ms; t += FRAME) {
    for (const p of peers) if (p.host) frame(p, view, measuring);
    await vi.advanceTimersByTimeAsync(FRAME);
  }
}

const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

// ---- one configuration

async function play(name, setup, n, latency, delay) {
  const { view, ...engine } = setup;
  const r = await rig(engine);
  patch(r.machine.boot(engine.content));
  const net = new SimNet({ latency: [latency], loss: [false] });
  const { peers, url } = await r.session(net, n, delay === undefined ? o : { ...o, delay });
  const hz = peers[0].host.engine.hz;
  for (const p of peers) owner.set(p.host.engine, (p.cpu = counters()));
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });

  // Until every seat has begun, then measure the play.
  await run(peers, 1000, view, false);
  const from = peers[0].host.tick;
  for (const p of peers) Object.assign(p.cpu, counters());
  const sent0 = { ...net.sent };
  await run(peers, JOIN * 1000 - 1000, view, true);

  // The spectator opens the session while the others play on, then catches
  // up within the host's per-frame budget, drawing as it goes.
  const e = r.peer(net, "e", -23);
  const joinAt = Date.now();
  let opened = null;
  r.open(e, url, o).then(() => (opened = Date.now()));
  while (opened === null) await run(peers, FRAME, view, true);
  owner.set(e.host.engine, (e.cpu = counters()));
  const behind = e.host.target() - e.host.tick;
  peers.push(e);
  let frames = 0;
  while (e.host.tick < e.host.target() - 1) {
    await run(peers, FRAME, view, true);
    frames++;
  }
  const join = {
    from: e.host.status.start,
    open_ms: opened - joinAt, // virtual: the network, plus the CPU awaits below at frame-loop speed
    behind_ticks: behind,
    catch_up_frames: frames,
    catch_up_cpu_ms: round(e.cpu.frame),
    catch_up_max_frame_ms: round(Math.max(...e.cpu.times)),
  };
  Object.assign(e.cpu, counters());
  const watching = Date.now();
  await run(peers, (PLAY - JOIN) * 1000 - (Date.now() - joinAt), view, true);
  const to = peers[0].host.tick;
  const seconds = (to - from) / hz;
  const sent = { sync: net.sent.sync - sent0.sync, ephemeral: net.sent.ephemeral - sent0.ephemeral };
  // The figures stop here: settling (paused) steps a little more.
  for (const p of peers) p.cpu = structuredClone(p.cpu);

  // Every peer at the same tick, with the documents' state at every tick it
  // confirmed.
  const tick = await r.settle(peers);

  // Durable bytes: what each document saves to.
  const repo = peers[0].repo;
  const doc = (await repo.find(url)).doc();
  const save = async (u) => A.save((await repo.find(u)).doc()).length;
  const sessionBytes = A.save(doc).length;
  let inputBytes = 0;
  for (const s of Object.values(doc.seats)) inputBytes += await save(s.inputs);
  const checkpoints = Object.entries(doc.checkpoints);
  const cpBytes = checkpoints.length ? await save(checkpoints[0][1].url) : 0;

  // What opening costs a late joiner in CPU, besides the network (the steps
  // Host.open takes): identify the engine and content, compile, then the
  // checkpoint's gunzip and hash check, a boot, and the restore. In virtual
  // time these awaits run at the speed of the frame loop around them, so
  // join.open_ms (virtual) overstates the network's share; these are real.
  let load = null;
  if (checkpoints.length) {
    const t5 = ns();
    await identify(engine.wasm, engine.content);
    const identifyMs = ms(t5);
    const t6 = ns();
    await compile(engine.wasm);
    const compileMs = ms(t6);
    const cp = (await repo.find(checkpoints[0][1].url)).doc();
    const t1 = ns();
    const snap = await gunzip(cp.state);
    const gunzipMs = ms(t1);
    const t2 = ns();
    const ok = hashSnapshot(snap) === cp.hash;
    const hashMs = ms(t2);
    const t3 = ns();
    const fresh = r.machine.boot(engine.content);
    const bootMs = ms(t3);
    const t4 = ns();
    fresh.restore(snap);
    load = {
      identify_ms: round(identifyMs),
      compile_ms: round(compileMs),
      state_bytes: snap.length,
      gzipped_bytes: cp.state.length,
      gunzip_ms: round(gunzipMs),
      hash_ms: round(hashMs),
      boot_ms: round(bootMs),
      restore_ms: round(ms(t4)),
      ok,
    };
  }

  // Per peer, then the mean over the players (the spectator only played the
  // last part, so it is reported apart).
  const players = peers.slice(0, n);
  const per = (p, k, s = seconds) => p.cpu[k] / s;
  const cpu = (ps, s) => ({
    sim: round(mean(ps.map((p) => per(p, "sim", s)))),
    render: round(mean(ps.map((p) => per(p, "render", s)))),
    snapshot: round(mean(ps.map((p) => per(p, "snap", s)))),
    host_frame: round(mean(ps.map((p) => per(p, "frame", s)))),
    host_other: round(mean(ps.map((p) => (p.cpu.frame - p.cpu.sim - p.cpu.snap) / s))),
  });
  const depths = players.flatMap((p) => p.cpu.depths);
  const out = {
    name,
    players: n,
    latency_ms: latency,
    delay_ticks: peers[0].host.delay,
    seconds: round(seconds, 1),
    ticks: to - from,
    settled_at: tick,
    agree: true,
    rollbacks_per_s: round(mean(players.map((p) => p.cpu.rewinds / seconds))),
    depth: { mean: round(mean(depths)), p50: quantile(depths, 0.5), p95: quantile(depths, 0.95), max: Math.max(0, ...depths) },
    restepped_per_s: round(mean(players.map((p) => p.cpu.depths.reduce((a, b) => a + b, 0) / seconds))),
    cpu_ms_per_s: cpu(players, seconds),
    host_frame_ms: (() => {
      const times = players.flatMap((p) => p.cpu.times);
      return { p50: round(quantile(times, 0.5), 3), p99: round(quantile(times, 0.99)), max: round(Math.max(...times)) };
    })(),
    spectator_cpu_ms_per_s: cpu([e], (Date.now() - watching) / 1000),
    durable: {
      session_bytes: sessionBytes,
      input_bytes: inputBytes,
      // over the time seats were held (setting up takes virtual time too)
      input_bytes_per_min: Math.round(inputBytes / ((tick - Math.min(...Object.values(doc.seats).map((x) => x.from))) / hz / 60)),
      seat_docs: Object.keys(doc.seats).length,
      checkpoint_doc_bytes: cpBytes,
      checkpoints_written: peers.reduce((k, p) => k + p.host.status.written.checkpoints, 0),
    },
    messages_per_s: { sync: round(sent.sync / seconds, 1), ephemeral: round(sent.ephemeral / seconds, 1) },
    join: { ...join, load },
    asked: players.reduce((k, p) => k + p.host.status.asked, 0),
  };
  results.push(out);
  for (const p of peers) p.host.close();
  return out;
}

const CONFIGS = [];
for (const [engine, make] of [
  ["doom", doom],
  ["snes", snes],
])
{
  for (const n of [2, 4]) for (const latency of [0, 50, 150]) CONFIGS.push({ name: `${engine}-${n}-${latency}`, engine, make, n, latency });
  // With no input delay, every input from elsewhere arrives late: what
  // rollback alone costs.
  for (const latency of [50, 150]) CONFIGS.push({ name: `${engine}-4-${latency}-d0`, engine, make, n: 4, latency, delay: 0 });
}

describe("the host with the real engines", () => {
  for (const c of CONFIGS) {
    const skip = (only && !c.name.startsWith(only)) || (c.engine === "doom" && !existsSync(iwad));
    (skip ? test.skip : test)(`${c.name}: ${c.n} players and a late spectator at ${c.latency} ms agree tick for tick`, async () => {
      const out = await play(c.name, c.make(c.n), c.n, c.latency, c.delay);
      console.log(JSON.stringify(out));
      expect(out.join.from).toBeGreaterThan(0);
      expect(out.join.load?.ok).toBe(true);
    }, 1_800_000);
  }

  afterAll(() => {
    if (!results.length) return;
    if (process.env.MACHINE_BENCH_OUT) writeFileSync(process.env.MACHINE_BENCH_OUT, JSON.stringify(results, null, 2));
    const rows = results.map((o) =>
      [
        o.name,
        o.delay_ticks,
        o.rollbacks_per_s,
        `${o.depth.mean} / ${o.depth.p95} / ${o.depth.max}`,
        o.cpu_ms_per_s.sim,
        o.cpu_ms_per_s.render,
        o.cpu_ms_per_s.snapshot,
        o.cpu_ms_per_s.host_other,
        Math.round(o.durable.input_bytes_per_min / 1024),
        Math.round(o.durable.checkpoint_doc_bytes / 1024),
        o.join.open_ms,
        `${o.join.behind_ticks} / ${o.join.catch_up_frames} / ${o.join.catch_up_max_frame_ms}`,
      ].join(" | "),
    );
    console.log(
      [
        "| run | delay | rollbacks/s | depth mean/p95/max | sim ms/s | render ms/s | snapshot ms/s | other host ms/s | inputs KB/min | checkpoint KB | join open ms | joiner behind ticks / frames to catch up / max frame ms |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|",
        ...rows.map((r) => `| ${r} |`),
      ].join("\n"),
    );
  });
});
