// A slide joint: a part that moves along a straight line between two stops,
// closed and open (a door rising into its frame, a drawer, a sliding hatch).
// The trait is the joint; the object's transform is where the part is.
//
//   "joints.slide": {
//     axis:  [x, y, z],              // the way it opens, in its parent's frame (made unit here)
//     stops: { closed: m, open: m }, // where each stop is along the axis
//     speed: m/s,                    // how fast it moves
//     wait?: s,                      // if > 0, it closes itself this long after it opened
//     at:    "closed" | "open",      // the stop the transform is at
//     since?: s,                     // when it came to rest open, in the doc's world time (runtime)
//   }
//
// The base of the line isn't stored: it is the position less axis × the
// stop it's at, so moving the part in the editor moves its line with it.
//
// WHO MOVES IT, AND WHAT IS WRITTEN. One view moves it at a time and the doc
// holds only where it rests: the view that moves it shows the motion as a
// pose hold (everyone sees it; the stage's raycasts and worldOf see it, so it
// blocks a walker as drawn), and writes the stop it reaches once. So a cycle
// (open, wait, close) is two writes.
//
// THREE TIMES (scene/TOOLS.md §7). A motion is an act: timed by the wall
// clock from when it started, not by frames and not by the world's clock,
// so a pause never stops one halfway. Where the part is drawn is
// (now − started) / travel time along the line, and the write is due at a
// fixed time, started + max(travel time, HEAR_MS), whether or not any frame
// was drawn in between (a hidden tab draws none, but its timers still run,
// so it still lands and writes). HEAR_MS is liveness, on the wall clock too.
// The wait is world time: `since` is the doc's world t when it came to rest
// open, and closing is a step of the scene's process (`due`), run by
// whichever view computes the doc's clock, once t ≥ since + wait. So a pause
// holds a door open, nobody present holds it open (no time passes), and the
// view that closes it is never a matter of who opened it.
//
// TWO AT ONCE. Two views starting at once both hold it; the stage ranks their
// holds the same way everywhere (STAGE.md, `heldBy`), and the one that is
// told a peer holds it first lets go without writing. The one that loses may
// be the one that pressed first: a hold's rank is a Lamport stamp, so the
// winner is one that pressed before it heard the loser's hold, at most one
// latency (and a pose interval) after the loser; the loser hears the winner's
// hold one latency (and a pose interval) after that. So no view writes until
// HEAR_MS after it started, and two writes of one stop can't happen while
// 2 × (latency + pose interval) < HEAR_MS: a latency under 450 ms. A view
// that goes mid-motion takes its hold with it: the part is back where the doc
// last had it at rest, and nothing was written.
//
// createSlides(env) is the whole of that, against an env the extension (or a
// test's simulated network) provides; it reads and writes nothing else.

export const KEY = "joints.slide";
/** The stage's pose interval: how often a held pose goes out (STAGE.md, "Holding a pose"). */
export const POSE_MS = 50;
/** The most network latency (one way, ms) the joint promises to settle a contest within. */
export const MAX_LATENCY_MS = 450;
/**
 * How long after a view starts a motion before it may write where it landed
 * (ms): long enough to hear a winning peer's hold that was begun up to one
 * latency after its own (above): 2 × (latency + pose interval).
 */
export const HEAR_MS = 2 * (MAX_LATENCY_MS + POSE_MS);

const STOPS = ["closed", "open"];
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** The trait as it means: defaults filled, the axis made unit. null when it can't move (no axis, no travel, no speed). */
export function readSlide(trait) {
  if (!trait || typeof trait !== "object") return null;
  const a = Array.isArray(trait.axis) ? trait.axis.map((v) => num(v, 0)) : [0, 1, 0];
  const n = Math.hypot(a[0], a[1], a[2]);
  const closed = num(trait.stops?.closed, 0);
  const open = num(trait.stops?.open, 0);
  const speed = num(trait.speed, 1);
  if (!(n > 0) || closed === open || !(speed > 0)) return null;
  const wait = num(trait.wait, 0);
  return {
    axis: a.map((v) => v / n),
    stops: { closed, open },
    speed,
    wait: wait > 0 ? wait : 0,
    at: trait.at === "open" ? "open" : "closed",
    since: Number.isFinite(trait.since) ? trait.since : null,
  };
}

/** Does any part in this doc close itself (a wait)? Then the scene has a process: the closing. */
export function selfClosing(doc) {
  for (const o of Object.values(doc?.objects ?? {})) if (o && o.kind !== "group" && (readSlide(o.traits?.[KEY])?.wait ?? 0) > 0) return true;
  return false;
}

/** The other stop. */
export const otherStop = (stop) => (stop === "open" ? "closed" : "open");

/**
 * Where the part is at `stop`, given where it is now (at s.at). To the
 * micrometre, so a part opened and shut comes back exactly where it was.
 */
export function positionAt(s, position, stop) {
  const d = s.stops[stop] - s.stops[s.at];
  return [0, 1, 2].map((i) => Math.round((num(position?.[i], 0) + s.axis[i] * d) * 1e6) / 1e6);
}

/** How long it takes from one stop to the other (s). */
export const travelTime = (s) => Math.abs(s.stops.open - s.stops.closed) / s.speed;

const same = (a, b) => [0, 1, 2].every((i) => Math.abs(num(a?.[i], 0) - num(b?.[i], 0)) <= 1e-9);

