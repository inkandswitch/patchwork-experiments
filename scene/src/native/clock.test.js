// World time (clock.js; STAGE.md, "World time", H7): the pure parts, then the clock of
// several views on real Automerge replicas of one doc, every order of a
// finite set of events.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { CHECKPOINT_MS, CLOCK, LAG_MS, MAX_FRAME_S, RESYNC_S, STEP_S, createClock, eligibility, follow, gridIndex, readClock, slew } from "./clock.js";

// ─── pure ───────────────────────────────────────────────────────────────────

describe("the doc's clock", () => {
  it("reads absent as running from 0, and only `running: false` as paused", () => {
    expect(readClock({})).toEqual({ running: true, t: 0, by: null });
    expect(readClock({ clock: { running: false, t: 12.5, by: "ana" } })).toEqual({ running: false, t: 12.5, by: "ana" });
    expect(readClock({ clock: { running: "no", t: -3 } })).toEqual({ running: true, t: 0, by: null });
    expect(readClock({ clock: { t: Infinity } }).t).toBe(0);
  });

  it("says why a view can't compute, first reason first", () => {
    const yes = { acts: true, writable: true, visible: true, settled: true, complete: true };
    expect(eligibility(yes)).toEqual({ ok: true, why: null });
    expect(eligibility({ ...yes, acts: false, writable: false }).why).toBe("drawn");
    expect(eligibility({ ...yes, writable: false }).why).toBe("view only");
    expect(eligibility({ ...yes, complete: false }).why).toBe("missing a package");
    expect(eligibility({ ...yes, settled: false }).why).toBe("starting");
    expect(eligibility({ ...yes, visible: false }).why).toBe("hidden");
  });
});

describe("following", () => {
  it("slews: never back, never more than twice as fast", () => {
    expect(slew(10, 0, 0.1)).toBe(10);
    expect(slew(10, 100, 0.1)).toBeCloseTo(10.2);
    expect(slew(10, 10.1, 0.1)).toBeCloseTo(10.1);
  });

  it("jumps only forward, holds when ahead, and never passes the newest t heard", () => {
    expect(follow(10, 70, 1 / 60)).toBe(70);
    expect(follow(10, 9, 1 / 60)).toBe(10); // ahead of it: it waits (monotone), where the sea's old clock jumped back
    expect(follow(10, 70, 1 / 60, 20)).toBe(20); // never past what the computer has said
    expect(follow(25, 70, 1 / 60, 20)).toBe(25); // already past it (a cap that fell): stays
    // over every target and cap on a grid, it is monotone and capped
    for (let shown = 0; shown <= 4; shown += 0.5)
      for (let target = 0; target <= 4; target += 0.25)
        for (const cap of [null, 0, 1, 2, 3, 5]) {
          const next = follow(shown, target, 1 / 30, cap);
          expect(next).toBeGreaterThanOrEqual(shown);
          if (cap != null && shown <= cap) expect(next).toBeLessThanOrEqual(cap);
          if (cap == null && target - shown > RESYNC_S + 1 / 30) expect(next).toBe(target);
        }
  });

});

// ─── views on replicas ──────────────────────────────────────────────────────

/**
 * Up to three views of one doc, each with its own Automerge replica, its own
 * clock and (unless it's missing the package) one kept process, merged at
 * every frame. Presence is shared at once: who's here (a crash drops a view
 * from it, as the TTL would), and each computer's published t.
 */
