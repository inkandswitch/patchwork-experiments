// Showing another view's held pose smoothly (STAGE.md, "Holding a pose").
//
// A held pose reaches peers as a stream of samples, one per send interval
// (20 Hz by default, faster when an extension raises the presence rate).
// Snapping to each one makes anything that moves steadily (a ship simulated
// on one peer, a card carried across the table) stutter at that rate. So a
// peer plays the stream back a little late, by PLAYOUT_INTERVALS send
// intervals, and draws the pose between the two samples either side of that
// moment: position and scale lerped, rotation slerped. If the next sample is
// late it carries on along the last step for up to one interval, then holds.
//
// Samples are stamped with the sender's clock (`at`), so jitter on the wire
// doesn't become jitter on screen. The receiver maps its own clock to the
// sender's with an offset that follows the fastest recent delivery
// (clockOffset).
//
// Everything here is pure: plain transforms ({ position, rotation (Euler
// XYZ, radians), scale }, as the doc stores them) and numbers.

import { normalizeTransform } from "../transform.js";

/** How far behind the newest sample a peer plays, in the sender's send intervals. */
export const PLAYOUT_INTERVALS = 1.5;
/** Never play further behind than this (ms), whatever the interval. */
export const MAX_DELAY_MS = 200;
/** How far past the last sample to carry on, in send intervals, before holding. */
export const AHEAD_INTERVALS = 1;
/** How many samples a stream keeps. */
export const MAX_SAMPLES = 8;
/** A gap longer than this many intervals was a pause, not a late packet (gapless below). */
export const GAP_INTERVALS = 4;
/** How fast the clock offset may drift up per sample (ms), after a slow path or a clock that runs slow. */
export const OFFSET_CREEP_MS = 1;

/** How late a stream sent every `every` ms is played (ms). */
export const playoutDelay = (every) => Math.min(MAX_DELAY_MS, PLAYOUT_INTERVALS * every);
/** How far past its last sample a stream sent every `every` ms is carried on (ms). */
export const aheadOf = (every) => Math.min(MAX_DELAY_MS, AHEAD_INTERVALS * every);

/**
 * The receiver's clock minus the sender's, from one more sample: the lowest
 * seen (the fastest delivery, least delayed), allowed to creep up a little
 * per sample so a path that got slower, or a sender's clock that runs slow,
 * is followed rather than played ever further ahead of.
 * @param {number | null} prev  the offset so far, or null for the first sample
 * @param {number} sentAt  the sender's clock when it sent
 * @param {number} heardAt  ours when it arrived
 */
export function clockOffset(prev, sentAt, heardAt) {
  const d = heardAt - sentAt;
  if (prev == null || !Number.isFinite(prev) || d <= prev) return d;
  return Math.min(d, prev + OFFSET_CREEP_MS);
}

/**
 * A stream's samples with one more: in order of `at`, at most MAX_SAMPLES.
 * After a pause (a still carry sends only a keepalive), the last pose is
 * taken to have held until one interval before the new one, so the new
 * motion plays at its own speed rather than smeared over the pause. A
 * sample no later than the last replaces it.
 * @param {{ at: number, transform: object }[]} samples
 * @param {{ at: number, transform: object }} sample
 * @param {number} every  the sender's send interval (ms)
 * @returns {{ at: number, transform: object }[]} a new array
 */
export function addSample(samples, sample, every) {
  const out = samples ? samples.slice() : [];
  const last = out.at(-1);
  if (last && sample.at <= last.at) out.pop();
  else if (last && sample.at - last.at > GAP_INTERVALS * every) out.push({ at: sample.at - every, transform: last.transform });
  out.push(sample);
  return out.length > MAX_SAMPLES ? out.slice(out.length - MAX_SAMPLES) : out;
}

// ─── rotations ──────────────────────────────────────────────────────────────

/** Euler XYZ (radians) → a unit quaternion [x, y, z, w] (three's Quaternion.setFromEuler, "XYZ"). */
export function quatFromEuler(r) {
  const c1 = Math.cos(r[0] / 2), s1 = Math.sin(r[0] / 2);
  const c2 = Math.cos(r[1] / 2), s2 = Math.sin(r[1] / 2);
  const c3 = Math.cos(r[2] / 2), s3 = Math.sin(r[2] / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}

/** A unit quaternion → Euler XYZ (radians) (three's Euler.setFromQuaternion, "XYZ"). */
export function eulerFromQuat(q) {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - w * z), m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x), m33 = 1 - 2 * (x * x + y * y);
  const ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ry, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), ry, 0];
}

/**
 * Spherical interpolation along the shorter arc. `t` outside 0..1 carries on
 * along the same arc (what extrapolating a turn needs).
 */
export function slerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let ka, kb;
  if (dot > 0.9995) {
    // nearly the same: a straight line is as good, and doesn't divide by ~0
    ka = 1 - t;
    kb = t;
  } else {
    const theta = Math.acos(dot);
    const s = Math.sin(theta);
    ka = Math.sin((1 - t) * theta) / s;
    kb = Math.sin(t * theta) / s;
  }
  const q = [ka * a[0] + kb * bx, ka * a[1] + kb * by, ka * a[2] + kb * bz, ka * a[3] + kb * bw];
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * The pose `t` of the way from a to b (0 is a, 1 is b; past 1 carries on).
 * @returns {{ position: number[], rotation: number[], scale: number }}
 */
export function blendTransform(a, b, t) {
  const x = normalizeTransform(a);
  const y = normalizeTransform(b);
  if (t === 0) return x;
  if (t === 1) return y;
  const same = x.rotation.every((v, i) => v === y.rotation[i]);
  const scale = lerp(x.scale, y.scale, t);
  return {
    position: x.position.map((v, i) => lerp(v, y.position[i], t)),
    rotation: same ? x.rotation : eulerFromQuat(slerp(quatFromEuler(x.rotation), quatFromEuler(y.rotation), t)),
    // a scale can't be carried through zero
    scale: scale > 0 ? scale : x.scale,
  };
}

/**
 * The pose a stream shows at time `t` (on the samples' clock): between the
 * samples either side of it; the first before them; past the last, carried
 * on along the last step for up to `ahead` ms, then held.
 * @param {{ at: number, transform: object }[]} samples  in order of `at`
 * @param {number} t
 * @param {{ ahead?: number }} [o]
 * @returns {{ transform: object, settled: boolean } | null} settled: nothing
 *   will change from here until another sample comes
 */
export function poseAt(samples, t, { ahead = 0 } = {}) {
  const n = samples?.length ?? 0;
  if (!n) return null;
  const last = samples[n - 1];
  if (n === 1) return { transform: last.transform, settled: true };
  if (t <= samples[0].at) return { transform: samples[0].transform, settled: false };
  if (t < last.at) {
    let i = n - 2;
    while (i > 0 && samples[i].at > t) i--;
    const a = samples[i];
    const b = samples[i + 1];
    return { transform: blendTransform(a.transform, b.transform, (t - a.at) / (b.at - a.at)), settled: false };
  }
  const prev = samples[n - 2];
  const span = last.at - prev.at;
  const over = Math.min(t - last.at, Math.max(0, ahead));
  const settled = t - last.at >= ahead;
  if (!(span > 0) || over <= 0) return { transform: last.transform, settled };
  return { transform: blendTransform(prev.transform, last.transform, 1 + over / span), settled };
}
