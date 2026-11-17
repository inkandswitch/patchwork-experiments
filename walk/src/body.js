// The walk body (scene/TOOLS.md §4): first person on supports (DESIGN.md,
// "Standing on supports"). Each frame the walker (walker.js, pure) steps
// over the navmesh of the support it stands on, in that support's frame;
// the ground, the stage's own frame, is a support too, so a level's slab, a
// crate, a deck and a lift are walked by one rule. The world pose is derived
// each frame, the support's drawn frame times the walker's local feet, and
// never fed back: standing still on a moving deck leaves the local feet
// exactly as they were. What the supports are made of, and their meshes,
// are the input adapter's (supports.js).
//
// It starts at the place it's given (an object id: a spawn point, a stand
// spot, a support, anything), else at the eye (falling onto the floor under
// it) if a floor is within EYE_FLOOR_M, else at a spawn point, else where
// the walker respawns. Each support is baked when first needed; while a
// model it bakes hasn't loaded it waits (no camera move, no avatar). It reserves the walking keys, asks for pointer lock and reaches
// 2 m. Under another body (a seat, a station) it waits, its keys up, the
// camera let go and its avatar withdrawn; when that body goes, it is put at
// P1 of the eye lowered by BODY.eye along the up of the support it stood on.
//
// The stage holds the stack; this answers enter(place) with what a sitting
// is: { keys, input, eye(), leave() }.

import { BODY, easeEye, look, lookDir } from "./walk.js";
import * as walker from "./walker.js";
import { columnAt, isEmpty, pointOf } from "./navmesh.js";
import { apply, headingOf, invert, rotateM } from "./frames.js";
import { SPAWN, STAND, SUPPORT, createSupports, ownerOf, standAt } from "./supports.js";

export { SPAWN };
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

const ON = new Set(["walking", "airborne", "vaulting"]);

/** Yaw and pitch from a forward vector (lookDir's inverse). */
export function aimOf(dir) {
  const [x, y, z] = dir;
  return { yaw: Math.atan2(-x, -z), pitch: Math.atan2(y, Math.hypot(x, z)) };
}

/** How far below the eye there must be floor for a walk to start there (m). */
export const EYE_FLOOR_M = 10;

/**
 * The highest kept cell of any support straight under world point p, at most
 * `depth` below it (in that support's frame): its world point, or null. Pure.
 */
export function floorUnder(env, p, depth = EYE_FLOOR_M) {
  let best = null;
  for (const id of env.supports()) {
    const M = id == null ? null : env.frame(id);
    const mesh = env.mesh(id);
    if ((id != null && !M) || isEmpty(mesh)) continue;
    const L = M ? apply(invert(M), p) : p;
    const col = columnAt(mesh, L[0], L[2]);
    if (col < 0) continue;
    const c = mesh.cell;
    const u = (L[0] - mesh.origin[0]) / c - (col % mesh.nx);
    const v = (L[2] - mesh.origin[1]) / c - Math.floor(col / mesh.nx);
    for (let a = mesh.column[col]; a < mesh.column[col + 1]; a++) {
      const q = pointOf(mesh, a, u, v);
      if (q[1] > L[1] + 1e-9 || q[1] < L[1] - depth) continue;
      const w = M ? apply(M, q) : q;
      if (!best || w[1] > best[1]) best = w;
    }
  }
  return best;
}

/** The up of the support a state stands on (its frame's +Y), else the stage's. */
export const upOf = (env, st) => {
  const M = st && ON.has(st.mode) && st.on != null ? env.frame(st.on) : null;
  return M ? rotateM(M, [0, 1, 0]) : [0, 1, 0];
};

/** The heading of the frame a state's yaw is measured in: its support's, else the ground's (0). */
const headingIn = (env, st) => {
  const M = st && ON.has(st.mode) && st.on != null ? env.frame(st.on) : null;
  return M ? headingOf(M) : 0;
};

