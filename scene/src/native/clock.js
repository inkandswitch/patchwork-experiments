// scene.clock (native, every doc): world time for one doc, provided as
// "clock" (STAGE.md, "Native services").
//
// `doc.clock = { running, t, by? }` (absent: running from 0) is made with the
// doc and written field by field, so a pause and a checkpoint made at once
// both keep theirs. Time passes only while a view computes it, holding the
// doc's "clock" claim and stepping every process; the others follow. Nobody
// present, no time passes.
//
// - **Eligible**: its stage acts, it may write, its tab is visible, the doc is
//   settled, and it has a process. The first to find the claim free takes it.
// - **Computing**: t runs on with the stage's time, at most MAX_FRAME_S a
//   frame; processes step on a grid STEP_S apart, so two views stepping one
//   from the same t step it alike. Kept processes start at t (`start(t)`); it
//   lets go when hidden, paused or ineligible, or when the claim is lost.
// - **Checkpoints** (pause, letting go, every CHECKPOINT_MS): one change
//   writes `clock.t` and every `save(d)` (a process saves only what it holds),
//   stamping objects a save moved `saved: t`, so a process tells an editor's
//   move (transform changed, stamp not) from a late checkpoint (both changed).
// - **Followers**: the computer puts `{ t, at }` on the channel at CLOCK_HZ; a
//   follower runs toward it at the moment whose holds it draws (shownAt), so a
//   hull sits on the waves drawn under it; it slews, jumps only forward and
//   never passes the newest t heard. With no computer, t is `clock.t`.
// - **Paused**: t is the larger of this view's and `clock.t`, so every view
//   meets at the computer's checkpoint. Of two pauses at once the merge keeps
//   one t; if a follower's, the computer writes its own again.
// - **Replicated** processes (machine/HOST.md) step in every view that runs
//   them, at its own t, and make it eligible; only the computer saves them;
//   paused, they step only up to `clock.t`.
//
// t per view never decreases. createClock takes its env (claims, the channel,
// the doc, eligibility, time), so tests drive it with in-memory docs; the
// plugin at the end gives it that env from the public api.

import { tie } from "./claims.js";

/** The claim kind the computer holds, on the doc (id null). */
export const CLOCK = "clock";
/** Processes are stepped at every multiple of this much world time (s). */
export const STEP_S = 1 / 60;
/** The most world time one frame moves on (s): a longer stall is skipped. */
export const MAX_FRAME_S = 0.25;
/** How often the computer checkpoints while running (ms). */
export const CHECKPOINT_MS = 30_000;
/** How often the computer's t goes out in presence (Hz). */
export const CLOCK_HZ = 10;
/** With no held pose of the computer's to line up with, a follower runs this far behind what it last heard (ms). */
export const LAG_MS = 1500 / CLOCK_HZ;
/** No word from the computer for this long (ms): stalled ("waiting for Ben's machine"). */
export const STALL_MS = 1000;
/** A follower works an error off over about this long (s). */
export const SLEW_S = 1;
/** Further behind than this (s), a follower jumps forward instead of slewing. */
export const RESYNC_S = 0.5;
/** The channel key the computer's t goes out under (scene.clock's own). */
export const PRESENCE_KEY = "t";

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/** The doc's clock, as it means: running unless it says not, t ≥ 0, who last paused or resumed it. Pure. */
export function readClock(d) {
  const c = d?.clock;
  const ok = c && typeof c === "object";
  return {
    running: !(ok && c.running === false),
    t: ok && fin(c.t) && c.t > 0 ? c.t : 0,
    by: ok && typeof c.by === "string" ? c.by : null,
  };
}

/**
 * Why this view may or may not compute, but for having a process (the
 * clock's own to know): `{ ok, why }`, `why` null when it may, else what
 * stops it. Pure.
 * @param {{ acts: boolean, writable: boolean, visible: boolean, settled: boolean, complete: boolean }} v
 */
export function eligibility({ acts, writable, visible, settled, complete }) {
  const why = !acts ? "drawn" : !writable ? "view only" : !complete ? "missing a package" : !settled ? "starting" : !visible ? "hidden" : null;
  return { ok: why === null, why };
}

