// World time (clock.js; NATIVE.md, "World time", H7): what the computer's
// checkpoints write into the doc, and how far a follower may run, on two views
// with real Automerge replicas of one doc.
import { describe, it, expect } from "vitest";
import * as Automerge from "@automerge/automerge";
import { CHECKPOINT_MS, CLOCK, LAG_MS, createClock, docTime, eligibility, readClock, sampleTime } from "./clock.js";

// (the clock's map made with the doc, as the scene datatype's init makes it)
const BASE = Automerge.from({ clock: { running: true, t: 0 }, objects: { o: { transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } } } });

/**
 * Two writable views of one doc, each with its own replica, clock and one
 * kept process, merged after every frame. Presence is shared at once: who's
 * here, each computer's published t, and (when given) `shownAt(wall)`, the
 * moment on the computer's clock whose poses a follower draws now.
 */
function world({ shownAt = null } = {}) {
  let wall = 1_000_000;
  const handles = new Set();
  const own = (doc) => (handles.add(Automerge.getBackend(doc)), doc);
  const samples = new Map(); // session → { t, at }
  const views = [0, 1].map((i) => ({ i, session: `s${i}`, viewer: `v${i}`, here: false, doc: null, clock: null }));
  const here = () => views.filter((v) => v.here);
  const present = (s) => views.some((o) => o.here && o.session === s);
  const claimOf = (v) => {
    const c = v.doc.claims?.[CLOCK];
    return c && typeof c.session === "string" ? c : null;
  };

  function join(v) {
    v.doc = own(Automerge.clone(BASE));
    [v.doc] = Automerge.applyChanges(v.doc, here().flatMap((o) => Automerge.getAllChanges(o.doc)));
    v.here = true;
    let held = null;
    v.held = () => held;
    v.lose = () => {
      const h = held;
      held = null;
      h?.onLost();
    };
    v.clock = createClock({
      doc: () => v.doc,
      change: (fn) => {
        v.doc = Automerge.change(v.doc, fn);
        v.clock?.check(); // the stage's doc loop, re-entrantly
      },
      claim: {
        take(onLost) {
          const c = claimOf(v);
          if (c && c.session !== v.session && present(c.session)) return null;
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
          return present(c.session) ? { viewer: c.viewer, session: c.session, mine: false } : null;
        },
      },
      presence: {
        set: (s) => (s ? samples.set(v.session, s) : samples.delete(v.session)),
        sample: (s) => (present(s) ? (samples.get(s) ?? null) : null),
        shownAt: (s) => (present(s) && shownAt ? shownAt(wall) : null),
        rate() {},
      },
      eligible: () => eligibility({ acts: true, writable: true, visible: true, settled: true, complete: true }),
      writable: () => true,
      viewer: v.viewer,
      now: () => wall,
    });
    v.clock.process({ step() {}, save() {} });
  }

  function sync() {
    const live = here();
    if (live.length < 2) return;
    const [first, ...rest] = live;
    for (const v of rest) first.doc = Automerge.merge(first.doc, v.doc);
    for (const v of rest) v.doc = Automerge.merge(v.doc, first.doc);
    for (const v of live) {
      const c = claimOf(v);
      if (v.held() && c && c.session !== v.session) v.lose();
    }
  }

  /** A frame (ms) for every view here, merged; or for `only` those, unmerged (the others' frames have stopped). */
  function frame(ms = 100, only = null) {
    wall += ms;
    for (const v of only ?? here()) v.clock.tick(wall);
    if (only) return;
    sync();
    for (const v of here()) v.clock.check();
  }

  function leave(v) {
    // the stage going: the clock lets go with a checkpoint, then presence says bye
    v.clock.dispose();
    sync();
    v.here = false;
    samples.delete(v.session);
  }

  return {
    views,
    join,
    leave,
    frame,
    samples,
    wall: () => wall,
    /** Wall time passes with no frame (a checkpoint falls due by the next one). */
    skip: (ms) => (wall += ms),
    free: () => (handles.forEach((h) => h.free()), handles.clear()),
  };
}

describe("the computer's checkpoints write the world time it has reached", () => {
  it("every CHECKPOINT_MS, and when the computing view's clock is disposed: clock.t is the computer's t then, on every replica", () => {
    const w = world();
    const [a, b] = w.views;
    w.join(a);
    for (let i = 0; i < 20; i++) w.frame(100);
    w.join(b);
    for (let i = 0; i < 3; i++) w.frame(100);
    expect(a.clock.computing()).toBe(true);
    expect(b.clock.computing()).toBe(false);
    expect(readClock(a.doc).t).toBe(0); // no checkpoint yet

    // the periodic checkpoint, twice: each writes the t of the frame it falls due in
    let last = 0;
    for (let round = 0; round < 2; round++) {
      const before = a.clock.t();
      w.skip(CHECKPOINT_MS);
      w.frame(100); // the frame moves t on by at most MAX_FRAME_S (a stall is skipped), then checkpoints
      const written = readClock(a.doc).t;
      expect(written).toBe(a.clock.t()); // the computer's t at that frame, as written (docTime)
      expect(written).toBeCloseTo(before + 0.25, 5);
      expect(written).toBeGreaterThan(last);
      expect(readClock(b.doc).t).toBe(written); // merged into the follower's replica
      last = written;
      for (let i = 0; i < 10; i++) w.frame(100);
    }

    // the leave checkpoint: written as the computing view's clock is disposed, between periodic ones
    for (let i = 0; i < 7; i++) w.frame(100);
    const leaving = a.clock.t();
    expect(leaving).toBeGreaterThan(last + 1.5);
    w.leave(a);
    expect(readClock(a.doc).t).toBe(docTime(leaving));
    expect(readClock(b.doc).t).toBe(docTime(leaving));
    // the follower takes over from there
    w.frame(100);
    expect(b.clock.computing()).toBe(true);
    expect(b.clock.t()).toBeGreaterThanOrEqual(docTime(leaving));
    w.free();
  });
});

describe("a follower shows the computer's t at shownAt, never past what it has heard", () => {
  // its poses' playout delay (1.5 × 50 ms): unlike LAG_MS, so a follower ignoring shownAt shows a different t
  const DELAY_MS = 75;
  it("tracks the computer's t at shownAt, not beyond it; with the computer's frames stopped and shownAt running on, stops at the newest t heard", () => {
    expect(DELAY_MS).not.toBe(LAG_MS);
    const w = world({ shownAt: (wall) => wall - DELAY_MS });
    const [a, b] = w.views;
    w.join(a);
    for (let i = 0; i < 20; i++) w.frame(100);
    w.join(b);
    for (let i = 0; i < 30; i++) {
      w.frame(100);
      expect(a.clock.computing()).toBe(true);
      const heard = w.samples.get(a.session);
      const atShown = sampleTime(heard, w.wall() - DELAY_MS); // the computer's t at shownAt
      expect(b.clock.t()).toBeLessThanOrEqual(atShown + 1e-9);
      expect(b.clock.t()).toBeCloseTo(atShown, 6);
    }

    // the computer's frames stop (it's still here); the follower's run on, and so does shownAt
    const heard = w.samples.get(a.session);
    for (let i = 0; i < 30; i++) {
      w.frame(100, [b]);
      expect(b.clock.t()).toBeLessThanOrEqual(heard.t);
    }
    expect(sampleTime(heard, w.wall() - DELAY_MS)).toBeGreaterThan(heard.t + 2); // where shownAt alone would put it
    expect(b.clock.t()).toBe(heard.t); // it ran up to what it heard, and waits there
    w.free();
  });
});
