// The slide joint: its reading of the trait, and every interleaving of a
// finite set of events among views on a simulated network, run on the real
// createSlides; then the same with the world paused at every step (STAGE.md
// H8: a pause changes no act and no liveness outcome).
import { describe, expect, it } from "vitest";
import { HEAR_MS, KEY, MAX_LATENCY_MS, POSE_MS, createSlides, positionAt, readSlide, selfClosing, travelTime } from "./slide.js";

describe("reading the trait", () => {
  it("fills defaults and makes the axis unit", () => {
    expect(readSlide({ axis: [0, 2, 0], stops: { closed: 0, open: 3 }, speed: 1.5 })).toEqual({ axis: [0, 1, 0], stops: { closed: 0, open: 3 }, speed: 1.5, wait: 0, at: "closed", since: null });
    expect(readSlide({ stops: { closed: 0, open: 1 }, at: "open", wait: 4, since: 5 })).toMatchObject({ axis: [0, 1, 0], speed: 1, wait: 4, at: "open", since: 5 });
  });
  it("says whether a doc has a part that closes itself (then it has a process)", () => {
    const door = (wait) => ({ objects: { d: { traits: { [KEY]: { stops: { closed: 0, open: 1 }, wait } } } } });
    expect(selfClosing(door(2))).toBe(true);
    expect(selfClosing(door(0))).toBe(false);
    expect(selfClosing({ objects: { g: { kind: "group", traits: { [KEY]: { stops: { closed: 0, open: 1 }, wait: 2 } } } } })).toBe(false);
    expect(selfClosing({})).toBe(false);
  });
  it("is nothing when it can't move", () => {
    expect(readSlide(null)).toBe(null);
    expect(readSlide({ axis: [0, 0, 0], stops: { closed: 0, open: 1 } })).toBe(null);
    expect(readSlide({ stops: { closed: 1, open: 1 } })).toBe(null);
    expect(readSlide({ stops: { closed: 0, open: 1 }, speed: 0 })).toBe(null);
  });
  it("finds each stop from where the part is, whichever stop that is", () => {
    const s = readSlide({ axis: [1, 0, 0], stops: { closed: 0.2, open: 0.7 }, at: "open" });
    expect(positionAt(s, [5, 1, 2], "closed")).toEqual([4.5, 1, 2]);
    expect(positionAt(s, [5, 1, 2], "open")).toEqual([5, 1, 2]);
    expect(travelTime(readSlide({ stops: { closed: 0, open: 3 }, speed: 2 }))).toBe(1.5);
  });
});

// ─── the simulated network ───────────────────────────────────────────────────
//
// Views each keep their own replica of the door's rest (position and trait),
// and hear one another's writes, holds, releases and comings and goings
// `latency` ms later. Writes merge last-writer-wins by (time, session), as
// two concurrent Automerge writes to the same fields settle on one. Holds are
// ranked as the stage ranks them (scene/src/stage/presence.js winningHold): a
// Lamport stamp one past every stamp the holder has heard, then the session.
//
// A view is drawing (its frames run every tick) or hidden (a background tab:
// no frames; it looks only when a timer it set is due, timers rounded up to
// the next whole second as a browser throttles them, or when it hears
// something), as the extension drives createSlides either way.
//
// The doc's world time is the stage's clock as scene/STAGE.md, "Native services" has it: one
// view computes it, the first drawing view here (the claim's first taker),
// handing over when it goes or hides; it moves on only while someone
// computes and nobody has paused it, and only the computer steps the
// process (`due`). Every view reads the same t (a follower's lag only moves
// what it draws).

const DOOR = { axis: [0, 1, 0], stops: { closed: 0, open: 3.444 }, speed: 1.944, wait: 4.286, at: "closed" };
const FAST = { ...DOOR, stops: { closed: 0, open: 1.667 }, speed: 7.778 }; // a blazing door: 0.21 s
const TICK = 16;