/**
 * The shown time one frame on: `dt` later, nudged toward `target` by at most
 * dt either way, so it never runs backwards and never more than twice as
 * fast. Pure.
 */
export function slew(shown, target, dt) {
  const free = shown + dt;
  const nudge = ((target - free) * dt) / SLEW_S;
  return free + Math.max(-dt, Math.min(dt, nudge));
}

/**
 * A follower's t one frame on: slewed toward `target`, or put there if it is
 * more than RESYNC_S ahead; never back, and never past `cap` (the newest t
 * heard from the computer) unless it was already there. Pure.
 * @param {number} shown @param {number} target @param {number} dt s @param {number | null} [cap]
 */
export function follow(shown, target, dt, cap = null) {
  let next = target - (shown + dt) > RESYNC_S ? target : slew(shown, target, dt);
  if (fin(cap) && next > cap) next = Math.max(shown, cap);
  return Math.max(shown, next);
}

/** The computer's t at `at` (its clock, ms), from a sample of it. Pure. */
export const sampleTime = (sample, at) => sample.t + (at - sample.at) / 1000;

/**
 * t as the doc keeps it: on a microsecond grid, rounded up (so writing it
 * never puts anyone's t back). Short decimals only: Automerge 3.3.0 stores
 * 0.9999999999999999 assigned inside a new map as 0 (measured), and a
 * world time that read back as 0 would undo the world. Pure.
 */
export function docTime(t) {
  const k = Math.ceil(t * 1e6);
  return k / 1e6 >= t ? k / 1e6 : (k + 1) / 1e6;
}

/**
 * Write these fields of the doc's clock into a draft, one by one (never the
 * map whole: a pause and a checkpoint at once both keep theirs). The map is
 * made with the doc; making it here is a fallback for a doc made without it,
 * which two views could do at once and lose one's write.
 */
function setClock(d, fields) {
  if (!d.clock || typeof d.clock !== "object") d.clock = { running: true, t: 0 };
  for (const [k, v] of Object.entries(fields)) if (d.clock[k] !== v) d.clock[k] = v;
}

/** The index of the last grid point at or before t. Pure. */
export const gridIndex = (t) => Math.floor(t / STEP_S + 1e-9);
/** The world time of grid point k. Pure. */
export const gridTime = (k) => k * STEP_S;

/** A doc transform as a comparable string. Pure. */
function transformKey(t) {
  const v = (a, n) => [0, 1, 2].map((i) => Math.round((Number(a?.[i]) || 0) * n) / n);
  return JSON.stringify([v(t?.position, 1e6), v(t?.rotation, 1e6), Math.round((Number(t?.scale) || 1) * 1e6) / 1e6]);
}

/**
 * The clock of one stage's doc.
 * @param {{
 *   doc: () => object,
 *   change: (fn: (d: object) => void) => void,
 *   claim: { take(onLost: () => void): (() => void) | null, holder(): { viewer: string | null, session: string, mine: boolean } | null },
 *   presence: { set(sample: { t: number, at: number } | undefined): void, sample(session: string): { t: number, at: number } | null, shownAt(session: string): number | null, rate(hz: number | null): void },
 *   eligible: () => { ok: boolean, why: string | null },   // eligibility(), but for having a process
 *   writable: () => boolean,
 *   viewer: string | null,
 *   now?: () => number,                   // the stage's time, ms (time.js: presence samples are stamped with it)
 *   onStatus?: (status: object) => void,  // what the chip shows changed
 * }} env
 */
