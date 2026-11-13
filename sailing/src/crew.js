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
import { apply, headingOf, invert, matrixOf, multiply, onHeading, rotateM } from "./frames.js";
import { HELM, HOOK, JIB, QUARTER, SAIL, WINCH, isUnder, partsOf, sailingThing, shipOf } from "./traits.js";
import { bodyBoxOf, bodyOf, frameMatrix, placeIn, shipFrame } from "./body.js";
import { MAX_SUBSTEPS, SUBSTEP } from "./physics.js";

export { behind, ladderTop } from "./walker.js";

const FOV = 60; // vertical: about 90° across at 16:9; wider puts more heaving sea in the corners of your eye
const SEND_MS = 55; // presence, about 18 Hz
const EASE = 12; // how fast an avatar closes on its latest record (1/s)
const STILL = Object.freeze({ forward: 0, strafe: 0 });
/** How far the crew reaches (m), walking her deck or at a station: the bodies' reach (scene/TOOLS.md §4). */
export const REACH = 2.5;
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);

const NAME_CSS = `.scene-stage .label.sail-name:where(:not(.about-embed *), .about-embed .scene-tool *) {
  color: #f6f3ea;
  background: color-mix(in oklch, #0b0d10 62%, transparent);
  padding: 1px 7px;
  border-radius: 6px;
  text-shadow: 0 1px 1px rgb(0 0 0 / 0.4);
}`;

