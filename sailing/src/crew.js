// People aboard (DESIGN.md, "Play" and "Walking: a navmesh in the ship's
// frame"): coming aboard, walking a moving deck, going over the side and
// swimming, standing at a station, and everyone else drawn where they stand.
//
// Where you can stand is baked once per hull (navmesh.js) from what's drawn:
// her GLB and the parts attached under her, in her body frame. Walking is
// walker.js over that mesh: its state is a cell and a place in it, so it
// can't name a place off the mesh, and your world pose is derived from her
// drawn matrix each frame and never fed back. This file is the stage side:
// it gathers her triangles from api.content (the input adapter), keeps her
// mesh baked as her parts change, steps the walker, and puts the camera at
// the eye. Off the deck you swim, in the world, at the ocean's height.
//
// State lives where the contract says:
// - presence: `crew` = { on, position, yaw, pitch, station } at ~18 Hz, the
//   position local to `on` (world when it's null);
// - this closure: the walker's state, the keys held, the station you're at.
//
// The frame maths and the avatars' easing are pure and exported (tested in
// crew.test.js); createCrew is the stage-side part.

import { DECK, SWIM, easeEye, look, lookDir } from "./walk.js";
import { bake, sweptAbout } from "./navmesh.js";
import * as walker from "./walker.js";
import { apply, headingOf, invert, matrixOf, multiply, onHeading, rotateM, unrotateM } from "./frames.js";
import { HELM, HOOK, QUARTER, SAIL, isUnder, partsOf, sailingThing, shipOf } from "./traits.js";
import { bodyBoxOf, bodyOf, frameMatrix, placeIn, shipFrame } from "./body.js";

export { behind, ladderTop } from "./walker.js";

const FOV = 60; // vertical: about 90° across at 16:9; wider puts more heaving sea in the corners of your eye
const SEND_MS = 55; // presence, about 18 Hz
const EASE = 12; // how fast an avatar closes on its latest record (1/s)
const STILL = Object.freeze({ forward: 0, strafe: 0 });
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);

const NAME_CSS = `.scene-stage .label.sail-name:where(:not(.about-embed *), .about-embed .scene-tool *) {
  color: #f6f3ea;
  background: color-mix(in oklch, #0b0d10 62%, transparent);
  padding: 1px 7px;
  border-radius: 6px;
  text-shadow: 0 1px 1px rgb(0 0 0 / 0.4);
}`;

// ─── frames (pure) ──────────────────────────────────────────────────────────

/** A body in one frame (`from`, a matrix) moved into another (`to`), the same in the world: stepping across onto another deck. */
export function reframe(body, from, to) {
  const back = invert(to);
  return {
    feet: apply(back, apply(from, body.feet)),
    vel: unrotateM(to, rotateM(from, body.vel)),
    yaw: body.yaw + headingOf(from) - headingOf(to),
  };
}

/** The shorter way round from angle a to b. */
const turnTo = (a, b) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * An avatar closing on a peer's latest record: eased in the record's frame,
 * snapped when the frame changes (stepping aboard, going over the side).
 * @param {{ on, pos, yaw, pitch } | null} prev
 * @param {{ on, position, yaw, pitch }} rec
 */
export function ease(prev, rec, dt, rate = EASE) {
  const target = { on: rec.on ?? null, pos: [...rec.position], yaw: Number(rec.yaw) || 0, pitch: Number(rec.pitch) || 0 };
  if (!prev?.pos || prev.on !== target.on) return target;
  const k = 1 - Math.exp(-rate * dt);
  return {
    on: target.on,
    pos: prev.pos.map((v, i) => v + (target.pos[i] - v) * k),
    yaw: prev.yaw + (turnTo(prev.yaw, target.yaw) - prev.yaw) * k,
    pitch: prev.pitch + (target.pitch - prev.pitch) * k,
  };
}

/** Where an avatar stands in the world: in its ship's frame, or the world's. null when its ship isn't here. */
export function placeOf(a, worldOf) {
  if (a.on == null) return { position: a.pos, yaw: a.yaw };
  const m = worldOf(a.on);
  return m ? { position: apply(m, a.pos), yaw: a.yaw + headingOf(m) } : null;
}

