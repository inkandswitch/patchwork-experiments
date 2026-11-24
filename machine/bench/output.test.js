// What a listener hears under rollback (src/host/output.js), measured on the
// real engines through the host, against what the documents say was played.
// SimNet's WAN table (60–250 ms one-way) with 1 in 10 ephemeral messages
// lost, in virtual time.
//
// Each engine plays once. Every step each peer's timeline takes is recorded
// with the output it left, and every frame's clock, head and frontier; the
// output policy is a pure function of that record, so the same run is then
// heard at every lag (0, 1 and 3 ticks, and confirmed-only), and nothing
// but the policy differs between them.
//
// - Super NES, Unarmed, 2 players: the scripts through the menus to the
//   round, then 20 s of each pad fighting on a pattern of its own
//   (bench/integration's), so predictions keep failing; 45 s in all.
// - Doom, the 4-player bot demo, 30 s.
// - The toy, 3 players, 20 s: its samples are its LCG's state and its events
//   its scores, so every input changes both at the tick it is stepped: the
//   worst case for a listener, unlike a game, whose sound follows its state
//   by frames.
//
// Per tick heard (from the measured start): whether its samples are the
// documents' (wrong if not), crossfades, clicks (a boundary between two
// heard ticks whose jump exceeds the documents' jump there by more than 0.02
// of full scale), and the clicks the same stream would have without its
// crossfades; whether its events were right when heard, corrected later, or
// left wrong; and latency, how far behind the newest step it was heard.
//
//   pnpm bench:output        (Doom needs engines/doom/test/freedoom1.wad)
import { existsSync, readFileSync } from "node:fs";
import { initSubduction } from "@automerge/automerge-repo";
import { SimNet } from "../src/host/simnet.js";
import { rig, FRAME, WAN, LOSSY } from "../src/host/harness.js";
import { Outputs } from "../src/host/output.js";
import { SECONDS } from "../src/host/host.js";
import { content as doomContent, demo } from "../src/doom.js";
import { TWO_PLAYERS, pads, B, Y, A, X, LEFT, RIGHT } from "../engines/snes/test/unarmed.js";

await initSubduction();
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const here = (p) => new URL(p, import.meta.url);
const iwad = process.env.FREEDOOM1 ?? here("../engines/doom/test/freedoom1.wad").pathname;
const LAGS = [0, 1, 3, Infinity];
const CLICK = 0.02; // of full scale (-34 dB), past what the documents jump there
const rows = [];

const FIGHT = [[0, 30, RIGHT], [30, 40, Y], [40, 46, A], [46, 76, LEFT], [76, 86, X], [86, 92, B], [92, 110, RIGHT | Y]];
function unarmed(port, frame) {
  if (frame < 1500) return pads(TWO_PLAYERS, frame).subarray(port * 2, port * 2 + 2);
  const phase = (frame + 41 * port) % 150;
  let b = 0;
  for (const [from, to, buttons] of FIGHT) if (phase >= from && phase < to) b |= buttons;
  return new Uint8Array([b & 0xff, b >> 8]);
}

// Plays a session for `seconds` past tick `from`, recording each peer's
// steps and frames; returns the records and the documents' outputs.
async function record(r, n, { hz, from, seconds }) {
  const net = new SimNet({ latency: WAN, loss: LOSSY });
  // No budget: how far a frame steps then depends on nothing but the clock.
  const { peers } = await r.session(net, n, { seconds: { chunk: 1, every: 600, roll: 600 }, budget: Infinity });
  const logs = peers.map((p) => {
    const log = { start: p.host.status.start, events: [] };
    const e = p.host.engine;
    const step = e.step;
    e.step = (row) => {
      const t = p.host.tick;
      step(row);
      log.events.push(["step", t, e.output()]);
    };
    return log;
  });
  peers.forEach((p, i) => {
    p.port = i;
    p.host.sit(i);
  });
  const frames = Math.ceil((from / hz + seconds) * 1000 / FRAME);
  for (let k = 0; k < frames; k++) {
    peers.forEach((p, i) => {
      logs[i].events.push(["clock", p.host.target()]);
      p.host.frame();
      logs[i].events.push(["frame", p.host.tick, p.host.frontier]);
    });
    await vi.advanceTimersByTimeAsync(FRAME);
  }
  const stats = peers.map((p) => p.host.stats);
  await r.settle(peers);
  const end = Math.min(...peers.map((p) => p.host.tick));
  const truth = new Map();
  await r.replay(peers[0], end, (t, e) => {
    const o = e.output();
    truth.set(t, { samples: o.audio?.samples, events: o.events });
  });
  return { logs, truth, end, stats };
}