function world(caps) {
  let wall = 1_000_000;
  // every replica's wasm handle, freed with free(): a run makes hundreds of thousands of worlds, and Automerge's memory isn't the GC's
  const handles = new Set();
  const own = (doc) => (handles.add(Automerge.getBackend(doc)), doc);
  // (the clock's map made with the doc, as the scene datatype's init makes it)
  const base = own(Automerge.from({ clock: { running: true, t: 0 }, objects: { o: { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } } } }));
  const views = caps.map((cap, i) => ({ i, cap, session: `s${i}`, viewer: `v${i}`, state: "gone", doc: null, clock: null, steps: [], ts: [], startedCold: null }));
  const samples = new Map(); // session → { t, at }
  const here = () => views.filter((v) => v.state !== "gone");
  const errors = [];

  function claimOf(v) {
    const c = v.doc.claims?.[CLOCK];
    return c && typeof c.session === "string" ? c : null;
  }

  function mount(v) {
    // a joining view starts from everything the others have
    v.doc = own(Automerge.clone(base));
    const from = here().filter((o) => o !== v && o.doc);
    // alone: what the last to leave (or crash) left behind, as the sync server would have it
    const sources = from.length ? from.map((o) => o.doc) : views.filter((o) => o !== v && o.lastDoc).map((o) => o.lastDoc);
    [v.doc] = Automerge.applyChanges(v.doc, sources.flatMap((d) => Automerge.getAllChanges(d)));
    v.state = "visible";
    v.session = `s${v.i}.${(v.mounts = (v.mounts ?? 0) + 1)}`; // a new mount is a new presence session
    v.steps = [];
    v.ts = [];
    let held = null; // { onLost }
    v.claimHeld = () => held;
    v.lose = () => {
      const h = held;
      held = null;
      h?.onLost();
    };
    v.clock = createClock({
      doc: () => v.doc,
      change: (fn) => {
        if (v.cap === "read-only") throw new Error("read-only");
        v.doc = Automerge.change(v.doc, fn);
        // the stage's doc loop runs in the change event, synchronously: the clock looks again, re-entrantly
        v.clock?.check();
      },
      claim: {
        take(onLost) {
          const c = claimOf(v);
          if (c && c.session !== v.session && views.some((o) => o.session === c.session && o.state !== "gone")) return null;
          v.doc = Automerge.change(v.doc, (d) => {
            if (!d.claims) d.claims = {};
            d.claims[CLOCK] = { viewer: v.viewer, session: v.session };
          });
          held = { onLost };
          return () => {
            held = null;
            if (claimOf(v)?.session === v.session)
              v.doc = Automerge.change(v.doc, (d) => {
                delete d.claims[CLOCK];
              });
          };
        },
        holder() {
          const c = claimOf(v);
          if (!c) return null;
          if (c.session === v.session) return { viewer: c.viewer, session: c.session, mine: true };
          return views.some((o) => o.session === c.session && o.state !== "gone") ? { viewer: c.viewer, session: c.session, mine: false } : null;
        },
      },
      presence: {
        set: (s) => (s ? samples.set(v.session, s) : samples.delete(v.session)),
        sample: (s) => (views.some((o) => o.session === s && o.state !== "gone") ? (samples.get(s) ?? null) : null),
        shownAt: () => null,
        rate() {},
      },
      eligible: () => eligibility({ acts: true, writable: v.cap !== "read-only", visible: v.state === "visible", settled: true, complete: v.cap !== "missing" }),
      writable: () => v.cap !== "read-only",
      viewer: v.viewer,
      now: () => wall,
    });
    v.joinedAt = readClock(v.doc).t;
    if (v.cap !== "missing")
      v.clock.process({
        start: (t) => v.steps.push({ start: t }),
        step: (dt, t) => {
          // H7: a kept process is stepped only where the doc runs, by its computer
          if (!readClock(v.doc).running) errors.push(`${v.i} stepped while paused`);
          if (!v.clock.computing()) errors.push(`${v.i} stepped without computing`);
          v.steps.push({ t });
        },
        save: (d) => {
          d.objects.o.saved_n = (d.objects.o.saved_n ?? 0) + 1;
        },
        stop: () => v.steps.push({ stop: true }),
      });
  }

  /** Merge every present replica with every other, and tell each view whose claim lost. */
  function sync() {
    const live = here();
    if (live.length < 2) return;
    const heads = live.map((v) => Automerge.getHeads(v.doc).sort().join());
    if (heads.every((h) => h === heads[0])) return; // nothing new anywhere
    const changes = live.flatMap((v) => Automerge.getAllChanges(v.doc));
    for (const v of live) {
      [v.doc] = Automerge.applyChanges(v.doc, changes);
      // the stage's recheck: our claim's field names another session now
      const c = claimOf(v);
      if (v.claimHeld() && c && c.session !== v.session) v.lose();
    }
  }

  function frame(ms = 100) {
    wall += ms;
    for (const v of here()) {
      v.clock.tick(wall);
      const t = v.clock.t();
      if (v.ts.length && t < v.ts.at(-1)) errors.push(`${v.i}'s t went back: ${v.ts.at(-1)} → ${t}`);
      v.ts.push(t);
    }
    sync();
    for (const v of here()) v.clock.check();
  }

  const events = {
    join(v) {
      mount(v);
      if (v.joinedAt !== readClock(v.doc).t) errors.push("a joiner didn't start at clock.t");
    },
    leave(v) {
      // the stage going: the clock lets go with a checkpoint, then presence says bye
      v.clock.dispose();
      sync();
      v.lastDoc = v.doc;
      v.state = "gone";
      samples.delete(v.session);
    },
    crash(v) {
      // gone without a word: no checkpoint; presence drops it (its TTL)
      v.lastDoc = v.doc;
      v.state = "gone";
      samples.delete(v.session);
      v.crashed = true;
    },
    hide(v) {
      v.state = "hidden";
      v.clock.check();
    },
    pause: (v) => v.clock.pause(),
    resume: (v) => v.clock.resume(),
    save() {
      // half a minute of frames, compressed: the checkpoint falls due
      wall += CHECKPOINT_MS;
    },
  };

  /** A frame for some views only, unmerged (the others' frames have stopped). */
  function frameOnly(list, ms = 100) {
    wall += ms;
    for (const v of list) v.clock.tick(wall);
  }

  /** Let go of every replica (the world is done with). */
  function free() {
    for (const h of handles) h.free();
    handles.clear();
  }

  return { views, events, frame, frameOnly, sync, here, errors, samples, free };
}