export function createClock(env) {
  const now = env.now ?? (() => Date.now());
  const processes = new Set(); // { spec, replicated, k: last grid index stepped | null }
  let release = null; // our claim's release, while this view computes
  let t = readClock(env.doc()).t;
  let lastNow = null;
  let nextCheckpoint = Infinity;
  let wrote = null; // the t this view's last checkpoint wrote (only a computer checkpoints)
  let heard = null; // { session, t, at, heardAt }: the newest sample from the computer
  let followingSince = null; // when this view began following the current computer (ms)
  let status = null;
  let dead = false;

  const warn = (what, err) => console.warn(`[scene] a process's ${what} failed`, err);
  const call = (fn, what, ...args) => {
    if (typeof fn !== "function") return;
    try {
      fn(...args);
    } catch (err) {
      warn(what, err);
    }
  };
  const kept = () => [...processes].filter((p) => !p.replicated);
  /** May this view compute: eligible, and with a process. */
  const able = () => {
    const el = env.eligible();
    return !el.ok ? el : processes.size ? { ok: true, why: null } : { ok: false, why: "no process" };
  };

  // ─── checkpoints ──────────────────────────────────────────────────────────

  /** Write t and these processes' saves into a draft, stamping what they moved; with `fields`, those too (a pause). */
  function writeCheckpoint(d, list, fields = null) {
    t = docTime(t);
    wrote = t;
    if (fields) setClock(d, { ...fields, t });
    else if (!(fin(d.clock?.t) && d.clock.t >= t)) setClock(d, { t });
    if (!list.length) return;
    const objects = d.objects && typeof d.objects === "object" ? d.objects : null;
    const before = new Map();
    if (objects) for (const [id, o] of Object.entries(objects)) before.set(id, transformKey(o?.transform));
    for (const p of list) call(p.spec.save, "save", d);
    if (objects) for (const [id, o] of Object.entries(objects)) if (o && before.has(id) && before.get(id) !== transformKey(o.transform)) o.saved = t;
  }

  function checkpoint(list = [...processes], fields = null) {
    try {
      env.change((d) => writeCheckpoint(d, list, fields));
    } catch (err) {
      console.warn("[scene] couldn't write the clock's checkpoint", err);
    }
    nextCheckpoint = now() + CHECKPOINT_MS;
  }

  // ─── computing ────────────────────────────────────────────────────────────

  function startComputing() {
    const r = env.claim.take(lost);
    if (!r) return false;
    release = r;
    t = Math.max(t, readClock(env.doc()).t);
    heard = null;
    followingSince = null;
    nextCheckpoint = now() + CHECKPOINT_MS;
    env.presence.rate(CLOCK_HZ);
    for (const p of kept()) {
      p.k = gridIndex(t);
      call(p.spec.start, "start", t);
    }
    return true;
  }

  function stopKept() {
    for (const p of kept()) {
      p.k = null;
      call(p.spec.stop, "stop");
    }
    env.presence.set(undefined);
    env.presence.rate(null);
  }

  /** Someone else won the claim: they compute now, so nothing is saved. */
  function lost() {
    if (!release) return;
    release = null;
    stopKept();
  }

  /**
   * Stop computing: a checkpoint, the processes told, the claim let go. (Not
   * computing from the start: the checkpoint's change event may look again,
   * re-entrantly, and must find this view letting go.)
   */
  function letGo() {
    if (!release) return;
    const r = release;
    release = null;
    checkpoint();
    stopKept();
    r();
  }

  // ─── following ────────────────────────────────────────────────────────────

  function followFrame(holder, frameS) {
    const n = now();
    const sample = env.presence.sample(holder.session);
    if (heard?.session !== holder.session) {
      heard = null;
      followingSince = n;
    }
    if (sample && fin(sample.t) && fin(sample.at) && (!heard || heard.at !== sample.at)) heard = { session: holder.session, t: sample.t, at: sample.at, heardAt: n };
    if (!heard) return;
    const shownAt = env.presence.shownAt(holder.session);
    const target = fin(shownAt) ? sampleTime(heard, shownAt) : heard.t + (n - heard.heardAt - LAG_MS) / 1000;
    t = follow(t, target, frameS, heard.t);
  }

  // ─── the frame ────────────────────────────────────────────────────────────

  /** Grid steps for the processes this view steps, up to `to`. */
  function stepTo(list, to) {
    const k1 = gridIndex(to);
    for (const p of list) {
      if (p.k == null) continue;
      while (p.k < k1 && processes.has(p)) {
        p.k++;
        call(p.spec.step, "step", STEP_S, gridTime(p.k));
      }
    }
  }

  /** Who computes, eligibility, the claim: take it, keep it or let it go. No time passes here. */
  function transitions() {
    if (dead) return;
    const c = readClock(env.doc());
    const holder = env.claim.holder();
    if (release) {
      if (holder && !holder.mine) lost();
      else if (!c.running || !able().ok) letGo();
    } else if (c.running && !holder && able().ok) startComputing();
    if (!release && !(c.running && holder && !holder.mine)) {
      // paused, and the doc's t is short of what this view wrote computing (it paused as someone
      // else did, and the merge kept their t): ours again
      if (!c.running && wrote != null && wrote > c.t && env.writable()) checkpoint([]);
      t = Math.max(t, readClock(env.doc()).t);
    }
  }

  /**
   * One frame. `at` is the wall clock (ms); the world moves on by the time
   * since the last frame, at most MAX_FRAME_S.
   */
  function tick(at = now()) {
    if (dead) return;
    const frameS = lastNow == null ? 0 : Math.min(MAX_FRAME_S, Math.max(0, (at - lastNow) / 1000));
    lastNow = at;
    transitions();
    const c = readClock(env.doc());
    const replicated = [...processes].filter((p) => p.replicated);
    if (release) {
      t += frameS;
      stepTo([...processes], t);
      env.presence.set({ t, at: now() });
      if (now() >= nextCheckpoint) checkpoint();
    } else {
      const holder = env.claim.holder();
      if (c.running && holder && !holder.mine) followFrame(holder, frameS);
      else {
        heard = null;
        followingSince = null;
      }
      stepTo(replicated, c.running ? t : Math.min(t, c.t));
    }
    publish();
  }

  function publish() {
    const c = readClock(env.doc());
    const holder = env.claim.holder();
    const el = able();
    const following = c.running && holder && !holder.mine;
    const stalled = !!following && (heard ? now() - heard.heardAt > STALL_MS : followingSince != null && now() - followingSince > STALL_MS);
    // nothing to show in a doc with no process anyone here knows of
    if (!(processes.size > 0 || !!holder || !c.running)) {
      if (status !== null) env.onStatus?.((status = null));
      return;
    }
    const next = {
      running: c.running,
      by: c.by,
      computer: holder ? { viewer: holder.viewer, session: holder.session, mine: holder.mine } : null,
      stalled,
      able: el.ok,
      why: el.why,
    };
    if (status && JSON.stringify(status) === JSON.stringify(next)) return;
    status = Object.freeze(next);
    env.onStatus?.(status);
  }

  // ─── the api ──────────────────────────────────────────────────────────────

  function pause() {
    if (dead || !env.writable()) return;
    const c = readClock(env.doc());
    if (!c.running) return;
    t = docTime(Math.max(t, c.t));
    const fields = { running: false, t, by: env.viewer ?? null };
    if (release) {
      // the computer pauses with its checkpoint, in one change, and lets go
      const r = release;
      release = null;
      checkpoint([...processes], fields);
      stopKept();
      r();
    } else
      try {
        env.change((d) => setClock(d, fields));
      } catch (err) {
        console.warn("[scene] couldn't pause the clock", err);
      }
    publish();
  }

  function resume() {
    if (dead || !env.writable()) return;
    const c = readClock(env.doc());
    if (c.running) return;
    t = docTime(Math.max(t, c.t));
    try {
      env.change((d) => setClock(d, { running: true, t, by: env.viewer ?? null }));
    } catch (err) {
      console.warn("[scene] couldn't resume the clock", err);
    }
    transitions();
    publish();
  }

  /**
   * Register a process: `{ start?(t), step(dt, t), save?(d), stop?(), replicated? }`.
   * A kept process is stepped by the computer alone, between start and stop;
   * a replicated one by every view that has it, from now on. Returns its
   * removal: a kept one being computed is saved first.
   */
  function process(spec) {
    if (dead || !spec || typeof spec !== "object") return () => {};
    const p = { spec, replicated: spec.replicated === true, k: null };
    processes.add(p);
    if (p.replicated || release) {
      p.k = gridIndex(t);
      call(spec.start, "start", t);
    }
    transitions();
    publish();
    return () => {
      if (!processes.has(p)) return;
      if (release && !p.replicated) {
        checkpoint([p]);
        call(spec.stop, "stop");
      } else if (p.replicated) call(spec.stop, "stop");
      processes.delete(p);
      if (!dead) {
        transitions();
        publish();
      }
    };
  }

  /** This view's t: the computer's own; a follower's, following; else clock.t. */
  function readT() {
    if (!release && !dead) {
      const c = readClock(env.doc());
      const holder = env.claim.holder();
      if (!(c.running && holder && !holder.mine)) t = Math.max(t, c.t);
    }
    return t;
  }

  return {
    t: readT,
    running: () => readClock(env.doc()).running,
    pause,
    resume,
    process,
    /** a frame: the stage calls it every frame while anything moves (`live`) */
    tick,
    /** something changed (the doc, who's here, visibility): take, keep or let go, without a frame */
    check() {
      transitions();
      publish();
    },
    /** is a frame loop wanted: this view has a process, or someone computes */
    live: () => !dead && (processes.size > 0 || !!env.claim.holder()),
    computing: () => !!release,
    status: () => status,
    /** stop computing now (the page going away): checkpoint and let go */
    letGo,
    dispose() {
      if (dead) return;
      letGo();
      dead = true;
      processes.clear();
    },
  };
}

