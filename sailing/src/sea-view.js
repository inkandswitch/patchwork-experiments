// The sea in play (DESIGN.md, "Play"): its clock, the drawn ocean and the
// sky. ctx.sea is what the other parts read: the ocean and wind they float
// and sail on, and the time to ask them at.
//
// The clock is the one thing about the sea that's shared. The view that
// simulates runs its own and publishes it in presence ({ t, at }: the sea's
// time at its Date.now); every other view follows it at the moment the
// stage is showing that view's held poses (api.presence.shownAt), so the
// hull sits on the waves drawn under it. A follower's clock runs a little
// fast or slow until it agrees, and jumps when it's far off (it was hidden,
// or the simulator stalled).
//
// drawSea is the part both activities draw (edit.js shares it, and the
// following clock): the ocean built from the scene's sailing.sea trait, its
// surface following the camera, and the atmosphere the surface is lit to
// match. A scene with no sea trait gets neither.

import { createOcean } from "./ocean.js";
import { createWind } from "./wind.js";
import { createOceanSurface } from "./ocean-material.js";
import { PLAY_ID, SEA } from "./traits.js";

/** A bright maritime day: blue overhead, a pale horizon the far sea hazes into, the sun high to one side. */
export const ATMOSPHERE = Object.freeze({
  sky: Object.freeze({ top: "#2f6db5", horizon: "#cfe2ee", bottom: "#a9c6d8" }),
  fog: Object.freeze({ color: "#cfe2ee", near: 300, far: 9000 }),
  sun: Object.freeze({ direction: Object.freeze([0.55, 0.7, -0.45]), color: "#fff3df", intensity: 2.2, shadows: true }),
  exposure: 1,
});

// ─── the sea from the doc (pure) ────────────────────────────────────────────

const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);

/** The sea trait with its defaults filled in (index.js describes them): { wind: { speed, from }, seed, scale }. */
export function seaParams(trait) {
  const t = trait ?? {};
  return {
    wind: { speed: Math.max(0, num(t.wind?.speed, 7)), from: num(t.wind?.from, 45) },
    seed: num(t.seed, 1),
    scale: Math.max(0, num(t.scale, 1)),
  };
}

// ─── the shared clock (pure) ────────────────────────────────────────────────

/** The longest a frame may move the sea on (s): a longer stall is skipped. */
export const MAX_STEP_S = 1;
/** A follower's clock works an error off over about this long (s). */
export const SLEW_S = 1;
/** Further off than this (s), a follower's clock jumps instead of slewing: back from a hidden tab, or the simulator stalled. */
export const RESYNC_S = 0.5;

/**
 * The shown clock one frame on: `dt` later, nudged toward `target` by at
 * most dt either way, so it never runs backwards and never runs more than
 * twice as fast.
 */
export function slew(shown, target, dt) {
  const free = shown + dt;
  const nudge = ((target - free) * dt) / SLEW_S;
  return free + Math.max(-dt, Math.min(dt, nudge));
}

/** A follower's clock one frame on: slewed toward `target`, or put there if it's more than RESYNC_S off. */
export function follow(shown, target, dt) {
  return Math.abs(target - (shown + dt)) > RESYNC_S ? target : slew(shown, target, dt);
}

/**
 * The sea time a follower shows: the simulator's `t` at its `at`, run on to
 * `shownAt`, the moment (on the simulator's clock) whose poses this view is
 * drawing now.
 * @param {{ t: number, at: number }} sample
 * @param {number} shownAt  ms, the simulator's clock
 */
export const seaTime = (sample, shownAt) => sample.t + (shownAt - sample.at) / 1000;

/** A sea clock: its own time (target null), or one following a target. */
export function createClock() {
  let shown = 0;
  let caught = false; // has it ever followed: the first target is taken at once
  return {
    now: () => shown,
    /** @param {number} dt s  @param {number | null} target the followed time, or null to run free */
    tick(dt, target) {
      if (target == null || !Number.isFinite(target)) shown += dt;
      else if (!caught) shown = target;
      else shown = follow(shown, target, dt);
      if (target != null) caught = true;
      return shown;
    },
  };
}

// ─── the clock on a stage ───────────────────────────────────────────────────

/**
 * The time a simulator's published clock says it is, as this view should
 * show it, or null. Its presence is read under the play extension's id
 * (edit.js runs as another).
 */