const able = (v) => v.state === "visible" && v.cap === "writable";

/** The events that do something from a state (a view gone can't hide; the clock paused can't be paused again by anyone). */
function options(w) {
  const out = [];
  for (const v of w.views) {
    if (v.state === "gone") {
      if (!v.crashed) out.push(["join", v]); // (a crashed view's browser is gone; a new one joins as another)
      continue;
    }
    out.push(["leave", v], ["crash", v]);
    if (v.state === "visible") out.push(["hide", v]);
    if (v.cap !== "read-only") out.push([readClock(v.doc).running ? "pause" : "resume", v]);
  }
  out.push(["save", null]);
  return out;
}

/** Run one sequence of event indices (into options() as they stand at each step); null when an index runs out. */
export function run(caps, picks) {
  const w = world(caps);
  w.events.join(w.views[0]);
  w.frame();
  w.events.join(w.views[1]);
  w.frame();
  let crashed = false;
  for (const p of picks) {
    const opts = options(w);
    if (p >= opts.length) {
      w.free();
      return null;
    }
    const [kind, v] = opts[p];
    if (kind === "crash") crashed = true;
    w.events[kind](v);
    for (let i = 0; i < FRAMES; i++) w.frame();
    checkSettled(w, crashed);
  }
  return w;
}

function checkSettled(w, crashed) {
  const live = w.here();
  const computing = live.filter((v) => v.clock.computing());
  // ≤1 computer once claims have arrived (three frames, each merged), and only an eligible one
  if (computing.length > 1) w.errors.push(`${computing.length} computers`);
  for (const v of computing) if (!able(v)) w.errors.push(`${v.i} computes though ${v.state}, ${v.cap}`);
  const running = live.length ? readClock(live[0].doc).running : true;
  // someone able is here and the world runs: exactly one computes
  if (running && live.some(able) && computing.length !== 1) w.errors.push(`running with ${computing.length} computers though someone can`);
  // paused, nobody computes, and (no crash taking a t with it) every view has the same t
  if (!running) {
    if (computing.length) w.errors.push("a computer while paused");
    if (!crashed && live.length) {
      const ts = live.map((v) => v.clock.t());
      if (ts.some((t) => t !== ts[0])) w.errors.push(`paused at different t: ${ts.join(", ")}`);
      if (ts[0] !== readClock(live[0].doc).t) w.errors.push("paused off clock.t");
    }
  }
}

/**
 * Every sequence of up to n events from the start state, depth first: each
 * node replays its prefix and checks it, then tries each event on offer
 * there. Resolves to how many sequences ran. (It gives the event loop a turn
 * every so often: a deep run is minutes of work, and vitest's worker must
 * still answer its runner meanwhile.)
 */
async function explore(caps, n, prefix = [], tally = { since: 0 }) {
  const w = run(caps, prefix);
  const errors = [...w.errors];
  const k = prefix.length < n ? options(w).length : 0;
  w.free();
  if (errors.length) throw new Error(`${caps.join("/")} after ${describe_(caps, prefix)}: ${errors.join("; ")}`);
  if (++tally.since >= 2000) {
    tally.since = 0;
    await new Promise((r) => setImmediate(r));
  }
  let count = 1;
  for (let i = 0; i < k; i++) count += await explore(caps, n, [...prefix, i], tally);
  return count;
}