/**
 * Does a click come aboard? On the sea or the sky (nothing hit), a ship or
 * anything of hers (a sailing trait or tag: the mast, the wheel), or
 * anything not aboard a ship at all (the islet, its lighthouse, a buoy):
 * yes. On something aboard her that isn't hers (a card or the table in her
 * cockpit, which the hand takes a click on), no: it goes on down the chain.
 * `seated`: the viewer's view is riding something (a seat at a table aboard
 * her, the stage's camera.riding()); then only the sea or the sky does (the
 * hull round the table is where stray clicks land), or the button, or Enter.
 * @param {{ objects }} scene  @param {{ id?: string } | null} hit  @param {{ seated?: boolean }} [o]
 */
export function boardsOn(scene, hit, { seated = false } = {}) {
  const id = hit?.id;
  if (id == null) return true;
  if (seated) return false;
  const o = scene?.objects?.[id];
  if (!o) return true;
  const ship = shipOf(scene, id);
  return ship == null || ship === id || sailingThing(o);
}

/** Is this viewer's view riding something other than the ship's own follow (a seat at a table aboard her)? */
export const seatedView = (api) => {
  const r = api?.camera?.riding?.();
  return !!r && !r.fallback;
};

/** A stable hue for a person. */
export function hueOf(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

const okRecord = (r) => !!r && Array.isArray(r.position) && r.position.length === 3 && r.position.every(Number.isFinite);
const r3 = (v) => Math.round(v * 1000) / 1000;

// ─── what she's made of, for the bake (the input adapter) ──────────────────

/**
 * The objects whose geometry is baked into a ship's navmesh: herself, and
 * everything attached under her that's hers (a sailing trait or tag) or
 * locked furniture (a card table), but not what moves: the sail station's
 * subtree (the boom and sail swing) and the anchor (it hangs, and lies on
 * the bottom), nor unlocked loose pieces (cards, dice), nor anything hidden.
 * The wheel (the helm) turns about its axle, so it's `swept`.
 * @returns {Array<{ id: string, swept: boolean }>}  in id order
 */
export function bakedObjects(scene, ship) {
  const out = [];
  const moving = (id) => {
    for (let at = id, n = 0; at != null && at !== ship && n < 64; at = scene.parents?.get?.(at) ?? null, n++) {
      const t = scene.objects?.[at]?.traits;
      if (t?.[SAIL] || t?.[HOOK]) return true;
    }
    return false;
  };
  for (const id of [...(scene?.ids ?? Object.keys(scene?.objects ?? {}))].sort()) {
    const o = scene.objects?.[id];
    if (!o || o.kind === "group" || o.visible === false) continue;
    if (id !== ship) {
      if (!isUnder(scene, id, ship) || moving(id)) continue;
      if (!sailingThing(o) && !o.locked) continue;
    }
    out.push({ id, swept: !!o.traits?.[HELM] });
  }
  return out;
}

/** A node's own matrix (three.js position, quaternion, scale; any scale). */
function nodeMatrix(node) {
  const p = node.position ?? {};
  const q = node.quaternion ?? null;
  const s = node.scale ?? {};
  const [x, y, z, w] = q ? [q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 1] : [0, 0, 0, 1];
  const [sx, sy, sz] = [s.x ?? 1, s.y ?? 1, s.z ?? 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    p.x ?? 0, p.y ?? 0, p.z ?? 0, 1,
  ];
}

const ID = matrixOf(null);

/**
 * The triangles of a content root (api.content(id).root, a three.js node:
 * read, never changed), in the object's own frame, at the GLB's rest pose
 * (each node's own transform, from the root down). Hidden nodes are left out.
 */
export function trianglesOf(root) {
  const out = [];
  const visit = (node, parent, depth) => {
    if (!node || depth > 64 || node.visible === false) return;
    const m = multiply(parent, nodeMatrix(node));
    const pos = node.isMesh ? node.geometry?.attributes?.position : null;
    if (pos) {
      const get = (i) => (typeof pos.getX === "function" ? [pos.getX(i), pos.getY(i), pos.getZ(i)] : [pos.array[i * (pos.itemSize ?? 3)], pos.array[i * (pos.itemSize ?? 3) + 1], pos.array[i * (pos.itemSize ?? 3) + 2]]);
      const index = node.geometry.index;
      const count = index ? (index.count ?? index.array.length) : (pos.count ?? pos.array.length / (pos.itemSize ?? 3));
      const at = index ? (k) => (typeof index.getX === "function" ? index.getX(k) : index.array[k]) : (k) => k;
      for (let k = 0; k + 2 < count; k += 3) for (let j = 0; j < 3; j++) out.push(...apply(m, get(at(k + j))));
    }
    const kids = Array.isArray(node.children) ? node.children : [];
    for (const ch of kids) visit(ch, m, depth + 1);
  };
  visit(root, ID, 0);
  return out;
}

/** body ← hull object: her frame undone, at her scale (metres, as bodyOf is). */
function bodyFromHull(api, ship) {
  const k = Number(api.scene?.()?.objects?.[ship]?.transform?.scale) || 1;
  const S = matrixOf({ scale: k });
  return multiply(S, invert(frameMatrix(shipFrame(api, ship))));
}

const fnv = (str) => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return ((h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)).padStart(14, "0");
};
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * The bake key for a ship: a hash of her frame and, for each baked object,
 * its id, file, transform relative to her, its traits' keys, and whether its
 * model has loaded. Null while her own model hasn't (nothing to stand on yet).
 */