/**
 * @typedef {object} SlideEnv
 * @property {() => number} now          ms, the wall clock (acts and liveness)
 * @property {() => number} t            s, the doc's world time as this view has it (api.clock.t)
 * @property {() => { objects: object }} doc     the scene doc as this view has it
 * @property {(fn: (d: object) => void) => void} change
 * @property {(id: string, transform: object) => boolean} hold   true when the hold stands (false: someone ahead of it holds the part)
 * @property {(id: string, o?: { landed?: boolean }) => void} release
 * @property {(id: string) => string | null} heldBy     a peer holding it ahead of this view
 */

/**
 * Every slide in a scene, as one view runs them.
 * @param {SlideEnv} env
 */
export function createSlides(env) {
  /** id → { from, to, fromPos, toPos, rotation, scale, duration (ms), started (ms), lands (ms), t0 (s, world) } */
  const moving = new Map();

  const objectOf = (id) => env.doc()?.objects?.[id] ?? null;
  const slideOf = (id) => {
    const o = objectOf(id);
    return o && o.kind !== "group" ? readSlide(o.traits?.[KEY]) : null;
  };

  /** The verb for a part: { label, disabled? } or null (not a slide). */
  function verb(id) {
    const s = slideOf(id);
    if (!s) return null;
    const m = moving.get(id);
    if (m) return { label: m.to === "open" ? "Opening" : "Closing", disabled: true };
    if (env.heldBy(id) != null) return { label: s.at === "open" ? "Close" : "Open", disabled: true, title: "Someone is moving it" };
    return { label: s.at === "open" ? "Close" : "Open" };
  }

  /** Start moving a part to `to` (default: the other stop). False when it can't: not a slide, moving, held, or there already. */
  function move(id, to = null) {
    const o = objectOf(id);
    const s = slideOf(id);
    if (!s || moving.has(id) || env.heldBy(id) != null) return false;
    const target = to ?? otherStop(s.at);
    if (!STOPS.includes(target) || target === s.at) return false;
    const fromPos = (o.transform?.position ?? [0, 0, 0]).map((v) => num(v, 0));
    const started = env.now();
    const duration = travelTime(s) * 1000;
    const m = {
      from: s.at,
      to: target,
      fromPos,
      toPos: positionAt(s, fromPos, target),
      rotation: [...(o.transform?.rotation ?? [0, 0, 0])],
      scale: o.transform?.scale ?? 1,
      duration,
      started,
      lands: started + Math.max(duration, HEAR_MS),
      t0: env.t(),
    };
    moving.set(id, m);
    if (hold(id, m)) return true;
    // someone here holds it ahead of a motion (a person carrying it): no motion
    abandon(id);
    return false;
  }

  /** Hold it where it is now, by the clock: true when the hold stands. */
  function hold(id, m) {
    const u = m.duration > 0 ? Math.max(0, Math.min(1, (env.now() - m.started) / m.duration)) : 1;
    return env.hold(id, { position: m.fromPos.map((v, i) => v + (m.toPos[i] - v) * u), rotation: m.rotation, scale: m.scale }) === true;
  }

  /** Let go of a motion without writing anything: the part is where the doc has it. */
  function abandon(id) {
    moving.delete(id);
    env.release(id);
  }

  /** Bring this view's motions up to now: hold each where the clock puts it, give way, or land. */
  function frame() {
    for (const [id, m] of [...moving]) {
      const o = objectOf(id);
      const s = slideOf(id);
      // gone, or someone else put it to rest, or a peer's hold is heard ahead of ours: theirs
      if (!o || !s || s.at !== m.from || !same(o.transform?.position, m.fromPos) || env.heldBy(id) != null) {
        abandon(id);
        continue;
      }
      // taken (a person carrying or dragging it, here or there, ranks ahead of a motion's hold): theirs, and nothing written
      if (!hold(id, m)) {
        abandon(id);
        continue;
      }
      if (env.now() < m.lands) continue;
      // there, and long enough for a contest to have been heard: the one write
      moving.delete(id);
      env.change((d) => {
        const od = d.objects?.[id];
        const tr = od?.traits?.[KEY];
        if (!od || !tr || (tr.at === "open" ? "open" : "closed") !== m.from) return;
        for (let i = 0; i < 3; i++) if (od.transform.position[i] !== m.toPos[i]) od.transform.position[i] = m.toPos[i];
        tr.at = m.to;
        // when it got there, in world time: no later than now, nor than its start and its travel
        // (the write may come later: HEAR_MS, a hidden tab's late timer, or the world paused meanwhile)
        if (m.to === "open") tr.since = Math.round(Math.min(env.t(), m.t0 + m.duration / 1000) * 1e6) / 1e6;
        else delete tr.since;
      });
      env.release(id, { landed: true });
    }
  }

  /**
   * The world's step (the computing view's alone): close every part open at
   * least its wait by world time `t`. A part someone is moving is left be (a
   * later step tries again). Returns how many it started closing.
   */
  function due(t) {
    const objects = env.doc()?.objects ?? {};
    let n = 0;
    for (const id of Object.keys(objects)) {
      const s = slideOf(id);
      if (!s || s.at !== "open" || !(s.wait > 0) || moving.has(id)) continue;
      if (t >= (s.since ?? -Infinity) + s.wait && move(id, "closed")) n++;
    }
    return n;
  }

  /** When to look again (ms, wall clock) to land what this view moves, or null: so a view that draws no frames still lands on time. */
  function review() {
    let next = null;
    for (const m of moving.values()) next = Math.min(next ?? Infinity, m.lands);
    return next;
  }

  /** Let go of everything (the extension stopping): the parts are where the doc has them. */
  function stop() {
    for (const id of [...moving.keys()]) abandon(id);
  }

  return { verb, move, frame, due, review, stop, moving: () => moving.size > 0, isMoving: (id) => moving.has(id) };
}