/** A sequence of picks in words, for a failure. */
function describe_(caps, picks) {
  const w = world(caps);
  w.events.join(w.views[0]);
  w.frame();
  w.events.join(w.views[1]);
  w.frame();
  const out = [];
  for (const p of picks) {
    const [kind, v] = options(w)[p];
    out.push(v ? `${kind} ${v.i}` : kind);
    w.events[kind](v);
    for (let i = 0; i < FRAMES; i++) w.frame();
  }
  w.free();
  return out.join(", ") || "(start)";
}

const CAPS = ["writable", "read-only", "missing"];
const DEPTH = Number(process.env.H7_DEPTH ?? 3);
/** How many sequences each depth is, all 27 configs (measured): the default run and the deeper ones. */
const PINNED = { 3: 17673, 4: 131568, 5: 961400 };
// frames after each event, each merged: enough for every claim to have arrived and every loser to have heard
const FRAMES = 2;

describe("H7: the clock across views, on Automerge", () => {
  it("one writable view: computes, checkpoints, pauses and resumes, starting each process at its t", () => {
    const w = world(["writable"]);
    w.events.join(w.views[0]);
    for (let i = 0; i < 10; i++) w.frame(100);
    const v = w.views[0];
    expect(v.clock.computing()).toBe(true);
    expect(v.clock.t()).toBeCloseTo(0.9, 5); // the first frame only starts it
    expect(v.steps[0]).toEqual({ start: 0 });
    expect(v.steps.filter((s) => s.t != null).length).toBe(gridIndex(0.9));
    v.clock.pause();
    expect(v.clock.computing()).toBe(false);
    expect(readClock(v.doc)).toEqual({ running: false, t: v.clock.t(), by: "v0" });
    expect(v.doc.objects.o.saved_n).toBe(1); // the pause's checkpoint
    const t = v.clock.t();
    for (let i = 0; i < 10; i++) w.frame(100);
    expect(v.clock.t()).toBe(t); // no time passes paused
    v.clock.resume();
    w.frame(100);
    expect(v.clock.computing()).toBe(true);
    expect(v.steps.filter((s) => s.start != null).at(-1)).toEqual({ start: t });
    expect(w.errors).toEqual([]);
  });

  it("at most MAX_FRAME_S a frame: a stall is skipped, not run", () => {
    const w = world(["writable"]);
    w.events.join(w.views[0]);
    w.frame(100);
    w.frame(5000);
    expect(w.views[0].clock.t()).toBeCloseTo(MAX_FRAME_S, 6);
  });

  it("a follower runs behind what it has heard and never past it, and says when the computer stalls", () => {
    const w = world(["writable", "writable"]);
    w.events.join(w.views[0]);
    w.frame();
    w.events.join(w.views[1]);
    for (let i = 0; i < 30; i++) w.frame(100);
    const [a, b] = w.views;
    expect(a.clock.computing()).toBe(true);
    expect(b.clock.t()).toBeLessThanOrEqual(w.samples.get("s0.1").t);
    expect(a.clock.t() - b.clock.t()).toBeLessThan(LAG_MS / 1000 + 0.15);
    expect(b.clock.status().stalled).toBe(false);
    // the computer's frames stop (but it's still here): the follower waits at what it heard, and says so
    const heard = w.samples.get("s0.1").t;
    for (let i = 0; i < 15; i++) w.frameOnly([b], 100);
    expect(b.clock.t()).toBeLessThanOrEqual(heard);
    expect(b.clock.status().stalled).toBe(true);
    expect(b.clock.status().computer).toMatchObject({ viewer: "v0", mine: false });
  });

  // (H7_CONFIG=i runs config i alone: a deep run is split across processes, each with a fresh Automerge)
  const configs = [];
  for (const a of CAPS) for (const b of CAPS) for (const c of CAPS) configs.push([a, b, c]);
  if (process.env.H7_CONFIG != null) configs.splice(0, configs.length, configs[Number(process.env.H7_CONFIG)]);
  it(`every sequence of up to ${DEPTH} events, three views of every capability (${configs.length} configs)`, async () => {
    let runs = 0;
    const t0 = Date.now();
    for (const caps of configs) runs += await explore(caps, DEPTH);
    console.log(`H7: ${runs} sequences in ${Date.now() - t0} ms`);
    // the whole space at each depth measured, so a change that quietly prunes it fails here
    if (configs.length === 27 && PINNED[DEPTH] != null) expect(runs).toBe(PINNED[DEPTH]);
    else expect(runs).toBeGreaterThan(0);
  }, DEPTH > 3 ? 7_200_000 : 600_000);
});

