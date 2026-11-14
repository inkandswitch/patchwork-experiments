// Starting a machine object's session (start.js) over a bounded space of
// what can go wrong: two or three views, each of which makes it fine, fails
// once, or leaves while it's at it (its claim then lapses, and a dead tab
// writes nothing); what the machine runs arriving at once, a little later or
// much later; the views opening together or one after another. In every case
// some view that stayed writes the session, exactly once, and every view
// stops asking. Finite and exhaustive; virtual time; no randomness.
import { retrying, makeSession } from "./start.js";

const EVERY = 1000; // ms between tries
const CREATE = 500; // ms a session takes to make
const LEAVE = 100; // ms into its first try that a leaving view goes
const END = 30_000;

const FATES = ["ok", "fails once", "leaves"];

function* fates(n) {
  if (n === 0) return yield [];
  for (const rest of fates(n - 1)) for (const f of FATES) yield [...rest, f];
}

// One world: virtual time, a claim, a trait, and the views.
function run({ fate, contentAt, gap }) {
  let now = 0;
  const queue = []; // { at, fn, seq }
  let seq = 0;
  const schedule = (ms, fn) => {
    const ev = { at: now + ms, fn, seq: seq++ };
    queue.push(ev);
    return () => {
      const i = queue.indexOf(ev);
      if (i >= 0) queue.splice(i, 1);
    };
  };
  const trait = { session: null };
  const writes = [];
  let holder = null;
  const views = fate.map((f, i) => ({ i, fate: f, here: true, creates: 0, cancels: new Set(), stop: null }));

  for (const v of views) {
    // this view's timers die with its tab
    const after = (ms, fn) => {
      if (!v.here) return () => {};
      let cancel = null;
      const off = schedule(ms, () => (v.cancels.delete(off2), v.here && fn()));
      const off2 = () => off();
      v.cancels.add(off2);
      cancel = () => (v.cancels.delete(off2), off());
      return cancel;
    };
    const claim = () => {
      if (holder !== null && holder !== v.i && views[holder].here) return null;
      holder = v.i;
      return () => {
        if (holder === v.i) holder = null;
      };
    };
    const content = async () => (now >= contentAt ? new Uint8Array([1, 2, 3]) : null);
    const create = () =>
      new Promise((resolve, reject) => {
        v.creates++;
        const first = v.creates === 1;
        schedule(CREATE, () => {
          if (!v.here) return; // a dead tab never finishes
          if (v.fate === "fails once" && first) reject(new Error("a fetch failed"));
          else resolve(`session:${v.i}:${v.creates}`);
        });
      });
    const write = (url) => {
      if (!v.here || trait.session) return;
      trait.session = url;
      writes.push(v.i);
    };
    schedule(v.i * gap, () => {
      if (v.fate === "leaves")
        schedule(LEAVE, () => {
          v.here = false;
          for (const off of v.cancels) off();
          v.cancels.clear();
        });
      v.stop = retrying({
        attempt: () => makeSession({ claim, has: () => !!trait.session, content, create, write }),
        after,
        every: EVERY,
      });
    });
  }
  return { views, trait, writes, queue, step: async () => {
    // the next event, then everything it set going
    queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const ev = queue.shift();
    if (!ev) return false;
    now = ev.at;
    ev.fn();
    for (let k = 0; k < 10; k++) await Promise.resolve();
    return now <= END;
  } };
}

test("some view that stayed writes the session exactly once, whoever fails or leaves, and every view stops asking", async () => {
  let cases = 0;
  for (const n of [2, 3])
    for (const fate of fates(n)) {
      if (fate.every((f) => f === "leaves")) continue; // nobody left to make it
      for (const contentAt of [0, 1500, 4000])
        for (const gap of [0, 700]) {
          const w = run({ fate, contentAt, gap });
          while (await w.step());
          const why = JSON.stringify({ fate, contentAt, gap, writes: w.writes, queue: w.queue.length });
          expect(w.trait.session, why).not.toBe(null);
          expect(w.writes.length, why).toBe(1);
          expect(w.views[w.writes[0]].here, why).toBe(true);
          expect(w.queue.length, why).toBe(0); // nobody is still asking
          cases++;
        }
    }
  expect(cases).toBe((3 ** 2 - 1 + 3 ** 3 - 1) * 3 * 2);
});

test("retrying: a try that returns false or throws is tried again on the stage's time, one that returns true never, and a cancel stops it", async () => {
  // every sequence of 3 outcomes, cancelled once each number of tries 1..3 has settled, or never
  const OUTCOMES = [true, false, "throws"];
  let cases = 0;
  for (const a of OUTCOMES) for (const b of OUTCOMES) for (const c of OUTCOMES)
    for (const cancelAfter of [1, 2, 3, Infinity]) {
      const plan = [a, b, c, true];
      let tries = 0;
      const timers = [];
      const failed = [];
      let stop = null;
      const after = (ms, fn) => {
        expect(ms).toBe(50);
        const t = { fn, on: true };
        timers.push(t);
        return () => void (t.on = false);
      };
      stop = retrying({
        attempt: async () => {
          const o = plan[tries++];
          if (o === "throws") throw new Error(`try ${tries}`);
          return o;
        },
        after,
        every: 50,
        failed: (e) => failed.push(e.message),
      });
      for (let k = 0; k < 8; k++) {
        for (let m = 0; m < 4; m++) await Promise.resolve(); // the try settles
        if (tries >= cancelAfter && stop) (stop(), (stop = null));
        const t = timers.find((x) => x.on);
        if (t) (t.on = false), t.fn();
      }
      for (let k = 0; k < 4; k++) await Promise.resolve();
      const first = plan.findIndex((o) => o === true) + 1; // tries until one returns true
      expect(tries).toBe(Math.min(first, cancelAfter));
      expect(failed).toEqual(plan.slice(0, tries).flatMap((o, i) => (o === "throws" ? [`try ${i + 1}`] : [])));
      expect(timers.filter((t) => t.on)).toEqual([]);
      cases++;
    }
  expect(cases).toBe(27 * 4);
});