export function navKey(api, ship) {
  const scene = api.scene?.();
  if (!scene?.objects?.[ship] || !api.content?.(ship)?.loaded) return null;
  const parts = bakedObjects(scene, ship).map(({ id, swept }) => {
    const o = scene.objects[id];
    const m = id === ship ? ID : (placeIn(scene, id, ship) ?? ID);
    return [id, o.sourceUrl ?? null, o.renderUrl ?? null, m.map(r6), !!api.content?.(id)?.loaded, swept, Object.keys(o.traits ?? {}).sort()];
  });
  return fnv(JSON.stringify([shipFrame(api, ship), scene.objects[ship]?.transform?.scale ?? 1, parts]));
}

/**
 * What a ship's bake is made from: her triangles in her body frame, and the
 * seeds (her spawn, a stand spot aft of each station, her ladder). Null while
 * her own model hasn't loaded.
 * @returns {{ key: string, triangles: number[], seeds: object[] } | null}
 */
export function navInput(api, ship) {
  const key = navKey(api, ship);
  if (!key) return null;
  const scene = api.scene();
  const toBody = bodyFromHull(api, ship);
  const triangles = [];
  for (const { id, swept } of bakedObjects(scene, ship)) {
    const root = api.content?.(id)?.root;
    if (!root) continue;
    let tris = trianglesOf(root);
    if (swept) tris = sweptAbout(tris, 2);
    const m = multiply(toBody, id === ship ? ID : (placeIn(scene, id, ship) ?? ID));
    for (let k = 0; k < tris.length; k += 3) triangles.push(...apply(m, [tris[k], tris[k + 1], tris[k + 2]]));
  }
  const at = (id) => {
    const m = placeIn(scene, id, ship);
    return m ? apply(toBody, [m[12], m[13], m[14]]) : null;
  };
  const parts = partsOf(scene, ship);
  const stations = ["helm", "sail", "anchor", "mainsheet"].filter((k) => parts[k]).map((k) => ({ id: parts[k], at: at(parts[k]), by: walker.standOff(k) })).filter((s) => s.at);
  const ladder = parts.ladder && at(parts.ladder) ? { id: parts.ladder, at: at(parts.ladder) } : null;
  const seeds = walker.seedsOf({ stations, helm: parts.helm, ladder, box: bodyBoxOf(api, ship) });
  return { key, triangles, seeds };
}

/** The boom, where it's drawn this frame, as a capsule in her body frame: a moving obstacle that only blocks. */
function boomOf(api, ship, M) {
  const rig = partsOf(api.scene(), ship).sail;
  const w = rig ? api.worldOf?.(rig) : null;
  if (!w || !M) return [];
  const local = multiply(invert(M), w);
  const len = Math.max(0, Number(api.content?.(rig)?.box?.max?.[2]) || 0);
  if (len <= 0) return [];
  return [{ a: apply(local, [0, 0, 0]), b: apply(local, [0, 0, len]), r: 0.07 }];
}

/** Baked meshes by key, shared by every crew in the page (a mesh is never changed once baked). */
const MESHES = new Map();

// ─── the crew ───────────────────────────────────────────────────────────────

/**
 * @param {object} api  the stage's
 * @param {{ sea, sim }} ctx
 */