function simulate({ door, latency, events, hidden = [], until = 30_000, pauses = [] }) {
  let T = 0;
  let W = 0; // world time (s)
  let computer = null;
  const starts = []; // every motion started: { at, W, by, to }
  const queue = []; // { at, fn }
  const later = (ms, fn) => queue.push({ at: T + ms, fn, n: queue.length });
  const writes = [];
  const views = new Map();
  const base = () => ({ position: [10, 2, 3], trait: JSON.parse(JSON.stringify(door)), stamp: [0, ""] });

  function join(session, from) {
    const v = { session, alive: true, hidden: hidden.includes(session), wake: null, poked: true, replica: from ? JSON.parse(JSON.stringify(from)) : base(), heard: new Map(), lamport: 0, mine: null, present: new Set() };
    // what this view sees: the doc, its own hold, the holds it has heard
    const doc = () => ({ objects: { door: { transform: { position: v.replica.position, rotation: [0, 0, 0], scale: 1 }, traits: { [KEY]: v.replica.trait } } } });
    const send = (fn) => {
      for (const o of views.values()) if (o !== v) later(latency, () => o.alive && (fn(o), (o.poked = true)));
    };
    v.slides = createSlides({
      now: () => T,
      t: () => W,
      doc,
      change(fn) {
        const d = JSON.parse(JSON.stringify(doc()));
        fn(d);
        const next = { position: d.objects.door.transform.position, trait: d.objects.door.traits[KEY], stamp: [T, session] };
        writes.push({ at: T, W, by: session, to: next.trait.at, position: [...next.position], since: next.trait.since });
        v.replica = next;
        send((o) => {
          const [t0, s0] = o.replica.stamp;
          if (T > t0 || (T === t0 && session > s0)) o.replica = JSON.parse(JSON.stringify(next));
        });
      },
      // a hold goes out at once and then every 50 ms while held (the stage's pose stream), so a view that joins mid-motion hears it
      hold(id, t) {
        if (!v.mine) {
          v.mine = { since: ++v.lamport, sent: -Infinity };
          // a motion begins (a press's, or the world's close)
          starts.push({ at: T, W, by: session, to: v.replica.trait.at === "open" ? "closed" : "open" });
        }
        v.shown = t.position;
        if (T - v.mine.sent < POSE_MS) return true;
        v.mine.sent = T;
        const since = v.mine.since;
        send((o) => {
          o.lamport = Math.max(o.lamport, since);
          // a new hold replaces a landed one (presence.js: a landed hold is kept only until the doc catches up)
          const was = o.heard.get(session);
          if (!was || was.landed || was.since === since) o.heard.set(session, { since, landed: false });
        });
        return true;
      },
      release(id, { landed = false } = {}) {
        if (!v.mine) return;
        v.mine = null;
        send((o) => (landed ? o.heard.set(session, { ...o.heard.get(session), landed: true }) : o.heard.delete(session)));
      },
      heldBy() {
        const theirs = [...v.heard].filter(([, h]) => !h.landed).map(([s, h]) => ({ session: s, since: h.since }));
        const all = v.mine ? [...theirs, { session, since: v.mine.since }] : theirs;
        let best = null;
        for (const h of all) if (!best || h.since < best.since || (h.since === best.since && h.session < best.session)) best = h;
        return best && best.session !== session ? best.session : null;
      },
    });

    views.set(session, v);
    // hellos both ways
    for (const o of views.values()) {
      if (o === v) continue;
      later(latency, () => o.alive && v.alive && (o.present.add(session), (o.poked = true)));
      later(latency, () => v.alive && o.alive && (v.present.add(o.session), (v.poked = true)));
    }
    return v;
  }
  function leave(session) {
    const v = views.get(session);
    if (!v?.alive) return;
    v.alive = false;
    // the stage releases a gone view's holds (plain), and its bye reaches the others
    for (const o of views.values()) if (o !== v) later(latency, () => (o.heard.delete(session), o.present.delete(session), (o.poked = true)));
  }

  for (const e of events) queue.push({ at: e.at, fn: () => e.do({ join, leave, views, T }), n: -1 });
  join("A");
  const paused = () => pauses.some(([from, ms]) => T >= from && T < from + ms);
  while (T <= until) {
    queue.sort((a, b) => a.at - b.at || a.n - b.n);
    while (queue.length && queue[0].at <= T) queue.shift().fn();
    // the clock: the computer keeps it while it can, else the first drawing view takes it
    if (!computer?.alive || computer.hidden) computer = [...views.values()].find((v) => v.alive && !v.hidden) ?? null;
    if (computer && !paused()) {
      W += TICK / 1000;
      if (computer.slides.due(W)) computer.poked = true;
    }
    for (const v of views.values()) {
      if (!v.alive) continue;
      // a drawing view looks every frame; a hidden one when it hears something or its timer is due
      if (v.hidden && !v.poked && !(v.wake != null && T >= v.wake)) continue;
      v.poked = false;
      v.slides.frame();
      const next = v.slides.review();
      v.wake = next == null ? null : v.hidden ? Math.ceil(Math.max(next, T + 1) / 1000) * 1000 : next;
    }
    T += TICK;
  }
  // let the last messages land
  queue.sort((a, b) => a.at - b.at);
  for (const q of queue) q.fn();
  return { writes, views, starts, W };
}

