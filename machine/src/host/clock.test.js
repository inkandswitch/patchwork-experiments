// The session's clock on a scene's world time (worldClock), over every
// schedule of pauses and resumes in a bounded space: two views of one
// session, each with its own world time (one trails the other, as a scene's
// follower trails the view computing its world), either of them pausing or
// resuming at each step. Finite and exhaustive; no randomness.
import { SessionClock, worldClock, tickAt } from "./clock.js";
import { quietClock } from "../patchwork/quiet.js";

const HZ = [35, 1];
const STEP = 0.1; // world seconds between steps
const MARGIN = 0.25; // SessionClock.pause's default
const EVENTS = ["-", "pa", "ra", "pb", "rb"]; // nothing; a or b pauses; a or b resumes

// A session document both views read at once (sync is modelled by the lag
// between their world times, not by delivery).
function doc(clock) {
  const d = { clock };
  return { doc: () => d, change: (fn) => fn(d) };
}

// Every sequence of n events.
function* schedules(n) {
  if (n === 0) return yield [];
  for (const rest of schedules(n - 1)) for (const e of EVENTS) yield [...rest, e];
}

test("one segment of world time: tick 0 at creation however far into the world, and hz ticks a second after", () => {
  for (const born of [0, 3600, 36000.4]) {
    const world = { s: born, t: () => world.s, running: () => true };
    const h = doc({ t: 0, at: born * 1000, until: 0 });
    const c = worldClock(h, world);
    expect(tickAt(c, HZ)).toBe(0);
    world.s += 10;
    expect(tickAt(c, HZ)).toBe(0); // stopped: nobody plays
    c.resume();
    const from = world.s;
    for (let k = 0; k <= 70; k++) {
      world.s = from + (k + 0.5) / 35; // mid-tick, so rounding can't decide it
      expect(tickAt(c, HZ)).toBe(k);
    }
  }
});

test("a paused world stops the machine: running() is false and t holds, whatever the session says", () => {
  for (const until of [undefined, 5, 0]) {
    const world = { s: 100, run: false, t: () => world.s, running: () => world.run };
    const c = worldClock(doc({ t: 1, at: 99_000, until }), world);
    const t = c.t();
    expect(c.running()).toBe(false);
    expect(c.t()).toBe(t);
    world.run = true;
    expect(c.running()).toBe(until === undefined || t < until);
  }
});

test("every schedule of pauses and resumes by either view, each view's world trailing the other's by 0 to 3 steps", () => {
  let cases = 0, drops = 0;
  for (const lag of [0, 1, 2, 3])
    for (const events of schedules(4)) {
      cases++;
      // a computes the world; b trails it by `lag` steps (a scene's follower)
      const world = { a: 50, b: 50 - lag * STEP };
      const views = {
        a: { t: () => world.a, running: () => true },
        b: { t: () => world.b, running: () => true },
      };
      const h = doc({ t: 0, at: world.a * 1000, until: 0 }); // made stopped, at a's world time
      const c = { a: worldClock(h, views.a), b: worldClock(h, views.b) };
      const before = { a: c.a.t(), b: c.b.t() };
      for (const e of events) {
        if (e !== "-") {
          const by = e[1];
          const was = { a: c.a.t(), b: c.b.t() };
          const set = h.doc().clock;
          if (e[0] === "p") c[by].pause();
          else c[by].resume();
          // a stop once set stands until a resume: a second pause never moves it
          if (e[0] === "p" && set.until !== undefined) expect(h.doc().clock).toBe(set);
          for (const v of ["a", "b"]) {
            const now = c[v].t();
            if (e[0] === "r") {
              // resuming never takes anyone back below where they were stopped
              expect(now).toBeGreaterThanOrEqual(was[v] - 1e-9);
            } else if (now < was[v] - 1e-9) {
              // a pause takes a view back only when it is ahead of the pauser by more than the margin
              drops++;
              expect(world[v] - world[by]).toBeGreaterThan(MARGIN - 1e-9);
              expect(now).toBe(h.doc().clock.until);
            }
          }
        }
        // a step of world time: each view's t never goes back between writes
        Object.assign(before, { a: c.a.t(), b: c.b.t() });
        world.a += STEP;
        world.b += STEP;
        for (const v of ["a", "b"]) expect(c[v].t()).toBeGreaterThanOrEqual(before[v] - 1e-9);
      }
      // stopped, both views agree on the tick once their worlds pass the stop
      if (h.doc().clock.until !== undefined) {
        world.a += 1;
        world.b += 1;
        expect(tickAt(c.a, HZ)).toBe(tickAt(c.b, HZ));
        expect(c.a.running() || c.b.running()).toBe(false);
      }
      // running, a trailing view's tick trails by its lag and no more
      else expect(tickAt(c.a, HZ) - tickAt(c.b, HZ)).toBeLessThanOrEqual(Math.ceil(lag * STEP * 35) + 1);
    }
  expect(cases).toBe(4 * 5 ** 4);
  expect(drops).toBeGreaterThan(0); // the overshoot case is in the space, and is rolled back to the stop
});

test("the quiet clock in world time: the last seat ending stops the machine there, for every view", () => {
  // seats ending at every tick 0..40, the stop written at every world time a few steps later
  for (let end = 0; end <= 40; end++)
    for (const late of [0, 0.1, 0.5, 2]) {
      const world = { s: 7200 + end / 35 + late, t: () => world.s, running: () => true };
      const session = { seats: { x: { port: 0, from: 0, until: end, by: "a" } }, clock: { t: 0, at: 7200_000 } };
      const stop = quietClock(session, 2, 35, world.s * 1000);
      expect(stop).toEqual({ t: end / 35, at: world.s * 1000, until: end / 35 });
      const c = worldClock(doc(stop), world);
      for (const ahead of [0, 1, 100]) {
        world.s += ahead;
        expect(tickAt(c, HZ)).toBe(end);
        expect(c.running()).toBe(false);
      }
    }
});

test("on the wall clock as on world time: a run starts at `at`, never before", () => {
  // A peer whose shared wall is behind the writer's holds at t, rather than going below it.
  for (const behind of [0, 1, 50, 400]) {
    const h = doc({ t: 12, at: 10_000 });
    const c = new SessionClock(h, () => 10_000 - behind);
    expect(c.t()).toBe(12);
  }
});
