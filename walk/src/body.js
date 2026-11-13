// The walk body (scene/TOOLS.md §4): first person on whatever the scene is
// made of. Its floor is whatever the ray hits (walk.js asks two questions by
// ray: how far down, how far ahead), so a level's slab, a crate, a door's
// sill or a moving deck are all floor; nothing here knows which.
//
// It starts at the place it is given (a spawn point's object id), else at
// the eye (the camera, as it was: walking from where you were looking), else
// at a spawn point, else above the middle of the scene. It rides what it
// stands on: when the object under the feet moves (a deck, a lift), the
// feet and the facing move with it, so the floor never slides out from
// under them. It reserves the walking keys, asks for pointer lock, and
// reaches 2 m. While another body is on top of it (a seat) it waits, its
// keys up and the camera let go; when that body goes, it walks on from the
// eye (where the seat was).
//
// The stage holds the stack; this answers enter(place) with what a sitting
// is: { keys, input, eye(), leave() }.

import { BODY, look, lookDir, step } from "./walk.js";

/** The trait a spawn point carries. */
export const SPAWN = "walk.spawn";
/** How far a walker reaches (m): arm's length and a step. */
export const REACH = 2;
const FOV = 75;
const SEND_MS = 50; // presence, 20 Hz

/** The keys the walk body takes: walking, running and jumping. Every other key goes on to the key map. */
export const WALK_KEYS = Object.freeze([
  { code: "KeyW", label: "Forward" },
  { code: "KeyA", label: "Left" },
  { code: "KeyS", label: "Back" },
  { code: "KeyD", label: "Right" },
  { code: "ArrowUp", label: "Forward" },
  { code: "ArrowDown", label: "Back" },
  { code: "ArrowLeft", label: "Left" },
  { code: "ArrowRight", label: "Right" },
  { code: "ShiftLeft", label: "Run" },
  { code: "ShiftRight", label: "Run" },
  { code: "Space", label: "Jump" },
]);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const apply = (m, p) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
const headingOf = (m) => Math.atan2(m[8], m[10]);

/** The inverse of a rigid (rotation · uniform scale + translation) column-major matrix. */
export function invertRigid(m) {
  const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] || 1;
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1].map((v, i) => (i % 4 === 3 || i >= 12 ? v : v / s2));
  for (let k = 0; k < 3; k++) r[12 + k] = -(r[k] * m[12] + r[4 + k] * m[13] + r[8 + k] * m[14]);
  return r;
}

/**
 * Carried by what you stand on (pure): where the feet and the facing go when
 * the floor's object moved from `was` to `now` (its world matrices), the feet
 * kept where they were on it and turned with its heading. Same matrices: no
 * move.
 * @returns {{ feet: number[], yaw: number }}
 */
export function carried(feet, yaw, was, now) {
  if (!was || !now) return { feet, yaw };
  const onIt = apply(invertRigid(was), feet);
  return { feet: apply(now, onIt), yaw: yaw + (headingOf(now) - headingOf(was)) };
}

/** Yaw and pitch from a forward vector (lookDir's inverse). */
export function aimOf(dir) {
  const [x, y, z] = dir;
  return { yaw: Math.atan2(-x, -z), pitch: Math.atan2(y, Math.hypot(x, z)) };
}

/**
 * Where a walk starts (pure): a spawn point given as the place (its world
 * matrix), else the eye (the camera: its position and forward), else any
 * spawn, else above the middle of the scene's box.
 * @param {{ place?: number[] | null, eye?: { position, direction } | null, spawn?: number[] | null, box?: { min, max } | null }} o
 * @returns {{ feet: number[], yaw: number, pitch: number }}
 */
export function startOf({ place = null, eye = null, spawn = null, box = null }) {
  const at = (m) => ({ feet: [m[12], m[13] + 0.1, m[14]], yaw: headingOf(m), pitch: 0 });
  if (place) return at(place);
  if (Array.isArray(eye?.position)) {
    const a = Array.isArray(eye.direction) ? aimOf(eye.direction) : { yaw: 0, pitch: 0 };
    return { feet: [eye.position[0], eye.position[1] - BODY.eye, eye.position[2]], yaw: a.yaw, pitch: Math.max(-1.2, Math.min(1.2, a.pitch)) };
  }
  if (spawn) return at(spawn);
  const c = box ? [(box.min[0] + box.max[0]) / 2, box.max[1] + 1, (box.min[2] + box.max[2]) / 2] : [0, 2, 0];
  return { feet: c, yaw: 0, pitch: 0 };
}

/**
 * The walk body, on one extension's api, as the stage's `bodies` takes it.
 * @param {object} api
 */
