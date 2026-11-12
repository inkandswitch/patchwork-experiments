// The slide joint: its reading of the trait, and every interleaving of a
// finite set of events among views on a simulated network, run on the real
// createSlides.
import { describe, expect, it } from "vitest";
import { GRACE_MS, HEAR_MS, KEY, MAX_LATENCY_MS, POSE_MS, createSlides, positionAt, readSlide, travelTime } from "./slide.js";

describe("reading the trait", () => {
  it("fills defaults and makes the axis unit", () => {
    expect(readSlide({ axis: [0, 2, 0], stops: { closed: 0, open: 3 }, speed: 1.5 })).toEqual({ axis: [0, 1, 0], stops: { closed: 0, open: 3 }, speed: 1.5, wait: 0, at: "closed", since: null, by: null });
    expect(readSlide({ stops: { closed: 0, open: 1 }, at: "open", wait: 4, since: 5, by: "s" })).toMatchObject({ axis: [0, 1, 0], speed: 1, wait: 4, at: "open", since: 5, by: "s" });
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

const DOOR = { axis: [0, 1, 0], stops: { closed: 0, open: 3.444 }, speed: 1.944, wait: 4.286, at: "closed" };
const FAST = { ...DOOR, stops: { closed: 0, open: 1.667 }, speed: 7.778 }; // a blazing door: 0.21 s
const TICK = 16;

function simulate({ door, latency, events, hidden = [], until = 30_000 }) {
  let T = 0;
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
      session,
      now: () => T,
      doc,
      change(fn) {
        const d = JSON.parse(JSON.stringify(doc()));
        fn(d);
        const next = { position: d.objects.door.transform.position, trait: d.objects.door.traits[KEY], stamp: [T, session] };
        writes.push({ at: T, by: session, to: next.trait.at, position: [...next.position] });
        v.replica = next;
        send((o) => {
          const [t0, s0] = o.replica.stamp;
          if (T > t0 || (T === t0 && session > s0)) o.replica = JSON.parse(JSON.stringify(next));
        });
      },
      // a hold goes out at once and then every 50 ms while held (the stage's pose stream), so a view that joins mid-motion hears it
      hold(id, t) {
        if (!v.mine) v.mine = { since: ++v.lamport, sent: -Infinity };
        v.shown = t.position;
        if (T - v.mine.sent < POSE_MS) return;
        v.mine.sent = T;
        const since = v.mine.since;
        send((o) => {
          o.lamport = Math.max(o.lamport, since);
          // a new hold replaces a landed one (presence.js: a landed hold is kept only until the doc catches up)
          const was = o.heard.get(session);
          if (!was || was.landed || was.since === since) o.heard.set(session, { since, landed: false });
        });
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
      present: (s) => v.present.has(s),
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
  while (T <= until) {
    queue.sort((a, b) => a.at - b.at || a.n - b.n);
    while (queue.length && queue[0].at <= T) queue.shift().fn();
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
  return { writes, views };
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
      if (c.bPress != null) events.push(press("B", P0 + c.bPress));
      if (c.aLeaves != null) events.push(leaving("A", P0 + c.aLeaves));
      const { writes, views } = simulate({ door: c.door, latency: c.latency, events, hidden: c.hidden });
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
      // anyone still here: it's shut, where it started, its runtime state gone
      if (alive.length) {
        const r = alive[0].replica;
        if (r.trait.at !== "closed" || JSON.stringify(r.position) !== JSON.stringify([10, 2, 3]) || "since" in r.trait || "by" in r.trait) fail(`ends ${r.trait.at} at ${r.position}`);
      }
      // every rest written is one of the two stops
      for (const w of writes) if (Math.abs(w.position[1] - (w.to === "open" ? 2 + c.door.stops.open : 2)) > 1e-9 || w.position[0] !== 10 || w.position[2] !== 3) fail(`a write off the line: ${w.position}`);
    }
    expect(failures.slice(0, 1).map((f) => ({ ...f, writes: f.writes.map((w) => `${w.at} ${w.by} ${w.to}`) }))).toEqual([]);
    expect(maxWrites).toBeGreaterThan(2); // some cases are two cycles (B shuts it early, then opens it again)
    expect(loserFirst).toBeGreaterThan(0); // the cases the bound is about are among them
  });

  it("a plain cycle is two writes, the second a wait after the first", () => {
    const { writes } = simulate({ door: DOOR, latency: 40, events: [press("A", 0), joining("B", 0)] });
    expect(writes.map((w) => [w.by, w.to])).toEqual([["A", "open"], ["A", "closed"]]);
    const opened = Math.ceil((travelTime(readSlide(DOOR)) * 1000) / TICK) * TICK;
    expect(writes[0].at).toBeGreaterThanOrEqual(Math.max(opened - TICK, HEAR_MS));
    expect(writes[1].at - writes[0].at).toBeGreaterThanOrEqual(DOOR.wait * 1000 + travelTime(readSlide(DOOR)) * 1000);
  });

  it("two pressing at once: one opens it, the other lets go without writing", () => {
    const { writes } = simulate({ door: DOOR, latency: 40, events: [joining("B", 0), press("A", 100), press("B", 100)] });
    expect(writes.filter((w) => w.to === "open")).toHaveLength(1);
    expect(writes).toHaveLength(2);
  });

  it("the opener gone: the other closes it, a grace period after it should have", () => {
    const { writes } = simulate({ door: DOOR, latency: 40, events: [press("A", 0), joining("B", 0), leaving("A", 2500)] });
    expect(writes.map((w) => [w.by, w.to])).toEqual([["A", "open"], ["B", "closed"]]);
    expect(writes[1].at - writes[0].at).toBeGreaterThanOrEqual(DOOR.wait * 1000 + GRACE_MS);
  });

  it("the opener gone mid-motion: nothing written, it's shut where the doc had it", () => {
    const { writes, views } = simulate({ door: DOOR, latency: 40, events: [press("A", 0), joining("B", 0), leaving("A", 500)] });
    expect(writes).toEqual([]);
    expect(views.get("B").replica.trait.at).toBe("closed");
  });

  it("a late joiner finds an open door whose opener is gone, and closes it", () => {
    const { writes } = simulate({ door: DOOR, latency: 40, events: [press("A", 0), leaving("A", 2500), joining("B", 8000)] });
    expect(writes.map((w) => [w.by, w.to])).toEqual([["A", "open"], ["B", "closed"]]);
    expect(writes[1].at).toBeGreaterThanOrEqual(8000 + GRACE_MS);
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

describe("a hidden tab (no frames, only its timers)", () => {
  it("still lands what it opened and closes it after its wait: two writes", () => {
    const { writes } = simulate({ door: DOOR, latency: 40, hidden: ["A"], events: [press("A", 0), joining("B", 0)] });
    expect(writes.map((w) => [w.by, w.to])).toEqual([["A", "open"], ["A", "closed"]]);
  });
});