export function followedTime(api, session) {
  if (!session) return null;
  const p = api.presence.get()?.[session];
  const sample = p?.keys?.[PLAY_ID]?.clock;
  if (!sample || !Number.isFinite(sample.t) || !Number.isFinite(sample.at)) return null;
  // no pose heard from it yet (no ship): nothing to line up with, so as heard
  const shown = api.presence.shownAt?.(session) ?? sample.at + (Date.now() - (p.at ?? Date.now()));
  return seaTime(sample, shown);
}

/**
 * The sea clock a view keeps: tick(dt, now, simulator) once a frame, with
 * the simulating session when it's someone else (else it runs its own). It
 * keeps the wall's time, the loop's `now`, not the stage's frame step
 * (clamped to 0.1 s): followers run a simulator's clock on at wall rate,
 * and the stage plays its poses back by the wall, so a slow frame rate
 * mustn't slow it. Only a stall over MAX_STEP_S (a hidden tab) is skipped.
 */
export function seaClock(api) {
  const clock = createClock();
  let last = null;
  return {
    now: clock.now,
    tick(dt, now, simulator) {
      const step = Number.isFinite(now) && last != null ? Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000)) : dt;
      if (Number.isFinite(now)) last = now;
      return clock.tick(step, followedTime(api, simulator));
    },
  };
}

// ─── drawing (stage side) ───────────────────────────────────────────────────

/**
 * The sea as both activities draw it: the ocean and wind from the doc's
 * sailing.sea trait (rebuilt when it changes), and its surface in a world
 * group; nothing, and no atmosphere, while the scene has no sea trait. The
 * owner runs the loop: draw(t) once a frame.
 * @param {any} api
 */
export function drawSea(api) {
  let key = null;
  let ocean = null;
  let wind = null;
  let surface = null;
  const group = api.world();

  function build(trait) {
    if (!trait) {
      if (key === null) return;
      key = null;
      ocean = wind = null;
      surface?.dispose();
      surface = null;
      api.invalidate();
      return;
    }
    const p = seaParams(trait);
    const k = JSON.stringify(p);
    if (k === key) return;
    key = k;
    ocean = createOcean(p);
    wind = createWind({ ...p.wind, seed: p.seed });
    if (surface) surface.setSea(ocean);
    else {
      surface = createOceanSurface(api.THREE, ocean, { sun: ATMOSPHERE.sun, sky: ATMOSPHERE.sky });
      group.add(surface.object);
    }
    api.invalidate();
  }
  build(api.doc()?.traits?.[SEA]);

  return {
    get ocean() {
      return ocean;
    },
    get wind() {
      return wind;
    },
    atmosphere: () => (ocean ? ATMOSPHERE : null),
    update(scene) {
      build(scene?.traits?.[SEA]);
    },
    /** The surface at time t, around the camera. */
    draw(t) {
      surface?.update(t, api.camera.object.position, ATMOSPHERE.sun, ATMOSPHERE.sky);
    },
    dispose() {
      surface?.dispose();
      surface = null;
    },
  };
}

/**
 * ctx.sea: the sea in play. play.js ticks it first each frame, saying
 * whether this view keeps the clock and, if not, whose clock to follow.
 * @param {any} api
 */
export function createSeaView(api) {
  const sea = drawSea(api);
  const clock = seaClock(api);
  let published = false;

  return {
    get ocean() {
      return sea.ocean;
    },
    get wind() {
      return sea.wind;
    },
    clock: () => clock.now(),
    atmosphere: sea.atmosphere,
    update(scene) {
      sea.update(scene);
    },
    /**
     * One frame: the clock on, published if it's ours, the surface drawn.
     * @param {number} dt  @param {number} now the frame clock (ms)
     * @param {boolean} own  this view simulates  @param {string | null} simulator  who does, if someone else
     */
    tick(dt, now, own, simulator) {
      const t = clock.tick(dt, now, own ? null : simulator);
      if (own) {
        api.presence.set("clock", { t, at: Date.now() });
        published = true;
      } else if (published) {
        api.presence.set("clock", undefined);
        published = false;
      }
      sea.draw(t);
      return t;
    },
    dispose() {
      sea.dispose();
    },
  };
}