export function walkBody(api) {
  const spawns = () => Object.entries(api.scene()?.objects ?? {}).filter(([, o]) => o?.traits?.[SPAWN]).map(([id]) => id);
  const camEye = () => {
    const c = api.camera.get?.();
    if (!Array.isArray(c?.position)) return null;
    const t = Array.isArray(c.target) ? c.target : null;
    const d = t ? sub(t, c.position) : null;
    const n = d ? Math.hypot(...d) : 0;
    return { position: [...c.position], direction: n > 1e-9 ? d.map((v) => v / n) : null };
  };

  return {
    id: "walk",
    label: "Walk",
    keys: WALK_KEYS,
    lock: true,
    reach: REACH,
    enter(place = null) {
      const spot = typeof place === "string" && api.scene()?.objects?.[place] ? api.worldOf(place) : null;
      const all = spawns();
      const any = all.length ? api.worldOf(all[Math.floor(Math.random() * all.length)]) : null;
      const body = { vel: [0, 0, 0], onGround: false, ...startOf({ place: spot, eye: spot ? null : camEye(), spawn: any, box: api.sceneBox?.() }) };
      const keys = new Set();
      let releaseCamera = null;
      let stopLoop = null;
      let lastSent = 0;
      let under = null; // { id, m }: what the feet stood on last frame, as drawn then
      let gone = false;

      const world = {
        down: (from, max) => api.raycast(from, [0, -1, 0], { far: max })?.distance ?? null,
        ahead: (from, dir, max) => {
          const h = api.raycast(from, dir, { far: max });
          return h ? { distance: h.distance, normal: h.normal } : null;
        },
      };
      const eye = () => [body.feet[0], body.feet[1] + BODY.eye, body.feet[2]];
      function placeCamera() {
        const e = eye();
        const d = lookDir(body.yaw, body.pitch);
        api.camera.set({ position: e, target: [e[0] + d[0], e[1] + d[1], e[2] + d[2]], fov: FOV, near: 0.05, far: 800 });
      }
      function publish(now = false) {
        const ms = api.clock.now();
        if (!now && ms - lastSent < SEND_MS) return;
        lastSent = ms;
        api.presence.set("avatar", { feet: body.feet.map((v) => +v.toFixed(3)), yaw: +body.yaw.toFixed(3), pitch: +body.pitch.toFixed(3) });
      }
      // ride what's underfoot: the object the down ray meets, as it moves
      function ride() {
        const h = api.raycast([body.feet[0], body.feet[1] + 0.1, body.feet[2]], [0, -1, 0], { far: 0.4 });
        const id = h?.id ?? null;
        const m = id != null ? api.worldOf(id) : null;
        if (under && m && under.id === id) {
          const c = carried(body.feet, body.yaw, under.m, m);
          body.feet = c.feet;
          body.yaw = c.yaw;
        }
        under = m ? { id, m: [...m] } : null;
      }
      function tick(dt) {
        ride();
        const input = {
          forward: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
          strafe: (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
          run: keys.has("ShiftLeft") || keys.has("ShiftRight"),
          jump: keys.has("Space"),
        };
        Object.assign(body, step(body, input, body.yaw, Math.min(dt, 0.05), world));
        if (body.feet[1] < BODY.fallLimit) Object.assign(body, { vel: [0, 0, 0], onGround: false, ...startOf({ spawn: any, box: api.sceneBox?.() }) });
        placeCamera();
        publish();
      }
      function turn(dx, dy) {
        const l = look(body.yaw, body.pitch, dx, dy);
        body.yaw = l.yaw;
        body.pitch = l.pitch;
      }
      function on() {
        if (gone || stopLoop) return;
        releaseCamera = api.camera.hold();
        api.presence.rate(20);
        placeCamera();
        stopLoop = api.loop(tick);
        publish(true);
      }
      function off() {
        keys.clear();
        stopLoop?.();
        stopLoop = null;
        releaseCamera?.();
        releaseCamera = null;
        under = null;
      }

      // a press that nothing before the body took: without the lock a drag
      // looks around, and a tap goes on as a click (down the chain again:
      // walking has no default press of its own); under it, nothing
      const lookSession = (ev) => {
        let last = [ev.clientX ?? 0, ev.clientY ?? 0];
        return {
          move(e) {
            const at = [e.clientX ?? last[0], e.clientY ?? last[1]];
            turn(at[0] - last[0], at[1] - last[1]);
            last = at;
          },
          end() {},
          cancel() {},
          tap: () => false,
          cursor: "grabbing",
        };
      };

      on();
      return {
        keys: WALK_KEYS,
        input: {
          move(ev) {
            if (ev.locked) turn(ev.dx ?? 0, ev.dy ?? 0);
          },
          press: (ev) => (ev.button === 0 && !ev.locked ? lookSession(ev) : null),
          wheel: () => true,
          key(ev) {
            keys.add(ev.code);
            return true;
          },
          keyup(ev) {
            keys.delete(ev.code);
            return true;
          },
          cursor: (ev) => (ev.locked ? "none" : "grab"),
          // another body on top (a seat): wait under it
          suspended: () => off(),
          // that body went: walk on from the eye, where it left the view
          resumed() {
            const e = camEye();
            if (e) Object.assign(body, { vel: [0, 0, 0], onGround: false, ...startOf({ eye: e }) });
            on();
          },
        },
        eye: () => ({ position: eye(), direction: lookDir(body.yaw, body.pitch) }),
        leave() {
          if (gone) return;
          off();
          gone = true;
          api.presence.set("avatar", undefined);
          api.presence.rate(0);
        },
        // for tests and probes
        get state() {
          return { feet: [...body.feet], yaw: body.yaw, pitch: body.pitch, onGround: body.onGround, walking: !!stopLoop };
        },
      };
    },
  };
}