const press = (session, at) => ({ at, do: ({ views }) => views.get(session)?.alive && views.get(session).slides.move("door") && (views.get(session).poked = true) });
const leaving = (session, at) => ({ at, do: ({ leave }) => leave(session) });
const joining = (session, at) => ({ at, do: ({ join, views }) => join(session, views.get("A")?.replica) });

describe("every interleaving of open, wait, close, the opener leaving, and two at once", () => {
  // A presses at P0; B presses at an offset from that, before (B first: the
  // view that loses the hold ranking pressing first) or after; up to the
  // most latency the joint promises to settle a contest within
  const P0 = 1000;
  const LATENCIES = [5, 40, 150, MAX_LATENCY_MS - 10];
  const B_PRESSES = [null, -440, -200, -60, -20, 0, 20, 60, 200, 1000, 2500, 5900, 6600];
  const A_LEAVES = [null, 500, 2000, 6300];
  const B_JOINS = [0, 3000 + P0];
  const HIDDEN = [[], ["A"], ["B"]];
  const cases = [];
  for (const door of [DOOR, FAST])
    for (const latency of LATENCIES)
      for (const bPress of B_PRESSES)
        for (const aLeaves of A_LEAVES)
          for (const bJoins of B_JOINS)
            for (const hidden of HIDDEN) {
              if (bPress != null && P0 + bPress < bJoins) continue;
              cases.push({ door, latency, bPress, aLeaves, bJoins, hidden });
            }

  it(`holds in all ${cases.length} cases: at most two writes a cycle, the views agree, it ends shut and let go`, () => {
    const failures = [];
    let maxWrites = 0;
    let loserFirst = 0;
    for (const c of cases) {
      const events = [press("A", P0), joining("B", c.bJoins)];
      c.presses = [P0];
      if (c.bPress != null) events.push(press("B", P0 + c.bPress)), c.presses.push(P0 + c.bPress);
      if (c.aLeaves != null) events.push(leaving("A", P0 + c.aLeaves));
      const { writes, views, starts } = simulate({ door: c.door, latency: c.latency, events, hidden: c.hidden });
      const fail = (why) => failures.push({ ...c, door: c.door === DOOR ? "door" : "fast", why, writes });
      // writes alternate open, closed, open…: no cycle has a second write of either kind
      for (let i = 1; i < writes.length; i++) if (writes[i].to === writes[i - 1].to) fail(`two ${writes[i].to} writes in a row`);
      if (writes[0] && writes[0].to !== "open") fail("first write isn't an open");
      // B pressed first and A's open is the one written: the loser of the ranking pressed first, and gave way
      if (c.bPress != null && c.bPress < 0 && writes[0]?.by === "A") loserFirst++;
      maxWrites = Math.max(maxWrites, writes.length);
      const alive = [...views.values()].filter((v) => v.alive);
      // every view that's left agrees, and nobody is holding it
      for (const v of alive) {
        if (JSON.stringify(v.replica.trait) !== JSON.stringify(alive[0].replica.trait) || JSON.stringify(v.replica.position) !== JSON.stringify(alive[0].replica.position)) fail("replicas differ");
        if (v.mine || v.slides.moving()) fail(`${v.session} still holds it`);
      }
      // anyone still drawing here (so computing the world): it's shut, where it started, its runtime state gone;
      // with only hidden views left no time passes, and it may be left open, where it opened
      const r = alive[0]?.replica;
      if (alive.some((v) => !v.hidden)) {
        if (r.trait.at !== "closed" || JSON.stringify(r.position) !== JSON.stringify([10, 2, 3]) || "since" in r.trait || "by" in r.trait) fail(`ends ${r.trait.at} at ${r.position}`);
      } else if (r && r.trait.at === "open" && Math.abs(r.position[1] - (2 + c.door.stops.open)) > 1e-9) fail("left open off its stop");
      // a close started by the world (not a press) only once its wait had passed in world time
      for (const st of starts) {
        if (st.to !== "closed") continue;
        const opened = [...writes].reverse().find((w) => w.to === "open" && w.at <= st.at);
        if (opened && st.W + 1e-9 < opened.since + c.door.wait && !c.presses?.some((p) => Math.abs(p - st.at) < TICK)) fail(`closed at world ${st.W}, before ${opened.since} + ${c.door.wait}`);
      }
      // every rest written is one of the two stops
      for (const w of writes) if (Math.abs(w.position[1] - (w.to === "open" ? 2 + c.door.stops.open : 2)) > 1e-9 || w.position[0] !== 10 || w.position[2] !== 3) fail(`a write off the line: ${w.position}`);
    }
    expect(failures.slice(0, 1).map((f) => ({ ...f, writes: f.writes.map((w) => `${w.at} ${w.by} ${w.to}`) }))).toEqual([]);
    expect(maxWrites).toBeGreaterThan(2); // some cases are two cycles (B shuts it early, then opens it again)
    expect(loserFirst).toBeGreaterThan(0); // the cases the bound is about are among them
  }, 60_000); // exhaustive: ~10 s seen under load (default 5 s)

  it("a plain cycle is two writes, the second a wait after the first", () => {
    const { writes } = simulate({ door: DOOR, latency: 40, events: [press("A", 0), joining("B", 0)] });
    expect(writes.map((w) => [w.by, w.to])).toEqual([["A", "open"], ["A", "closed"]]);
    const opened = Math.ceil((travelTime(readSlide(DOOR)) * 1000) / TICK) * TICK;
    expect(writes[0].at).toBeGreaterThanOrEqual(Math.max(opened - TICK, HEAR_MS));
    // its wait counts from when it got there, in world time (a tick's rounding either way)
    expect(writes[1].at - writes[0].at).toBeGreaterThanOrEqual(DOOR.wait * 1000 + travelTime(readSlide(DOOR)) * 1000 - TICK);
  });

  it("the opener gone: the one computing the world now closes it, on time", () => {
    const { writes, starts } = simulate({ door: DOOR, latency: 40, events: [press("A", 0), joining("B", 0), leaving("A", 2500)] });
    expect(writes.map((w) => [w.by, w.to])).toEqual([["A", "open"], ["B", "closed"]]);
    const close = starts.find((s) => s.to === "closed");
    expect(close.W).toBeGreaterThanOrEqual(writes[0].since + DOOR.wait);
    expect(close.W).toBeLessThan(writes[0].since + DOOR.wait + 2 * (TICK / 1000));
  });

  it("the opener gone mid-motion: nothing written, it's shut where the doc had it", () => {
    const { writes, views } = simulate({ door: DOOR, latency: 40, events: [press("A", 0), joining("B", 0), leaving("A", 500)] });
    expect(writes).toEqual([]);
    expect(views.get("B").replica.trait.at).toBe("closed");
  });

  it("nobody present, no time passes: a late joiner finds the door open with the rest of its wait to run", () => {
    const { writes, starts } = simulate({ door: DOOR, latency: 40, events: [press("A", 0), leaving("A", 2500), joining("B", 20_000)] });
    expect(writes.map((w) => [w.by, w.to])).toEqual([["A", "open"], ["B", "closed"]]);
    const close = starts.find((s) => s.to === "closed");
    // A's 2.5 s of world time, then B's: the wait resumes where it stood, rather than slamming on arrival
    expect(close.at - 20_000).toBeGreaterThanOrEqual((writes[0].since + DOOR.wait - 2.5) * 1000 - 2 * TICK);
    expect(close.at - 20_000).toBeLessThanOrEqual((writes[0].since + DOOR.wait - 2.5) * 1000 + 2 * TICK);
  });
});