// ─── frames (pure) ──────────────────────────────────────────────────────────

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
 * `seated`: the viewer is in a body that isn't the crew's or orbit (a seat at
 * a table aboard her: seatedView); then only the sea or the sky does (the
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

/** Is this viewer in a body that is neither orbit nor the crew's own (a seat at a table aboard her: scene/TOOLS.md §4)? */
export const seatedView = (api) => {
  const id = api?.body?.current?.()?.id;
  return id != null && !["orbit", "aboard", "station"].includes(id);
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
      if (t?.[SAIL] || t?.[JIB] || t?.[HOOK]) return true;
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
  // a winch's stand is its trait's (in its own frame), facing it
  for (const id of parts.winches) {
    const m = placeIn(scene, id, ship);
    const stand = scene.objects[id]?.traits?.[WINCH]?.stand;
    if (!m || !Array.isArray(stand)) continue;
    const toW = multiply(toBody, m);
    stations.push(walker.facing(id, apply(toW, [0, 0, 0]), apply(toW, stand)));
  }
  const ladder = parts.ladder && at(parts.ladder) ? { id: parts.ladder, at: at(parts.ladder) } : null;
  const seeds = walker.seedsOf({ stations, helm: parts.helm, ladder, box: bodyBoxOf(api, ship) });
  return { key, triangles, seeds };
}

/**
 * The look (yaw to her bow, as the crew's, and pitch up) from an eye to a
 * world point, `heading` hers: the inverse of walk.js lookDir. Pure.
 */
export function aimOf(eye, at, heading) {
  const dx = at[0] - eye[0], dy = at[1] - eye[1], dz = at[2] - eye[2];
  return { yaw: Math.atan2(-dx, -dz) - heading, pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
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
  let releaseCamera = null;
  let orbitFov = null; // the camera's field of view before coming aboard
  let station = null; // { id, handlers }
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
    if (station || suspended) return STILL;
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

  function walk(dt, sea = dt) {
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
        station.handlers.tick?.(sea);
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
  // ship goes (sideways only: no bobbing), so a sailing ship stays in view:
  // a base ride (the stage's camera.ride), which a body with a ride of its
  // own (a seat at a table aboard her) wins over with no flag. A camera nobody has moved (not
  // even from a saved view) starts off the ship's quarter.
  let riding = null; // { ship, off }
  let framed = false; // the quarter view for a camera nobody moved: once, on first sight of her (stop() puts you off her quarter itself)
  function follow() {
    const ship = ctx.sim?.ships?.()[0] ?? null;
    const m = ship ? frameOfShip(ship) : null;
    if (riding && riding.ship !== (m ? ship : null)) {
      riding.off?.();
      riding = null;
    }
    if (!m || riding) return;
    if (!framed && !api.camera.touched?.()) api.camera.set({ position: onHeading(m, QUARTER.position), target: onHeading(m, QUARTER.target) });
    framed = true;
    riding = { ship, off: api.camera.ride(ship, { turn: false, rise: false }) };
  }

  // ─── input ──────────────────────────────────────────────────────────────

  function turn(dx, dy) {
    const l = look(person.yaw, person.pitch, dx, dy);
    person.yaw = l.yaw;
    person.pitch = l.pitch;
  }

  // without the lock: a drag looks around, and a tap goes on as a click (down
  // the chain again: walking has no default press of its own)
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

  // looking and pressing, the same whether walking or at a station: the
  // body's input, last in the chain for presses (scene/TOOLS.md §5)
  const looking = {
    move(ev) {
      if (ev.locked) turn(ev.dx ?? 0, ev.dy ?? 0);
    },
    press: (ev) => (ev.button === 0 && !ev.locked ? lookSession(ev) : null),
    wheel: () => true,
    cursor: (ev) => (ev.locked ? "none" : "grab"),
  };

  // ─── the bodies (scene/TOOLS.md §4) ─────────────────────────────────────
  //
  // Walking her deck is the "aboard" body; standing at a station, the
  // "station" body, pushed over it (stepping away pops it, and you walk on
  // where you stood). Both are sailing's own: the navmesh walker knows her
  // deck, her ladder and the water, which the general walk body (the walk
  // package's, on whatever the rays hit) doesn't. A body pushed over
  // "aboard" that isn't sailing's (a seat at a table in her cockpit) leaves
  // the walker waiting, the camera let go; when it goes, you stand up from
  // where its view was.

  const AB = "aboard";
  const ST = "station";
  /** Is the top body one of the crew's (walking her deck, or at a station)? */
  const ours = () => [AB, ST].includes(api.local.get()?.body?.id);
  let enteringStation = false; // a station going on over "aboard": not a wait
  let overOrbit = true; // "aboard" went on over orbit (else over a body that has a view of its own: a seat)
  let suspended = false; // another body (a seat) is over "aboard"

  const walkKeys = Object.freeze([...MOVE_KEYS].map((code) => ({ code })));

  /** Stand where the view is (a seat's eye, dropped by a seated eye's height), on the ship it's over: the walker after a seat. */
  function standAtEye() {
    const cam = api.camera.get();
    const eyeW = cam?.position;
    const ship = ctx.sim?.ships?.()[0] ?? null;
    const m = ship ? frameOfShip(ship) : null;
    if (!m || !Array.isArray(eyeW) || !env.mesh(ship)) return;
    const local = apply(invert(m), eyeW);
    const next = walker.place(env, ship, [local[0], local[1] - walker.WALKER.seatedEye, local[2]]);
    if (!next || next.mode === "boarding") return;
    w = next;
    if (Array.isArray(cam?.target)) {
      const t = apply(invert(m), cam.target);
      const d = [t[0] - local[0], t[1] - local[1], t[2] - local[2]];
      person.yaw = w.mode !== "swimming" ? Math.atan2(-d[0], -d[2]) : Math.atan2(-d[0], -d[2]) + headingOf(m);
      person.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(d[1], Math.hypot(d[0], d[2]))));
    }
    checked();
  }

  const aboardBody = {
    id: AB,
    label: "Aboard",
    keys: walkKeys,
    lock: true,
    reach: REACH,
    enter() {
      if (playing) return null;
      // the body this one goes over: orbit, or one that takes the camera back when this goes (a seat)
      overOrbit = (api.local.get()?.body?.id ?? "orbit") === "orbit";
      playing = true;
      suspended = false;
      if (!w || (onShip() && !frameOfShip(w.ship))) spawn();
      orbitFov = api.camera.get()?.fov ?? null; // given back on leaving: first person sees wider
      releaseCamera = api.camera.hold();
      publish(true);
      return {
        keys: walkKeys,
        input: {
          ...looking,
          key(ev) {
            keys.add(ev.code);
            return true;
          },
          keyup(ev) {
            keys.delete(ev.code);
            return true;
          },
          suspended() {
            if (enteringStation) return;
            // a body that isn't ours on top (a seat): wait under it
            suspended = true;
            keys.clear();
            releaseCamera?.();
            releaseCamera = null;
            api.presence.set("crew", undefined);
          },
          resumed() {
            if (!suspended) return; // back from a station: you were walking all along
            suspended = false;
            standAtEye();
            releaseCamera = api.camera.hold();
            publish(true);
          },
        },
        eye: () => (eye ? { position: [...eye], direction: lookDir(person.yaw + (onShip() ? headingOf(frameOfShip(w.ship) ?? matrixOf(null)) : 0), person.pitch) } : null),
        // off her deck: back off her quarter, unless the body under takes the camera (a seat's view)
        leave: () => stopped({ keepCamera: !overOrbit }),
      };
    },
  };

  // what a station's verb asked for, read by its body's enter (the place is the station's id)
  let pendingStation = null; // { id, handlers }
  const stationBody = {
    id: ST,
    label: "At a station",
    lock: true,
    reach: REACH,
    // it needs a station (its verb enters it): the body chip doesn't offer it
    here: false,
    enter(id) {
      const p = pendingStation?.id === id ? pendingStation : null;
      pendingStation = null;
      if (!p || !playing) return null;
      const s = arrive(id, p.handlers);
      const declared = Object.freeze((p.handlers.keys ?? []).map((code) => ({ code })));
      return {
        label: stationLabel(id),
        keys: declared,
        input: {
          ...looking,
          key: (ev) => !!s.handlers.key?.(ev),
          keyup: (ev) => !!s.handlers.keyup?.(ev),
        },
        eye: () => (eye ? { position: [...eye], direction: null } : null),
        leave: () => station === s && depart(s),
      };
    },
  };

  /** What a station is called, for the body chip and who's here: its kind ("Helm", "Mainsheet"…). */
  function stationLabel(id) {
    const ship = shipOf(api.scene(), id);
    const kind = ship ? Object.entries(partsOf(api.scene(), ship)).find(([, v]) => v === id || (Array.isArray(v) && v.includes(id)))?.[0] : null;
    const names = { helm: "Helm", sail: "Mast", anchor: "Windlass", mainsheet: "Mainsheet", winches: "Winch", ladder: "Ladder" };
    return names[kind] ?? "At a station";
  }

  /** Come aboard: the "aboard" body (or, under a seat, stand up from it). */
  function start() {
    if (playing) {
      // waiting under a seat: stand up from it
      while (suspended && api.local.get()?.body?.depth > 0 && !ours()) if (!api.body.leave()) break;
      return;
    }
    api.body.enter(AB);
  }

  /** Off the deck: leave the crew's bodies (a station, then "aboard"). */
  function stop() {
    if (!playing) return;
    while (ours() && api.local.get()?.body?.depth > 0) if (!api.body.leave()) break;
    if (playing) stopped(); // (not the top: a body over it went with the stage)
  }

  // "aboard" went off the stack
  function stopped({ keepCamera = false } = {}) {
    if (!playing) return;
    leave();
    playing = false;
    suspended = false;
    keys.clear();
    releaseCamera?.();
    releaseCamera = null;
    eye = null;
    // back off the quarter of the ship you were on
    const m = onShip() ? frameOfShip(w.ship) : null;
    const fov = orbitFov != null ? { fov: orbitFov } : {};
    if (keepCamera) {
      // the view that asked takes the camera
    } else if (m) api.camera.set({ position: onHeading(m, QUARTER.position), target: onHeading(m, QUARTER.target), ...fov });
    else api.camera.set(fov);
    api.presence.set("crew", undefined);
  }

  // ─── stations ───────────────────────────────────────────────────────────

  /**
   * Stand at a station: the "station" body over walking, which hears the
   * keys the station declares first (`keys`: codes). You're put just aft of
   * it, facing forward; the mouse still turns your head.
   * @param {string} id
   * @param {{ keys: string[], key?(ev): boolean, keyup?(ev): boolean, tick?(dt), left?(), hint?(): string, look?(): number[] | null }} handlers
   *   keys: the codes the station takes (scene/TOOLS.md §5: declared, so a shown key works);
   *   look: a world point to turn the eye to on arriving (else forward)
   * @returns {() => void} leave
   */
  function take(id, handlers = {}) {
    if (!playing) start();
    if (!playing) return () => {};
    leave();
    pendingStation = { id, handlers };
    enteringStation = true;
    const ok = api.body.enter(ST, id);
    enteringStation = false;
    pendingStation = null;
    if (!ok) return () => {};
    const s = station;
    return () => station === s && leave();
  }

  // the station body's arrival: S1, at the station's stand spot (its link in her mesh), facing forward
  function arrive(id, handlers) {
    const ship = shipOf(api.scene(), id);
    const m = ship ? frameOfShip(ship) : null;
    const at = m ? localOf(m, id) : null;
    const kind = ship ? Object.entries(partsOf(api.scene(), ship)).find(([, v]) => v === id)?.[0] : null;
    const r = ship ? walker.takeStation(env, ship, id, at ? walker.behind(at, walker.standOff(kind)) : null) : null;
    if (r) {
      w = r.state;
      person.yaw = r.yaw;
      person.pitch = -0.2;
      // a station that says what its worker watches (a winch: the jib's luff) turns the eye to it
      const aim = handlers.look?.();
      const pose = aim ? walker.worldPose(w, env) : null;
      if (pose) {
        const v = aimOf(pose.eye, aim, pose.heading);
        person.yaw = v.yaw;
        person.pitch = v.pitch;
      }
    }
    keys.clear();
    const s = { id, handlers };
    station = s;
    publish(true);
    return s;
  }

  // the station body went off the stack: S2, walking where you stood
  function depart(s) {
    if (station !== s) return;
    station = null;
    w = walker.leaveStation(w);
    try {
      s.handlers.left?.();
    } catch (err) {
      console.warn("[sailing] a station's left() failed", err);
    }
    publish(true);
  }

  /** Step away from the station you're at (its body comes off; you walk on where you stood). */
  function leave() {
    const s = station;
    if (!s) return;
    if (api.local.get()?.body?.id === ST) api.body.leave();
    if (station === s) depart(s); // (the body was already gone)
  }

  /** Climb aboard by a ship's ladder (from the water, L1 then L2): on deck at its top, facing inboard. */
  function board(shipId) {
    const m = frameOfShip(shipId);
    if (!m || !env.mesh(shipId)) return false;
    if (!playing) start();
    if (!playing) return false;
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
    // the crew's bodies: walking her deck, and standing at a station
    bodies: [aboardBody, stationBody],
    me() {
      const ptr = api.local.get()?.pointer ?? {};
      return {
        playing: playing && !suspended,
        // the browser let the lock go (its Escape): a click takes it back
        paused: playing && !!ptr.released,
        // no lock (refused, or something wants the pointer): drag to look
        free: playing && !ptr.locked && !ptr.released,
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
      // the walker's step is capped for its own sake; the station's verbs (the wheel, a sheet, the
      // furler, the halyard, the windlass) run in sea time, as far as the ships step this frame
      if (playing && !suspended) walk(d, Math.min(Math.max(dt, 0), MAX_SUBSTEPS * SUBSTEP));
      else if (!playing) follow();
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