/**
 * Where a walk starts (pure over env and the scene; DESIGN.md, "The body",
 * enter), as a walker state, its yaw (in the state's frame) and a pitch:
 * - a support: its spawn link, else its first link, else its origin, on it;
 * - a stand spot: P1 at its `at`, facing its `facing`;
 * - any other object (a spawn point, a crate): P1 at its world point,
 *   facing the way it faces;
 * - no place: when a floor is under the eye within EYE_FLOOR_M of the feet
 *   (the eye lowered by BODY.eye), P1 at the feet, looking the way the eye
 *   looks (more than a step down, that is falling: you land on it), or at
 *   that floor if it is above the feet (an eye held low); else at `spawn`
 *   (an object id) as above; else the walker's respawn.
 * @returns {{ state: object, yaw: number, pitch: number }}
 */
export function startOf(env, { scene, worldOf, place = null, eye = null, spawn = null }) {
  const into = (state, yawW, pitch = 0) => ({ state, yaw: yawW - headingIn(env, state), pitch });
  const atObject = (id) => {
    if (scene?.objects?.[id]?.traits?.[SUPPORT]) {
      const links = env.mesh(id)?.links ?? [];
      const link = links.find((l) => l.kind === "spawn") ?? links[0];
      return { state: walker.spawnOn(env, id), yaw: link?.yaw ?? 0, pitch: 0 };
    }
    const m = worldOf(id);
    if (!m) return null;
    const stand = standAt(m, scene?.objects?.[id]?.traits?.[STAND]);
    return stand ? into(walker.placeAt(env, stand.at), stand.yaw) : into(walker.placeAt(env, [m[12], m[13], m[14]]), headingOf(m));
  };
  const fromPlace = place != null ? atObject(place) : null;
  if (fromPlace) return fromPlace;
  if (Array.isArray(eye?.position)) {
    const at = [eye.position[0], eye.position[1] - BODY.eye, eye.position[2]];
    const floor = floorUnder(env, eye.position, EYE_FLOOR_M + BODY.eye);
    if (floor) {
      const a = Array.isArray(eye.direction) ? aimOf(eye.direction) : { yaw: 0, pitch: 0 };
      return into(walker.placeAt(env, floor[1] > at[1] ? floor : at), a.yaw, Math.max(-1.2, Math.min(1.2, a.pitch)));
    }
  }
  const fromSpawn = spawn != null ? atObject(spawn) : null;
  return fromSpawn ?? into(walker.respawn(env), 0);
}

/**
 * What a walker's presence says (DESIGN.md, "Presence"): the support it's
 * on (null: the ground, as always while swimming or falling), the feet in
 * that support's frame, the yaw to its heading, the pitch, and whether it
 * swims. Full precision, so a peer draws it where it is to the bit.
 */
export function avatarOf(st, env, yaw, pitch) {
  const pose = walker.worldPose(st, env);
  if (!pose) return null;
  const on = ON.has(st.mode) ? st.on : null;
  return { on, feet: on != null ? walker.localFeet(st) : pose.feet, yaw, pitch, swimming: st.mode === "swimming" };
}

/**
 * The live walk sessions in this page (a ladder's Climb, walk.spawn's verb,
 * finds its walker here: DESIGN.md, Decision 30). A probe page that sets
 * globalThis.__WALK_LIVE__ to a Map is told each, by "session url", to read
 * and place (as __WALK_BAKES__ is told each bake).
 */
const LIVE = new Set();
/** The live walker of a session in a doc (its url), if any: { url, session, state(), env, climb(ladderId) }. */
export const walkerOf = (session, url) => [...LIVE].find((w) => w.session === session && w.url === url) ?? null;

/**
 * The walk body, on one extension's api, as the stage's `bodies` takes it.
 * @param {object} api
 * @param {ReturnType<typeof createSupports>} [supports]  the input adapter (one per extension)
 */