// One peer's record, heard through the policy at a lag.
function hear(log, { lag, hz }) {
  const ticks = (s) => Math.round(s * hz);
  const o = new Outputs({ lag, late: ticks(SECONDS.late), stale: ticks(SECONDS.stale) });
  o.start(log.start);
  const heard = new Map(), latency = new Map();
  let head = log.start, gap = false;
  const latest = new Map(); // what the timeline last stepped, so what plays unfaded
  for (const [kind, a, b] of log.events) {
    if (kind === "clock") o.skip(a);
    else if (kind === "step") {
      o.stepped(a, b);
      latest.set(a, b);
    }
    else {
      head = a;
      o.deliver(a, b);
      for (const it of o.take()) {
        if (it.gap) gap = true;
        else if (it.was) heard.get(it.tick).final = it.events;
        else {
          // The first tick after a gap fades in from silence, on purpose.
          const raw = latest.get(it.tick).audio?.samples;
          heard.set(it.tick, { samples: it.audio?.samples, raw, events: it.events, final: it.events, faded: gap && !!it.audio?.samples.length });
          gap = false;
          latency.set(it.tick, head - 1 - it.tick);
        }
      }
    }
  }
  return { heard, latency, stats: o.stats };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const r2 = (x) => Math.round(x * 100) / 100;
const equal = (a, b) => (a?.length ?? 0) === (b?.length ?? 0) && (!a || a.every((x, i) => x === b[i]));

// Measures every lag over ticks [from, end) of every peer's record.
function measure(engine, { logs, truth, end }, { hz, from, events = (e) => e?.join(",") ?? "", signal = true }) {
  for (const lag of LAGS) {
    let n = 0, wrong = 0, clicks = 0, worst = 0, rawClicks = 0, rawWorst = 0, exact = 0, corrected = 0, left = 0, spliced = 0;
    const lat = [];
    for (const log of logs) {
      const { heard, latency, stats } = hear(log, { lag, hz });
      spliced += stats.spliced;
      for (let t = from; t < end; t++) {
        const got = heard.get(t), want = truth.get(t);
        if (!got) continue;
        n++;
        lat.push(latency.get(t));
        if (!got.faded && !equal(got.samples, want.samples)) wrong++;
        const was = heard.get(t - 1);
        const c = 2;
        if (was?.samples?.length && got.samples?.length && !got.faded) {
          const prev = truth.get(t - 1).samples;
          const jump = (a, b) => Math.max(...[0, 1].map((k) => Math.abs(b[k] - a[a.length - c + k])));
          const excess = jump(was.samples, got.samples) - jump(prev, want.samples);
          worst = Math.max(worst, excess);
          if (excess > CLICK) clicks++;
          // The same stream without crossfades: each tick as the timeline had it.
          const rawExcess = jump(was.raw, got.raw) - jump(prev, want.samples);
          rawWorst = Math.max(rawWorst, rawExcess);
          if (rawExcess > CLICK) rawClicks++;
        }
        const w = events(want.events);
        if (events(got.events) === w) exact++;
        else if (events(got.final) === w) corrected++;
        else left++;
      }
    }
    const row = {
      engine, lag, ticks: n, latencyMs: r2((mean(lat) * 1000) / hz),
      samplesWrongPct: r2((100 * wrong) / n), spliced, clicks: signal ? clicks : "—", worstExcessJump: signal ? r2(worst) : "—",
      unfadedClicks: signal ? rawClicks : "—", unfadedWorst: signal ? r2(rawWorst) : "—",
      eventsRightPct: r2((100 * exact) / n), eventsCorrected: corrected, eventsLeftWrong: left,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}

test("Super NES, Unarmed, 2 players fighting over WAN", async () => {
  const snes = await rig({
    wasm: readFileSync(here("../engines/snes/dist/snes.wasm")),
    content: new Uint8Array(readFileSync(here("../engines/snes/test/unarmed.sfc"))),
    input: (p, t) => unarmed(p.port ?? 0, t),
  });
  const hz = 21477270 / 357366;
  measure("snes", await record(snes, 2, { hz, from: 1500, seconds: 20 }), { hz, from: 0 });
}, 1_800_000);

const doomTest = existsSync(iwad) ? test : test.skip;
doomTest("Doom, 4-player bot demo over WAN", async () => {
  const bot = demo(readFileSync(here("../engines/doom/test/bot4p.lmp")));
  const doom = await rig({
    wasm: readFileSync(here("../engines/doom/dist/doom.wasm")),
    content: doomContent({ wads: [readFileSync(iwad)], args: bot.args }),
    input: (p, t) => bot.tics[t % bot.tics.length].subarray(p.port * 6, p.port * 6 + 6),
  });
  // A step's sound records: every 28-byte record after the first (music).
  const sounds = (bytes) => bytes.subarray(28).join(",");
  measure("doom", await record(doom, 4, { hz: 35, from: 0, seconds: 30 }), { hz: 35, from: 0, events: sounds });
}, 1_800_000);

test("the toy, 3 players over WAN: every input reaches its samples and events at once", async () => {
  const ALLOC = 1, FREE = 2;
  const toy = await rig({
    wasm: readFileSync(here("../engines/toy/dist/toy.wasm")),
    content: new TextEncoder().encode("host"),
    input: (p, t) => {
      const k = p.port ?? 0;
      return new Uint8Array([(((t >> 3) + k) % 5) - 2, t % 11 === k ? ALLOC : t % 13 === k ? FREE : 0]);
    },
  });
  // Its samples are not a signal (each tick's are bits of the LCG), so jumps
  // between them mean nothing.
  measure("toy", await record(toy, 3, { hz: 35, from: 0, seconds: 20 }), { hz: 35, from: 0, signal: false });
}, 1_800_000);

afterAll(() => console.table(rows));
