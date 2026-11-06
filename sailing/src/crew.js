// People aboard (DESIGN.md, "Play"): coming aboard, walking a moving deck,
// going over the side and swimming, standing at a station, and everyone
// else drawn where they stand.
//
// Your body lives in the frame of the ship you stand on: its feet are local
// to her body frame (bow −Z, through her frame: body.js), so the deck
// carries you as it rolls and sails, and "aft of the wheel" is aft whichever
// way her model was drawn. Each frame the
// body goes out to the world through the ship's displayed matrix, takes one
// step of the walker there (the stage's rays see the hull as drawn, gravity
// is world −Y, the velocity is the deck's), and comes back. Off the deck you
// swim, in the world, at the ocean's height.
//
// State lives where the contract says:
// - presence: `crew` = { on, position, yaw, pitch, station } at ~18 Hz, the
//   position local to `on` (world when it's null);
// - this closure: your body, the keys held, the station you're at.
//
// The frame maths and the avatars' easing are pure and exported (tested in
// crew.test.js); createCrew is the stage-side part.

import { BODY, DECK, SWIM, look, lookDir, step, swim } from "./walk.js";
import { apply, headingOf, invert, onHeading, rotateM, unrotateM } from "./frames.js";
import { QUARTER, isUnder, shipOf } from "./traits.js";
import { bodyBoxOf, bodyOf } from "./body.js";

const FOV = 60; // vertical: about 90° across at 16:9; wider puts more heaving sea in the corners of your eye
const SEND_MS = 55; // presence, about 18 Hz
const EASE = 12; // how fast an avatar closes on its latest record (1/s)
const BEHIND = 0.6; // how far aft of a station you stand (m)
const INBOARD = 0.5; // from the ladder's hook to where you stand on deck
const SUNK = 1.5; // feet this far under the surface are in the water, deck or no deck
const STILL = Object.freeze({ forward: 0, strafe: 0 });
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);

const NAME_CSS = `.scene-stage .label.sail-name:where(:not(.about-embed *), .about-embed .scene-tool *) {
  color: #f6f3ea;
  background: color-mix(in oklch, #0b0d10 62%, transparent);
  padding: 1px 7px;
  border-radius: 6px;
  text-shadow: 0 1px 1px rgb(0 0 0 / 0.4);
}`;

// ─── on a moving deck (pure) ────────────────────────────────────────────────

/**
 * One step on a moving deck. The body is in the frame's terms (feet and
 * velocity local, yaw relative to the bow); it goes out to the world through
 * `m`, steps there, and comes back, so a body standing still stays where it
 * stood on the deck however the frame moves. Standing, it has no speed up or
 * down the deck, so a roll can't throw it.
 * @param {{ feet: number[], vel: number[], onGround: boolean, yaw: number }} body
 * @param {object} input  the walker's
 * @param {number[]} m  the frame's displayed world matrix, this frame
 * @param {number} dt
 * @param {object} world  the walker's rays, in the world
 * @returns {{ feet: number[], vel: number[], onGround: boolean, world: number[] }}  world: the feet in the world
 */
export function deckStep(body, input, m, dt, world, spec = DECK) {
  const vel = rotateM(m, body.vel);
  if (body.onGround) vel[1] = 0;
  const s = step({ feet: apply(m, body.feet), vel, onGround: body.onGround }, input, body.yaw + headingOf(m), dt, world, spec);
  return { feet: apply(invert(m), s.feet), vel: unrotateM(m, s.vel), onGround: s.onGround, world: s.feet };
}

/**
 * In the water: fallen below the surface, or well under it however you got
 * there, and with no deck under your feet (a cockpit's sole can lie lower
 * than a crest passing the hull).
 */
export const overboard = (feet, onGround, surface, deckBelow = false) =>
  feet[1] < surface - SUNK || (!deckBelow && ((!onGround && feet[1] < surface) || feet[1] < surface - 0.6));