describe("H7: clock writes made at once, on Automerge", () => {
  // the computer's checkpoint, its pause and the follower's pause, each made before hearing the others:
  // every order of every non-empty set of them, then merged
  const EVENTS = {
    checkpoint: (w, [a]) => {
      w.events.save();
      w.frameOnly([a]);
    },
    "a pauses": (w, [a]) => a.clock.pause(),
    "b pauses": (w, [, b]) => b.clock.pause(),
  };
  const orders = [];
  const grow = (seq) => {
    if (seq.length) orders.push(seq);
    for (const e of Object.keys(EVENTS)) if (!seq.includes(e)) grow([...seq, e]);
  };
  grow([]);
  it(`every order of every set of them (${orders.length}): a pause is never lost, and paused, every view meets at the larger t`, () => {
    expect(orders.length).toBe(15);
    for (const order of orders) {
      const w = world(["writable", "writable"]);
      w.events.join(w.views[0]);
      w.frame();
      w.events.join(w.views[1]);
      for (let i = 0; i < 10; i++) w.frame();
      const [a, b] = w.views;
      expect(a.clock.computing()).toBe(true);
      for (const e of order) EVENTS[e](w, w.views);
      const paused = order.some((e) => e.endsWith("pauses"));
      const top = Math.max(a.clock.t(), b.clock.t());
      w.sync();
      for (let i = 0; i < 3; i++) w.frame();
      const c = readClock(a.doc);
      const what = order.join(", ");
      expect(c.running, what).toBe(!paused);
      expect(readClock(b.doc), what).toEqual(c);
      checkSettled(w, false);
      if (paused) expect(c.t, what).toBeGreaterThanOrEqual(top);
      expect(w.errors, what).toEqual([]);
      w.free();
    }
  });

  it("a checkpoint stamps `saved` on what its saves moved, and on nothing else", () => {
    const w = world(["writable"]);
    w.events.join(w.views[0]);
    const v = w.views[0];
    let x = 0;
    v.clock.process({ step() {}, save: (d) => x && (d.objects.o.transform.position[0] = x) });
    for (let i = 0; i < 5; i++) w.frame();
    w.events.save();
    w.frame();
    expect(v.doc.objects.o.saved).toBeUndefined(); // saved, but not moved
    x = 2;
    v.clock.pause();
    expect(v.doc.objects.o.transform.position[0]).toBe(2);
    expect(v.doc.objects.o.saved).toBe(readClock(v.doc).t);
    w.free();
  });
});

describe("H7: replicated processes", () => {
  it("every present view steps one, on the same grid; paused, each reaches clock.t and no further", () => {
    const w = world(["writable", "read-only"]);
    w.events.join(w.views[0]);
    w.frame();
    w.events.join(w.views[1]);
    const seen = [[], []];
    for (const v of w.views) v.clock.process({ replicated: true, step: (dt, t) => seen[v.i].push(t) });
    for (let i = 0; i < 20; i++) w.frame(100);
    // both stepped (the read-only one too: it doesn't compute, it follows), on grid points
    expect(seen[0].length).toBeGreaterThan(50);
    expect(seen[1].length).toBeGreaterThan(30);
    for (const s of seen) for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeCloseTo(STEP_S, 9);
    w.views[0].clock.pause();
    for (let i = 0; i < 3; i++) w.frame(100);
    const end = readClock(w.views[0].doc).t;
    expect(seen[0].at(-1)).toBeLessThanOrEqual(end);
    expect(seen[1].at(-1)).toBe(seen[0].at(-1)); // the same last step: the pause point both have
    expect(seen[1].at(-1)).toBeGreaterThan(end - STEP_S);
  });
});

describe("the computer's status", () => {
  it("says who paused, who computes, a stall, and why nobody here can", () => {
    const w = world(["read-only"]);
    w.events.join(w.views[0]);
    w.frame();
    expect(w.views[0].clock.status()).toMatchObject({ running: true, computer: null, able: false, why: "view only" });
  });
});

