// Sailing her a while on flat water, as a helmsman would: shared by
// physics.test.js and physics.slow.test.js.
export const DEG = Math.PI / 180;
export const calm = {
  heightAt: () => 0,
  normalAt: () => [0, 1, 0],
  velocityAt: () => [0, 0, 0],
};

/** A steady wind of `speed` m/s from `from` degrees (as sailors say it). */
export function steady(speed, from = 0) {
  const a = from * DEG;
  return { at: () => [-Math.sin(a) * speed, Math.cos(a) * speed] };
}

export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** A helmsman holding a compass course: steer toward it, easing off as the bow swings. */
export const helmsman = (course) => (d, s) => clamp(2 * wrap(course - d.heading) + 4 * s.spin[1], -1, 1);

/**
 * Sail for `seconds`. `helm` (diagnostics, state) → rudder steers when
 * given; `each(d, s, t)` sees every frame.
 */
export function sail(ship, { state, env, controls = {}, seconds, helm, dt = 1 / 30, each }) {
  let s = state;
  const c = { ...controls };
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (helm || each) {
      const d = ship.read(s, c, env);
      if (each) each(d, s, i * dt);
      if (helm) c.rudder = helm(d, s);
    }
    s = ship.step(s, c, env, dt);
  }
  return s;
}

/**
 * Steady speed (mean over the last `over` seconds) holding a true wind
 * angle, wind from the north; `off` is how far the helmsman strayed from
 * the course meanwhile.
 */
export function sailAt(ship, { twa, wind = 8, sheet, seconds = 50, over = 10 }) {
  const course = twa * DEG;
  let sum = 0, n = 0, off = 0;
  sail(ship, {
    state: ship.rest({ yaw: -course }),
    env: { water: calm, wind: steady(wind, 0) },
    controls: { sail: 1, sheet },
    seconds,
    helm: helmsman(course),
    each(d, s, t) {
      if (t >= seconds - over) {
        sum += d.speed;
        n++;
        off = Math.max(off, Math.abs(wrap(d.heading - course)));
      }
    },
  });
  return { speed: sum / n, off };
}

export const speedAt = (ship, opts) => sailAt(ship, opts).speed;

/** The best speed over a few sheet settings, refined around the best: the boat, not the trim. */
export function bestSpeed(ship, opts) {
  const tried = new Map();
  const at = (sheet) => {
    const k = Math.round(sheet * 100);
    if (!tried.has(k)) tried.set(k, sailAt(ship, { ...opts, sheet: k / 100 }));
    return tried.get(k).speed;
  };
  let best = 0;
  for (const sheet of [0, 0.25, 0.5, 0.75, 1]) if (at(sheet) > at(best)) best = sheet;
  for (const d of [-0.12, 0.12]) {
    const s = clamp(best + d, 0, 1);
    if (at(s) > at(best)) best = s;
  }
  return { speed: at(best), sheet: best, off: tried.get(Math.round(best * 100)).off };
}