export function createCrew(api, ctx) {
  const THREE = api.THREE;
  api.style(NAME_CSS);

  let playing = false;
  let paused = false; // the lock was lost (Esc): waiting for a click to take it back
  // Pointer lock can be refused (a sandboxed frame, a headless browser). Then
  // play goes on without it: drag to look.
  let free = false;
  let disarm = null;
  let releaseCamera = null;
  let orbitFov = null; // the camera's field of view before coming aboard
  let station = null; // { id, handlers, disarm }
  let lastSent = 0;
  let eye = null; // world, while playing
  let eyeLag = 0; // the drawn eye's lag behind the true eye along her up, easing a STEP (easeEye): the camera only
  let w = null; // the walker's state (walker.js); null until you're put anywhere
  const person = { yaw: 0, pitch: 0 }; // yaw: to her bow aboard, the world's in the water
  let warned = false;
  const keys = new Set();

  const clock = () => ctx.sea?.clock?.() ?? 0;
  /** A ship's body frame as drawn (bow −Z), which a body aboard lives in; null when she's gone. */
  const frameOfShip = (id) => bodyOf(api, id);

  // ─── her navmesh, baked as her parts change ─────────────────────────────

  // per ship: { key, mesh, input, want, timer }. The first mesh is baked when
  // first asked for; a later change of key rebakes off the frame loop (a
  // timeout), the old mesh in use until the new one lands. Meshes are cached
  // by key.
  const navs = new Map();
  let version = 1; // bumped when the doc or what's shown changes: keys to look at again
  function bakeFor(ship) {
    const input = navInput(api, ship);
    if (!input) return null;
    const hit = MESHES.get(input.key);
    if (hit) return hit;
    const made = { mesh: bake(input, DECK), input };
    MESHES.set(input.key, made);
    while (MESHES.size > 6) MESHES.delete(MESHES.keys().next().value);
    return made;
  }
  function meshOf(ship) {
    if (ship == null) return null;
    let n = navs.get(ship);
    if (!n) navs.set(ship, (n = { key: null, mesh: null, input: null, want: null, timer: null, seen: -1 }));
    if (n.seen !== version || !n.mesh) {
      n.want = navKey(api, ship);
      n.seen = version;
    }
    if (!n.want) return n.mesh;
    if (!n.mesh) {
      const made = bakeFor(ship);
      if (made) Object.assign(n, { key: made.input.key, mesh: made.mesh, input: made.input });
    } else if (n.want !== n.key && !n.timer) {
      n.timer = setTimeout(() => {
        n.timer = null;
        const made = bakeFor(ship);
        if (made) Object.assign(n, { key: made.input.key, mesh: made.mesh, input: made.input });
      }, 0);
    }
    return n.mesh;
  }

  // the walker's world: her mesh and her drawn frame, the sea, the boom (where it's drawn: once a frame)
  let frameNo = 0;
  let boomsAt = -1;
  const booms = new Map();
  const env = {
    mesh: meshOf,
    frame: frameOfShip,
    ships: () => ctx.sim?.ships?.() ?? [],
    surface: (x, z) => ctx.sea?.ocean?.heightAt?.(x, z, clock()) ?? 0,
    blockers(ship) {
      if (boomsAt !== frameNo) (booms.clear(), (boomsAt = frameNo));
      if (!booms.has(ship)) booms.set(ship, boomOf(api, ship, frameOfShip(ship)));
      return booms.get(ship);
    },
  };

  // ─── putting the body somewhere ─────────────────────────────────────────

  const localOf = (m, id) => {
    const at = api.worldOf(id);
    return at ? apply(invert(m), [at[12], at[13], at[14]]) : null;
  };

  /** In the water at a world point, facing a world yaw. */
  function inWater(at, yawW = person.yaw) {
    w = walker.swimmingAt(env, [at[0], at[2]]);
    person.yaw = yawW;
  }

  /** On the first ship's deck, by the wheel (or as soon as her mesh is baked); in the water if there's no ship. */
  function spawn() {
    const ship = ctx.sim?.ships?.()[0] ?? null;
    if (ship && frameOfShip(ship)) {
      // beside the wheel, a little to one side or the other, so two who come aboard together aren't one
      const side = [0, -0.45, 0.45][hueOf(api.session ?? "") % 3];
      w = walker.spawnOn(env, ship, [side, 0, 0]);
      if (w.mode === "boarding") {
        w.offset = [side, 0, 0];
        w.from = api.camera.get()?.position ?? null; // where you swim if she goes, or her model never comes
      }
      person.yaw = 0;
      person.pitch = -0.1;
      return;
    }
    inWater(api.camera.get()?.position ?? [0, 0, 0], 0);
  }

  /** Where the feet are, as me() and presence say it: local to the ship you're on, else the world. */
  function feetNow() {
    if (!w) return [0, 0, 0];
    if (w.mode === "swimming") return [w.p[0], env.surface(w.p[0], w.p[1]) - SWIM.depth, w.p[1]];
    return walker.localFeet(w) ?? (w.at ? [...w.at] : [0, 0, 0]);
  }
  const onShip = () => (!w || w.mode === "swimming" ? null : (w.ship ?? null));

  // ─── each frame ─────────────────────────────────────────────────────────

  function wanted() {
    if (paused || station) return STILL;
    return {
      forward: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
      strafe: (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
      run: keys.has("ShiftLeft") || keys.has("ShiftRight"),
      jump: keys.has("Space"),
    };
  }

  /** Invariant I after a step: thrown while walker.asserting() (tests, the probe pages); else logged once and put right by projection. */
  function checked() {
    const bad = walker.checkWalker(w, env);
    if (!bad.length) return;
    if (walker.asserting()) throw new Error(`walker invariant: ${bad.join("; ")} (${w?.mode})`);
    if (!warned) console.warn("[sailing] the walker left its mesh; put back", bad);
    warned = true;
    const feet = feetNow();
    w = onShip() ? walker.place(env, w.ship, feet) : walker.swimmingAt(env, [feet[0], feet[2]]);
  }

  function walk(dt) {
    // (boarding: B1 lands her spawn beside the wheel at w.offset, or G1 / the wait running out swims)
    const before = w;
    const r = walker.step(w, wanted(), person.yaw, dt, env);
    w = r.state;
    person.yaw = r.yaw;
    checked();
    const moving = (s) => s?.mode === "walking" || s?.mode === "airborne";
    eyeLag = moving(before) && moving(w) && before.ship === w.ship ? easeEye(eyeLag, r.lift, dt) : 0;
    const pose = walker.worldPose(w, env);
    if (pose) {
      eye = pose.eye;
      if (eyeLag) {
        const up = rotateM(env.frame(w.ship), [0, 1, 0]);
        eye = [eye[0] + up[0] * eyeLag, eye[1] + up[1] * eyeLag, eye[2] + up[2] * eyeLag];
      }
      const d = lookDir(person.yaw + pose.heading, person.pitch);
      api.camera.set({ position: eye, target: [eye[0] + d[0], eye[1] + d[1], eye[2] + d[2]], fov: FOV, near: 0.05, far: 5000 });
    }
    if (station) {
      try {
        station.handlers.tick?.(dt);
      } catch (err) {
        console.warn("[sailing] a station's tick failed", err);
      }
    }
    publish();
  }

  function publish(now = false) {
    const ms = performance.now();
    if (!playing || !w || w.mode === "boarding" || (!now && ms - lastSent < SEND_MS)) return;
    lastSent = ms;
    api.presence.set("crew", { on: onShip(), position: feetNow().map(r3), yaw: r3(person.yaw), pitch: r3(person.pitch), station: station?.id ?? null });
  }

  // Before coming aboard the camera is the orbit's, and it goes where the
  // ship goes (sideways only: no bobbing), so a sailing ship stays in view.
  // A camera nobody has moved (not even from a saved view) starts off the
  // ship's quarter. On a stage that has rides (camera.ride) it's a fallback
  // ride: anything else riding (a seat at a table aboard her) wins over it,
  // and nothing follows twice; else, as before, moved here each frame.
  let followAt = null;
  let riding = null; // { ship, off }
  let framed = false; // the quarter view for a camera nobody moved: once, on first sight of her (stop() puts you off her quarter itself)
  let dragging = false;
  // (the release in the capture phase: the stage stops a claimed one at the port)
  api.listen(api.port, "pointerdown", () => (dragging = true), { capture: true });
  for (const type of ["pointerup", "pointercancel"]) api.listen(globalThis, type, () => (dragging = false), { capture: true });
  function follow() {
    const ship = ctx.sim?.ships?.()[0] ?? null;
    const m = ship ? frameOfShip(ship) : null;
    if (riding && riding.ship !== (m ? ship : null)) {
      riding.off?.();
      riding = null;
    }
    if (!m) return void (followAt = null);
    const at = [m[12], m[14]];
    if (!followAt) {
      followAt = at;
      if (!framed && !api.camera.touched?.()) api.camera.set({ position: onHeading(m, QUARTER.position), target: onHeading(m, QUARTER.target) });
      framed = true;
      if (!riding && typeof api.camera.ride === "function") riding = { ship, off: api.camera.ride(ship, { turn: false, rise: false, fallback: true }) };
      return;
    }
    if (riding) return;
    const dx = at[0] - followAt[0];
    const dz = at[1] - followAt[1];
    if (dragging || Math.hypot(dx, dz) < 1e-3) return;
    followAt = at;
    const cam = api.camera.get();
    if (!cam) return;
    api.camera.set({ position: [cam.position[0] + dx, cam.position[1], cam.position[2] + dz], target: [cam.target[0] + dx, cam.target[1], cam.target[2] + dz] });
  }

  // ─── input ──────────────────────────────────────────────────────────────

  function turn(dx, dy) {
    const l = look(person.yaw, person.pitch, dx, dy);
    person.yaw = l.yaw;
    person.pitch = l.pitch;
  }

  // a bare session: a press while playing is nothing, never an orbit
  const bare = { move() {}, end() {}, cancel() {}, tap: () => true };
  // without the lock: a drag looks around
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
      tap: () => true,
      cursor: "grabbing",
    };
  };

  // looking and pressing, the same whether walking or at a station
  const looking = {
    move(ev) {
      if (ev.locked && !paused) turn(ev.dx ?? 0, ev.dy ?? 0);
    },
    press(ev) {
      if (paused) {
        Promise.resolve(api.relock()).catch(() => {});
        return bare;
      }
      if (ev.button === 0 && !ev.locked) return lookSession(ev);
      return bare;
    },
    click: () => true,
    menu: () => true,
    wheel: () => true,
    cursor: (ev) => (ev.locked ? "none" : "grab"),
  };

  const walking = {
    ...looking,
    // only the walking keys: F, Q, E and the rest go on to the use prompt
    key(ev) {
      if (ev.key === "Escape") {
        stop();
        return true;
      }
      if (!MOVE_KEYS.has(ev.code)) return false;
      keys.add(ev.code);
      return true;
    },
    keyup(ev) {
      keys.delete(ev.code);
      return true;
    },
    lockLost({ refused = false } = {}) {
      keys.clear();
      if (refused) {
        if (playing) (free = true), (paused = false);
        return;
      }
      leave(); // Esc at a station steps away from it too
      paused = true;
    },
    disarmed() {
      disarm = null;
      if (playing) stop();
    },
  };

  // the lock was granted, or came back (a click after Esc)
  api.listen(document, "pointerlockchange", () => {
    if (playing && document.pointerLockElement) (paused = false), (free = false);
  });

  function start() {
    if (playing) return;
    playing = true;
    paused = false;
    free = false;
    if (!w || (onShip() && !frameOfShip(w.ship))) spawn();
    orbitFov = api.camera.get()?.fov ?? null; // given back on leaving: first person sees wider
    releaseCamera = api.camera.hold();
    // immersive: the editor's decorations stand aside while aboard
    disarm = api.arm(walking, { lock: true, replace: true, immersive: true });
    publish(true);
  }

  function stop({ keepCamera = false } = {}) {
    if (!playing) return;
    leave();
    playing = false;
    paused = false;
    free = false;
    keys.clear();
    const d = disarm;
    disarm = null;
    d?.();
    releaseCamera?.();
    releaseCamera = null;
    eye = null;
    // back off the quarter of the ship you were on (unless a seat's view takes over: firstPerson.leave)
    const m = onShip() ? frameOfShip(w.ship) : null;
    const fov = orbitFov != null ? { fov: orbitFov } : {};
    if (keepCamera) {
      // the view that asked takes the camera
    } else if (m) api.camera.set({ position: onHeading(m, QUARTER.position), target: onHeading(m, QUARTER.target), ...fov });
    else api.camera.set(fov);
    followAt = null;
    api.presence.set("crew", undefined);
  }

  // ─── stations ───────────────────────────────────────────────────────────

  /**
   * Stand at a station: an arm over walking that hears keys first. You're
   * put just aft of it, facing forward; the mouse still turns your head.
   * @param {string} id
   * @param {{ key?(ev): boolean, keyup?(ev): boolean, tick?(dt), left?(), hint?(): string }} handlers
   * @returns {() => void} leave
   */
  function take(id, handlers = {}) {
    if (!playing) start();
    leave();
    // S1: at the station's stand spot (its link in her mesh), facing forward
    const ship = shipOf(api.scene(), id);
    const m = ship ? frameOfShip(ship) : null;
    const at = m ? localOf(m, id) : null;
    const kind = ship ? Object.entries(partsOf(api.scene(), ship)).find(([, v]) => v === id)?.[0] : null;
    const r = ship ? walker.takeStation(env, ship, id, at ? walker.behind(at, walker.standOff(kind)) : null) : null;
    if (r) {
      w = r.state;
      person.yaw = r.yaw;
      person.pitch = -0.2;
    }
    keys.clear();
    const s = { id, handlers, disarm: null };
    station = s;
    s.disarm = api.arm(
      {
        ...looking,
        key(ev) {
          if (s.handlers.key?.(ev)) return true;
          if (ev.key !== "Escape") return false;
          leave();
          return true;
        },
        keyup: (ev) => !!s.handlers.keyup?.(ev),
        disarmed: () => station === s && left(s),
      },
      { immersive: true },
    );
    publish(true);
    return () => station === s && leave();
  }

  function left(s) {
    station = null;
    try {
      s.handlers.left?.();
    } catch (err) {
      console.warn("[sailing] a station's left() failed", err);
    }
    publish(true);
  }

  /** Step away from the station you're at (S2: walking where you stood). */
  function leave() {
    const s = station;
    if (!s) return;
    station = null;
    w = walker.leaveStation(w);
    s.disarm?.();
    left(s);
  }

  /** Climb aboard by a ship's ladder (from the water, L1 then L2): on deck at its top, facing inboard. */
  function board(shipId) {
    const m = frameOfShip(shipId);
    if (!m || !env.mesh(shipId)) return false;
    if (!playing) start();
    leave();
    const up = walker.climb(env, shipId);
    if (up) {
      const r = walker.step(up, STILL, person.yaw, 0, env);
      w = r.state;
      person.yaw = r.yaw;
    } else {
      w = walker.spawnOn(env, shipId);
      person.yaw = 0;
    }
    checked();
    publish(true);
    return true;
  }

  // ─── tabletop's seats (firstPerson, a late-bound hand-off: tabletop/README.md) ───

  const firstPerson = {
    /**
     * First person, standing at a seat: walking at the projection (P1) of
     * the seat's eye, dropped by a seated eye's height, on the ship its
     * frame is aboard; facing what its view looks at. false if it can't.
     */
    enter({ eye, target, frame } = {}) {
      const ship = frame ? shipOf(api.scene(), frame) : null;
      const m = ship ? frameOfShip(ship) : null;
      if (!m || !Array.isArray(eye) || !env.mesh(ship)) return false;
      const local = apply(invert(m), eye);
      const next = walker.place(env, ship, [local[0], local[1] - walker.WALKER.seatedEye, local[2]]);
      if (!next || next.mode === "boarding") return false;
      if (!playing) start();
      leave();
      w = next;
      if (Array.isArray(target)) {
        const t = apply(invert(m), target);
        const d = [t[0] - local[0], t[1] - local[1], t[2] - local[2]];
        if (w.mode !== "swimming") person.yaw = Math.atan2(-d[0], -d[2]);
        else person.yaw = Math.atan2(-d[0], -d[2]) + headingOf(m);
        person.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(d[1], Math.hypot(d[0], d[2]))));
      }
      checked();
      publish(true);
      return true;
    },
    /** End first person, the walker left where it was: the seat's view takes the camera. */
    leave() {
      stop({ keepCamera: true });
    },
  };

  // ─── everyone else ──────────────────────────────────────────────────────

  const world = api.world();
  const labels = api.labels();
  const avatars = new Map(); // session → { group, head, mat, on, pos, yaw, pitch }
  const names = new Map(); // viewer → name
  const noRay = () => {};
  const shared = {
    body: new THREE.CapsuleGeometry(0.26, 0.86, 4, 12),
    head: new THREE.SphereGeometry(0.19, 16, 12),
    eyes: new THREE.BoxGeometry(0.26, 0.07, 0.08),
    dark: new THREE.MeshBasicMaterial({ color: 0x15181c }),
  };

  function avatarFor(session, hue) {
    let a = avatars.get(session);
    if (a) return a;
    const group = new THREE.Group();
    group.userData.noPick = true;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.65, 0.55), roughness: 0.6 });
    const torso = new THREE.Mesh(shared.body, mat);
    torso.position.set(0, 0.69, 0);
    const head = new THREE.Group();
    head.position.set(0, 1.58, 0);
    const skull = new THREE.Mesh(shared.head, mat);
    const eyes = new THREE.Mesh(shared.eyes, shared.dark);
    eyes.position.set(0, 0.03, -0.16);
    head.add(skull, eyes);
    group.add(torso, head);
    // never picked, never in a ray's way: not the use prompt's, not the walker's
    for (const o of [group, torso, head, skull, eyes]) {
      o.userData.noPick = true;
      o.raycast = noRay;
    }
    world.add(group);
    a = { group, head, mat, on: null, pos: null, yaw: 0, pitch: 0 };
    avatars.set(session, a);
    return a;
  }

  function nameOf(viewer) {
    if (!viewer) return null;
    if (names.has(viewer)) return names.get(viewer);
    names.set(viewer, null);
    if (String(viewer).startsWith("automerge:")) {
      Promise.resolve(api.repo?.find?.(viewer))
        .then((h) => {
          const n = h?.doc?.()?.name;
          if (n) names.set(viewer, String(n));
        })
        .catch(() => {});
    }
    return null;
  }

  function drawPeers(dt) {
    const seen = new Set();
    const items = [];
    for (const [session, p] of Object.entries(api.presence.get() ?? {})) {
      if (session === api.session) continue;
      const rec = p?.keys?.[api.id]?.crew;
      if (!okRecord(rec)) continue;
      seen.add(session);
      const a = avatarFor(session, hueOf(p.viewer ?? session));
      Object.assign(a, ease(a, rec, dt));
      const at = placeOf(a, frameOfShip);
      a.group.visible = !!at;
      if (!at) continue;
      a.group.position.set(at.position[0], at.position[1], at.position[2]);
      a.group.rotation.set(0, at.yaw, 0);
      a.head.rotation.set(a.pitch, 0, 0);
      const name = nameOf(p.viewer);
      if (name) items.push({ key: session, text: name, position: [at.position[0], at.position[1] + 2.05, at.position[2]], className: "sail-name", rank: 1 });
    }
    for (const [session, a] of avatars) {
      if (seen.has(session)) continue;
      a.group.removeFromParent();
      a.mat.dispose();
      avatars.delete(session);
    }
    labels.set(items);
  }

  // the tab hidden or closing: step away from a station, so what you set there is written down and it's free
  const doc = globalThis.document;
  if (doc) api.listen?.(doc, "visibilitychange", () => doc.visibilityState === "hidden" && leave());
  api.listen?.(globalThis, "pagehide", () => leave());

  return {
    input: {
      // a click on the sea, the sky, the ship or the shore comes aboard (Enter
      // does too: stations.js's "aboard"); not one on something else aboard
      // her, nor (seated at a table aboard) anything but the sea and sky (boardsOn)
      click(ev) {
        if (playing || !boardsOn(api.scene(), ev?.hit ?? null, { seated: seatedView(api) })) return false;
        start();
        return true;
      },
    },
    start,
    stop,
    me() {
      return {
        playing,
        paused,
        free,
        on: onShip(),
        position: feetNow(),
        yaw: person.yaw,
        pitch: person.pitch,
        eye: playing ? eye && [...eye] : (api.camera.get()?.position ?? null),
        station: station?.id ?? null,
        swimming: playing && w?.mode === "swimming",
        mode: w?.mode ?? null,
        hint: station?.handlers.hint?.() ?? null,
      };
    },
    take,
    leave,
    board,
    firstPerson,
    /** For probes and the checks: a ship's navmesh and what it was baked from ({ mesh, input }), and the walker's state. */
    nav: (ship) => {
      const mesh = meshOf(ship);
      const n = navs.get(ship);
      return mesh ? { mesh, input: n?.input ?? null } : null;
    },
    walker: () => w,
    /** One frame (play.js runs it after the ships have moved): walk or follow the ship, and draw everyone else. */
    tick(dt) {
      frameNo++;
      const d = Math.min(dt, 0.05);
      if (playing) walk(d);
      else follow();
      drawPeers(d);
    },
    /** Put the body somewhere: `position` local to ship `on`, else in the world (a respawn; probes). */
    place(on, position, yaw = person.yaw, pitch = person.pitch) {
      leave();
      if (on == null) inWater(position, yaw);
      else {
        // P1: projected onto her mesh (over the water: swimming there)
        w = walker.place(env, on, position);
        const m = frameOfShip(on);
        person.yaw = w.mode === "swimming" && m ? yaw + headingOf(m) : yaw;
      }
      person.pitch = pitch;
      if (w.mode !== "boarding") checked();
    },
    update(s) {
      version++;
      if (station && !s.objects?.[station.id]) leave();
    },
    dispose() {
      stop();
      for (const n of navs.values()) clearTimeout(n.timer);
      riding?.off?.();
      riding = null;
      for (const a of avatars.values()) a.mat.dispose();
      avatars.clear();
      for (const g of Object.values(shared)) g.dispose?.();
    },
  };
}