describe("the bound is real", () => {
  it("past it, the view that loses the ranking having pressed first, both write an open", () => {
    // B presses; A presses 590 ms later, before B's hold reaches it, so A's hold ties B's stamp and wins on its
    // session; B hears it 590 + 600 ms after its press, past HEAR_MS, so B has written by then
    const latency = 600;
    expect(2 * (latency + POSE_MS)).toBeGreaterThan(HEAR_MS);
    const { writes } = simulate({ door: FAST, latency, events: [joining("B", 0), press("B", 100), press("A", 690)] });
    expect(writes.filter((w) => w.to === "open").length).toBe(2);
  });
  it("within it, the same presses: one open", () => {
    const latency = MAX_LATENCY_MS - 10;
    const { writes } = simulate({ door: FAST, latency, events: [joining("B", 0), press("B", 100), press("A", 100 + latency - 10)] });
    expect(writes.filter((w) => w.to === "open").map((w) => w.by)).toEqual(["A"]);
  });
});

describe("taken here (a person's hold in the opener's own view: api.pose.hold refuses the motion's)", () => {
  // one view, its doc and its holds; the hold stands for the first `stands` calls, then a person has it
  function one(stands) {
    let T = 0;
    let calls = 0;
    const doc = { objects: { door: { transform: { position: [10, 2, 3], rotation: [0, 0, 0], scale: 1 }, traits: { [KEY]: { ...DOOR } } } } };
    const log = { changes: 0, releases: [] };
    const slides = createSlides({
      now: () => T,
      t: () => 0,
      doc: () => doc,
      change: () => log.changes++,
      hold: () => calls++ < stands,
      release: (id, o) => log.releases.push(o?.landed === true),
      heldBy: () => null, // nobody elsewhere: the taking is this view's own
    });
    const started = slides.move("door");
    while (T < 10_000) {
      T += TICK;
      slides.frame();
    }
    return { started, log, slides, frames: calls };
  }
  const lands = Math.ceil(Math.max(travelTime(readSlide(DOOR)) * 1000, HEAR_MS) / TICK);
  it("refused from the start: no motion", () => {
    const { started, log, slides } = one(0);
    expect(started).toBe(false);
    expect(log.changes).toBe(0);
    expect(slides.moving()).toBe(false);
    expect(slides.verb("door").label).toBe("Open");
  });
  it(`taken at every frame before it lands (${lands}): it lets go and writes nothing; untaken, it lands once`, () => {
    for (let k = 1; k <= lands; k++) {
      const { started, log, slides } = one(k);
      expect(started).toBe(true);
      expect(log.changes).toBe(0);
      expect(log.releases).toEqual([false]);
      expect(slides.moving()).toBe(false);
    }
    const { log } = one(Infinity);
    expect(log.changes).toBe(1);
    expect(log.releases).toEqual([true]);
  });
});