// ─── the plugin ─────────────────────────────────────────────────────────────

function create(api) {
  const ch = api.channel;
  const claims = api.use("claims");
  const poses = api.use("poses");
  const watchers = new Set();
  let away = false; // let go on pagehide, until pageshow
  const clock = createClock({
    doc: api.doc,
    change: (fn) => api.change(fn),
    claim: {
      take: (onLost) => (away ? null : (claims?.claim(null, CLOCK, { onLost }) ?? null)),
      holder: () => claims?.claimedBy(null, CLOCK) ?? null,
    },
    presence: {
      set: (sample) => ch.set(PRESENCE_KEY, sample),
      sample: (s) => ch.peers()[s]?.keys?.[api.id]?.[PRESENCE_KEY] ?? null,
      shownAt: (s) => poses?.shownAt(s) ?? null,
      rate: (hz) => ch.rate(hz),
    },
    eligible: () => {
      const s = api.settled();
      return eligibility({ acts: !!ch.session, writable: api.writable(), visible: api.page.visible(), settled: s.ready, complete: !s.missing.length });
    },
    writable: api.writable,
    viewer: ch.viewer,
    now: api.now,
    onStatus: () => [...watchers].forEach((fn) => fn()),
  });
  // frames while anything moves (this view has a process, or someone computes), ahead of every other loop
  let frames = null;
  function check() {
    clock.check();
    if (clock.live() && !frames) frames = api.loop((_dt, now) => clock.tick(now), { first: true });
    else if (!clock.live() && frames) frames = void frames();
  }
  ch.watch(check);
  api.page.on("visible", check);
  api.page.on("hide", () => (clock.letGo(), (away = true)));
  api.page.on("show", () => ((away = false), check()));

  return {
    provides: {
      clock: (caller) =>
        Object.freeze({
          t: () => clock.t(),
          running: () => clock.running(),
          /** who computes: { viewer, session, mine }, or null (nobody: no time passes) */
          computer: () => claims?.claimedBy(null, CLOCK) ?? null,
          /** what a chip shows (null: nothing to show), and fn() whenever it changes → off */
          status: () => clock.status(),
          watch: (fn) => (watchers.add(fn), tie(caller.signal, () => watchers.delete(fn))),
          pause: () => clock.pause(),
          resume: () => clock.resume(),
          process(spec) {
            // (a pin has no channel, and no processes)
            if (!ch.session || caller.signal.aborted) return () => {};
            const remove = clock.process(spec);
            check();
            return tie(caller.signal, () => (remove(), check()));
          },
        }),
    },
    update: check,
    dispose: () => clock.dispose(),
  };
}

export default { create };