export function walkBody(api, supports = createSupports(api)) {
  const { env } = supports;
  const spawns = () => Object.entries(api.scene()?.objects ?? {}).filter(([, o]) => o?.traits?.[SPAWN]).map(([id]) => id);
  const camEye = () => {
    const c = api.camera.get?.();
    if (!Array.isArray(c?.position)) return null;
    const t = Array.isArray(c.target) ? c.target : null;
    const d = t ? [t[0] - c.position[0], t[1] - c.position[1], t[2] - c.position[2]] : null;
    const n = d ? Math.hypot(...d) : 0;
    return { position: [...c.position], direction: n > 1e-9 ? d.map((v) => v / n) : null };
  };

  let current = null; // the live session entered from this api, while it is

  return {
    id: "walk",
    label: "Walk",
    keys: WALK_KEYS,
    lock: true,
    reach: REACH,
    /** This viewer's walker here, as its presence says it (avatarOf), whether on top or waiting under another body; null when not walking here. */
    avatar: () => current?.avatar() ?? null,
    enter(place = null) {
      const all = spawns();
      const named = typeof place === "string" && api.scene()?.objects?.[place] ? place : null;
      const ask = { place: named, eye: named ? null : camEye(), spawn: all.length ? all[Math.floor(Math.random() * all.length)] : null };
      let st = null; // the walker's state; null until every support's first mesh has landed
      let yaw = 0; // in the state's frame
      let pitch = 0;
      let lag = 0; // the drawn eye's lag along the support's up, easing a STEP (the camera only)
      const keys = new Set();
      let releaseCamera = null;
      let stopLoop = null;
      let lastSent = 0;
      let gone = false;
      let warned = false;

      function start() {
        if (!supports.ready()) return false;
        const s = startOf(env, { scene: api.scene(), worldOf: (id) => api.worldOf(id), ...ask });
        st = s.state;
        yaw = s.yaw;
        pitch = s.pitch;
        lag = 0;
        return true;
      }
      const pose = () => (st ? walker.worldPose(st, env) : null);
      function placeCamera() {
        const p = pose();
        if (!p) return;
        let e = p.eye;
        if (lag && ON.has(st.mode)) {
          const up = st.on == null ? [0, 1, 0] : rotateM(env.frame(st.on), [0, 1, 0]);
          e = [e[0] + up[0] * lag, e[1] + up[1] * lag, e[2] + up[2] * lag];
        }
        const d = lookDir(yaw + p.heading, pitch);
        api.camera.set({ position: e, target: [e[0] + d[0], e[1] + d[1], e[2] + d[2]], fov: FOV, near: 0.05, far: 800 });
      }
      function publish(now = false) {
        const ms = api.clock.now();
        if (!st || (!now && ms - lastSent < SEND_MS)) return;
        const a = avatarOf(st, env, yaw, pitch);
        if (!a) return;
        lastSent = ms;
        api.presence.set("avatar", a);
      }
      const wanted = () => ({
        forward: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
        strafe: (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
        run: keys.has("ShiftLeft") || keys.has("ShiftRight"),
        jump: keys.has("Space"),
      });
      /** Invariant I after a step: thrown while asserting (tests, probes); else logged once and put right by P1. */
      function checked(prev) {
        const bad = walker.checkWalker(st, env, prev);
        if (!bad.length) return;
        if (walker.asserting()) throw new Error(`walker invariant: ${bad.join("; ")} (${st?.mode})`);
        if (!warned) console.warn("[walk] the walker broke its invariant; placed again", bad);
        warned = true;
        const p = walker.worldPose(prev, env) ?? walker.worldPose(st, env);
        st = walker.placeAt(env, p?.feet ?? [0, 0, 0]);
      }
      function tick(dt) {
        supports.frame();
        const fresh = !st;
        if (fresh && !start()) return;
        const h = Math.min(dt, 0.05);
        const before = st;
        const r = walker.step(st, wanted(), yaw, h, env);
        st = r.state;
        yaw = r.yaw;
        checked(before);
        const riding = (s) => s?.mode === "walking" || s?.mode === "airborne";
        lag = riding(before) && riding(st) && before.on === st.on ? easeEye(lag, r.lift, h) : 0;
        placeCamera();
        publish(fresh);
      }
      function turn(dx, dy) {
        const l = look(yaw, pitch, dx, dy);
        yaw = l.yaw;
        pitch = l.pitch;
      }
      function on() {
        if (gone || stopLoop) return;
        releaseCamera = api.camera.hold();
        api.presence.rate(20);
        stopLoop = api.loop(tick);
        if (st || start()) placeCamera(), publish(true);
      }
      function off() {
        keys.clear();
        stopLoop?.();
        stopLoop = null;
        releaseCamera?.();
        releaseCamera = null;
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

      const live = {
        url: api.url ?? null,
        get session() {
          return api.session ?? null;
        },
        state: () => st,
        env,
        avatar: () => (st ? avatarOf(st, env, yaw, pitch) : null),
        /** Put the walker at P1 of a point in this stage's frame, facing a yaw in it (a respawn; the probes). */
        place(p, yawW = 0, look = 0) {
          if (!supports.ready()) return false;
          st = walker.placeAt(env, p);
          yaw = yawW - headingIn(env, st);
          pitch = look;
          lag = 0;
          checked(null);
          placeCamera();
          publish(true);
          return true;
        },
        /** L1: from the water up a ladder (its object id) onto its owner. */
        climb(ladderId) {
          if (st?.mode !== "swimming") return false;
          const up = walker.climb(env, ownerOf(api.scene(), ladderId), ladderId);
          if (!up) return false;
          st = up.state;
          yaw = up.yaw;
          lag = 0;
          checked(null);
          placeCamera();
          publish(true);
          return true;
        },
      };
      LIVE.add(live);
      current = live;
      globalThis.__WALK_LIVE__?.set?.(`${api.session ?? ""} ${api.url ?? ""}`, live);
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
          // another body on top (a seat, a station): wait under it, withdrawn
          suspended() {
            off();
            api.presence.set("avatar", undefined);
          },
          // that body went: P1 of its eye lowered by BODY.eye along the up of
          // the support this walker stood on (beside a seat; at a stand spot,
          // whose body put its eye BODY.eye up that support's up)
          // looking at what its view looked at (a seat's: the table), from where you stand
          resumed() {
            const e = camEye();
            if (e && supports.ready()) {
              const up = upOf(env, st);
              st = walker.placeAt(env, e.position.map((v, i) => v - up[i] * BODY.eye));
              const t = api.camera.get?.()?.target;
              const eye = walker.worldPose(st, env)?.eye;
              const d = Array.isArray(t) && eye ? t.map((v, i) => v - eye[i]) : null;
              const a = d && Math.hypot(...d) > 0.05 ? aimOf(d) : Array.isArray(e.direction) ? aimOf(e.direction) : { yaw: 0, pitch: 0 };
              yaw = a.yaw - headingIn(env, st);
              pitch = Math.max(-1.2, Math.min(1.2, a.pitch));
              lag = 0;
            }
            on();
          },
        },
        eye() {
          const p = pose();
          if (p) return { position: p.eye, direction: lookDir(yaw + p.heading, pitch) };
          const c = camEye();
          return { position: c?.position ?? [0, BODY.eye, 0], direction: c?.direction ?? [0, 0, -1] };
        },
        leave() {
          if (gone) return;
          off();
          gone = true;
          LIVE.delete(live);
          if (current === live) current = null;
          if (globalThis.__WALK_LIVE__?.get?.(`${api.session ?? ""} ${api.url ?? ""}`) === live) globalThis.__WALK_LIVE__.delete(`${api.session ?? ""} ${api.url ?? ""}`);
          api.presence.set("avatar", undefined);
          api.presence.rate(0);
        },
        // for tests and probes
        get state() {
          const p = pose();
          return {
            mode: st?.mode ?? "waiting",
            on: st && ON.has(st.mode) ? st.on : null,
            feet: p ? p.feet : null,
            local: st ? walker.localFeet(st) : null,
            walker: st,
            yaw,
            pitch,
            onGround: st?.mode === "walking",
            walking: !!stopLoop,
          };
        },
      };
    },
  };
}