describe("a hidden tab (no frames, only its timers)", () => {
  it("still lands what it opened; the drawing view, computing the world, closes it", () => {
    const { writes } = simulate({ door: DOOR, latency: 40, hidden: ["A"], events: [press("A", 0), joining("B", 0)] });
    expect(writes.map((w) => [w.by, w.to])).toEqual([["A", "open"], ["B", "closed"]]);
  });
  it("alone, it lands what it opened and the door stays open: nobody computes, so no time passes", () => {
    const { writes, W } = simulate({ door: DOOR, latency: 40, hidden: ["A"], events: [press("A", 0)] });
    expect(writes.map((w) => [w.by, w.to])).toEqual([["A", "open"]]);
    expect(W).toBe(0);
  });
});

describe("H8: a pause changes no act and no liveness outcome, paused at every step", () => {
  // a plain cycle and two at once, each with the world paused for a while from every 250 ms of it
  const RUNS = [
    { name: "a cycle", events: () => [press("A", 0), joining("B", 0)] },
    { name: "two at once", events: () => [joining("B", 0), press("A", 100), press("B", 100)] },
  ];
  const cases = [];
  for (const door of [DOOR, FAST]) for (const run of RUNS) for (const ms of [500, 3000]) for (let from = 0; from <= 12_000; from += 250) cases.push({ door, run, ms, from });

  it(`in all ${cases.length} cases: the same writes by the same views, each act landing when it would have, every close a step at its wait in world time`, () => {
    const failures = [];
    const base = new Map();
    for (const c of cases) {
      const key = `${c.door === DOOR}${c.run.name}`;
      if (!base.has(key)) base.set(key, simulate({ door: c.door, latency: 40, events: c.run.events() }));
      const plain = base.get(key);
      const paused = simulate({ door: c.door, latency: 40, events: c.run.events(), pauses: [[c.from, c.ms]] });
      const fail = (why) => failures.push({ door: c.door === DOOR ? "door" : "fast", run: c.run.name, from: c.from, ms: c.ms, why });
      const said = (r) => r.writes.map((w) => `${w.by} ${w.to}`).join(", ");
      if (said(paused) !== said(plain)) fail(`writes ${said(paused)} vs ${said(plain)}`);
      // an act's landing is the act's: an open lands when it would have, paused or not (and so after HEAR_MS: liveness)
      const open = (r) => r.writes.find((w) => w.to === "open");
      if (open(paused)?.at !== open(plain)?.at) fail(`the open landed at ${open(paused)?.at}, not ${open(plain)?.at}`);
      for (const st of paused.starts) {
        const w = paused.writes.find((x) => x.by === st.by && x.to === st.to && x.at >= st.at);
        if (w && w.at - st.at < HEAR_MS - TICK) fail("a write before HEAR_MS");
      }
      // every close is the world's step, at the first tick its wait had passed in world time, the pause not counted
      for (const st of paused.starts.filter((s) => s.to === "closed")) {
        const opened = paused.writes.find((x) => x.to === "open");
        if (st.W + 1e-9 < opened.since + c.door.wait || st.W > opened.since + c.door.wait + TICK / 1000 + 1e-9) fail(`closed at world ${st.W}, wait up at ${opened.since + c.door.wait}`);
        if (st.at >= c.from && st.at < c.from + c.ms) fail("a close started while paused");
      }
      const end = (r) => JSON.stringify([...r.views.values()].map((v) => [v.replica.trait.at, v.replica.position]));
      if (end(paused) !== end(plain)) fail("ends differently");
    }
    expect(failures.slice(0, 3)).toEqual([]);
  }, 60_000); // exhaustive: every case on the paused clock too
});