/** A body in one frame (`from`, a matrix) moved into another (`to`), the same in the world: stepping across onto another deck. */
export function reframe(body, from, to) {
  const back = invert(to);
  return {
    feet: apply(back, apply(from, body.feet)),
    vel: unrotateM(to, rotateM(from, body.vel)),
    yaw: body.yaw + headingOf(from) - headingOf(to),
  };
}

/** Where you stand to work a station: just aft of it, in the ship's frame. */
export const behind = ([x, y, z], by = BEHIND) => [x, y, z + by];

/** Where you come aboard by a ladder hooked over the side at `at` (local): inboard of it, on deck. */
export const ladderTop = ([x, y, z], by = INBOARD) => [x - Math.sign(x || 1) * by, y, z];

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

/** A stable hue for a person. */
export function hueOf(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

const okRecord = (r) => !!r && Array.isArray(r.position) && r.position.length === 3 && r.position.every(Number.isFinite);
const r3 = (v) => Math.round(v * 1000) / 1000;

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
  let placed = false; // has the body been put anywhere yet
  let disarm = null;
  let releaseCamera = null;
  let orbitFov = null; // the camera's field of view before coming aboard
  let station = null; // { id, handlers, spot, disarm }
  let lastSent = 0;
  let eye = null; // world, while playing
  const body = { on: null, feet: [0, 0, 0], vel: [0, 0, 0], onGround: false, yaw: 0, pitch: 0 };
  const keys = new Set();

  const clock = () => ctx.sea?.clock?.() ?? 0;
  /** A ship's body frame as drawn (bow −Z), which a body aboard lives in; null when she's gone. */
  const frameOfShip = (id) => bodyOf(api, id);
  const surfaceAt = (t) => (x, z) => ctx.sea?.ocean?.heightAt?.(x, z, t) ?? 0;

  // the walker's world: the stage's rays, which see the hull as drawn this frame
  const rays = {
    down: (from, max) => api.raycast(from, [0, -1, 0], { far: max })?.distance ?? null,
    ahead: (from, dir, max) => {
      const h = api.raycast(from, dir, { far: max });
      return h ? { distance: h.distance, normal: h.normal } : null;
    },
  };

  // ─── putting the body somewhere ─────────────────────────────────────────

  /** The deck under a local point (cast down from a little above it), local; the point itself if nothing's there. */
  function groundAt(m, local, skipId = null) {
    const from = apply(m, [local[0], local[1] + 1.2, local[2]]);
    const s = api.scene();
    const skip = skipId ? (id) => isUnder(s, id, skipId) : null;
    const hit = api.raycast(from, rotateM(m, [0, -1, 0]), { far: 4, skip });
    return hit?.point ? apply(invert(m), hit.point) : [...local];
  }

  const localOf = (m, id) => {
    const w = api.worldOf(id);
    return w ? apply(invert(m), [w[12], w[13], w[14]]) : null;
  };

  /** Just aft of a station, on whatever is there. */
  function standSpot(stationId, m) {
    const at = localOf(m, stationId);
    return at ? groundAt(m, behind(at), stationId) : null;
  }

  /** Somewhere to stand on a ship: at the helm, else aft on the centreline. */
  function deckSpot(ship, m) {
    const helm = ctx.sim?.stationsOf?.(ship)?.helm;
    const at = helm ? standSpot(helm, m) : null;
    if (at) return at;
    const box = bodyBoxOf(api, ship); // metres, as m is
    const z = box ? box.max[2] - 1.2 : 0;
    const x = box ? (box.min[0] + box.max[0]) / 2 : 0;
    return groundAt(m, [x, 3, z]);
  }

  function setBody(on, feet, yaw = 0, pitch = 0) {
    Object.assign(body, { on, feet: [...feet], vel: [0, 0, 0], onGround: on != null, yaw, pitch });
    placed = true;
  }

  function inWater(feetW, velW, yawW) {
    const y = surfaceAt(clock())(feetW[0], feetW[2]) - SWIM.depth;
    setBody(null, [feetW[0], y, feetW[2]], yawW, body.pitch);
    body.vel = [velW[0] * 0.3, 0, velW[2] * 0.3];
  }

  /** On the first ship's deck, by the wheel; in the water if there's no ship. */
  function spawn() {
    const ship = ctx.sim?.ships?.()[0] ?? null;
    const m = ship ? frameOfShip(ship) : null;
    if (m) {
      // beside the wheel, a little to one side or the other, so two who come aboard together aren't one
      const at = deckSpot(ship, m);
      const side = [0, -0.45, 0.45][hueOf(api.session ?? "") % 3];
      return setBody(ship, side ? groundAt(m, [at[0] + side, at[1], at[2]]) : at, 0, -0.1);
    }
    const c = api.camera.get()?.position ?? [0, 0, 0];
    inWater(c, [0, 0, 0], 0);
  }

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

  /** Standing on another ship's deck now: into her frame (a walk or a jump across). The new frame, or null. */
  function stepAcross(m, feetW) {
    if (!body.onGround || station) return null;
    const hit = api.raycast([feetW[0], feetW[1] + 0.3, feetW[2]], [0, -1, 0], { far: 0.6 });
    const ship = hit?.id ? shipOf(api.scene(), hit.id) : null;
    const to = ship && ship !== body.on ? frameOfShip(ship) : null;
    if (!to) return null;
    Object.assign(body, reframe(body, m, to), { on: ship });
    return to;
  }

  function walk(dt) {
    const t = clock();
    const surface = surfaceAt(t);
    const input = wanted();
    let m = body.on ? frameOfShip(body.on) : null;
    if (body.on && !m) inWater(eye ? [eye[0], 0, eye[2]] : body.feet, [0, 0, 0], body.yaw); // the ship went
    if (body.on) {
      if (station?.spot) {
        body.feet = [station.spot[0], body.feet[1], station.spot[2]];
        body.vel = [0, 0, 0];
      }
      const next = deckStep(body, input, m, dt, rays);
      const w = next.world;
      const sea = surface(w[0], w[2]);
      // under a passing crest: in the water only if there's no deck under you
      const wet = !station && overboard(w, next.onGround, sea);
      if (wet && overboard(w, next.onGround, sea, !!api.raycast([w[0], w[1] + 0.1, w[2]], [0, -1, 0], { far: DECK.ledge + 1 }))) {
        inWater(w, rotateM(m, next.vel), body.yaw + headingOf(m));
        m = null;
      } else {
        Object.assign(body, { feet: next.feet, vel: next.vel, onGround: next.onGround });
        m = stepAcross(m, w) ?? m;
      }
    } else {
      const s = swim(body, input, body.yaw, dt, { surface, ahead: rays.ahead });
      body.feet = s.feet;
      body.vel = s.vel;
    }
    const feetW = m ? apply(m, body.feet) : body.feet;
    const yawW = body.yaw + (m ? headingOf(m) : 0);
    eye = [feetW[0], feetW[1] + BODY.eye, feetW[2]];
    const d = lookDir(yawW, body.pitch);
    api.camera.set({ position: eye, target: [eye[0] + d[0], eye[1] + d[1], eye[2] + d[2]], fov: FOV, near: 0.05, far: 5000 });
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
    if (!playing || (!now && ms - lastSent < SEND_MS)) return;
    lastSent = ms;
    api.presence.set("crew", { on: body.on, position: body.feet.map(r3), yaw: r3(body.yaw), pitch: r3(body.pitch), station: station?.id ?? null });
  }

  // Before coming aboard the camera is the orbit's, and it goes where the
  // ship goes (sideways only: no bobbing), so a sailing ship stays in view.
  // A camera nobody has moved (not even from a saved view) starts off the
  // ship's quarter.
  let followAt = null;
  let dragging = false;
  // (the release in the capture phase: the stage stops a claimed one at the port)
  api.listen(api.port, "pointerdown", () => (dragging = true), { capture: true });
  for (const type of ["pointerup", "pointercancel"]) api.listen(globalThis, type, () => (dragging = false), { capture: true });
  function follow() {
    const ship = ctx.sim?.ships?.()[0] ?? null;
    const m = ship ? frameOfShip(ship) : null;
    if (!m) return void (followAt = null);
    const at = [m[12], m[14]];
    if (!followAt) {
      followAt = at;
      if (!api.camera.touched?.()) api.camera.set({ position: onHeading(m, QUARTER.position), target: onHeading(m, QUARTER.target) });
      return;
    }
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
    const l = look(body.yaw, body.pitch, dx, dy);
    body.yaw = l.yaw;
    body.pitch = l.pitch;
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
    if (!placed || (body.on && !frameOfShip(body.on))) spawn();
    orbitFov = api.camera.get()?.fov ?? null; // given back on leaving: first person sees wider
    releaseCamera = api.camera.hold();
    // immersive: the editor's decorations stand aside while aboard
    disarm = api.arm(walking, { lock: true, replace: true, immersive: true });
    publish(true);
  }

  function stop() {
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
    // back off the quarter of the ship you were on
    const m = body.on ? frameOfShip(body.on) : null;
    const fov = orbitFov != null ? { fov: orbitFov } : {};
    if (m) api.camera.set({ position: onHeading(m, QUARTER.position), target: onHeading(m, QUARTER.target), ...fov });
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
    const ship = shipOf(api.scene(), id);
    const m = ship ? frameOfShip(ship) : null;
    let spot = null;
    if (m) {
      spot = standSpot(id, m);
      if (spot) setBody(ship, spot, 0, -0.2);
    }
    keys.clear();
    const s = { id, handlers, spot, disarm: null };
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

  /** Step away from the station you're at. */
  function leave() {
    const s = station;
    if (!s) return;
    station = null;
    s.disarm?.();
    left(s);
  }

  /** Climb aboard by a ship's ladder (from the water): on deck at its top, facing inboard. */
  function board(shipId) {
    const m = frameOfShip(shipId);
    if (!m) return false;
    if (!playing) start();
    leave();
    const ladder = ctx.sim?.stationsOf?.(shipId)?.ladder;
    const at = ladder ? localOf(m, ladder) : null;
    if (at) setBody(shipId, groundAt(m, ladderTop(at), ladder), at[0] >= 0 ? Math.PI / 2 : -Math.PI / 2);
    else setBody(shipId, deckSpot(shipId, m), 0);
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
      // a click on the view comes aboard (Enter does too: stations.js's "aboard")
      click() {
        if (playing) return false;
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
        on: body.on,
        position: [...body.feet],
        yaw: body.yaw,
        pitch: body.pitch,
        eye: playing ? eye && [...eye] : (api.camera.get()?.position ?? null),
        station: station?.id ?? null,
        swimming: playing && placed && body.on == null,
        hint: station?.handlers.hint?.() ?? null,
      };
    },
    take,
    leave,
    board,
    /** One frame (play.js runs it after the ships have moved): walk or follow the ship, and draw everyone else. */
    tick(dt) {
      const d = Math.min(dt, 0.05);
      if (playing) walk(d);
      else follow();
      drawPeers(d);
    },
    /** Put the body somewhere: `position` local to ship `on`, else in the world (a respawn; probes). */
    place(on, position, yaw = body.yaw, pitch = body.pitch) {
      leave();
      if (on == null) inWater(position, [0, 0, 0], yaw);
      else setBody(on, position, yaw, pitch);
      body.pitch = pitch;
    },
    update(s) {
      if (station && !s.objects?.[station.id]) leave();
    },
    dispose() {
      stop();
      for (const a of avatars.values()) a.mat.dispose();
      avatars.clear();
      for (const g of Object.values(shared)) g.dispose?.();
    },
  };
}
