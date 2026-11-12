// Playing a level (the "arena" extension): first person, against whatever the
// scene is made of. Nothing here knows about floors or walls: walking asks
// the stage's raycasts (walk.js), shooting is one more ray, and what counts as
// a target or a place to start is a trait on an object. So a boat with a few
// targets on its deck is a level too.
//
// State lives where the scene's contract says it should:
// - doc: a target knocked over ({ down: { by, at }, stand: { rotation } }:
//   level.js isDown) and its fallen pose. Scores aren't stored; they're
//   counted from who knocked what down, so two players hitting one target at
//   once agree on whose it is.
// - presence: where each player is (their avatar), at 20 Hz while playing.
// - sends: shots, so peers see the tracer; nobody keeps them.
// - local (this closure): your body, keys, ammo.
//
// A level also has a look: a sky, a light haze that hides the void past the
// walls, and a warm low sun that casts shadows (the stage's atmosphere). Only
// a laid-out level (its trait says look: "arena") gives it; a boat with a few
// targets on its deck keeps its own.

import css from "./play.css?inline";
import { BODY, look, lookDir, step } from "./walk.js";
import { isDown, knockedOver, standTargetsUp } from "./level.js";

const TARGET = "arena.target";
const SPAWN = "arena.spawn";
const MAG = 12;
const RELOAD_MS = 1200;
const SHOT_MS = 110; // between shots
const FOV = 75;
const HIT_MS = 260; // how long the hit marker shows
const FLASH_MS = 60; // how long a muzzle flash shows
/** The keys play takes: walking, running and jumping (and Esc, to stop). Every other key goes on down the chain (the use prompt). */
export const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);

/** The level's sky, haze and sun (the stage's atmosphere; STAGE.md): look "arena". */
export const ATMOSPHERE = Object.freeze({
  sky: { top: "#5d8fc9", horizon: "#f0dcc0", bottom: "#d8c3a2" },
  fog: { color: "#ecd9bd", near: 45, far: 190 },
  // low and to one side: from a corner spawn, shadows fall across the view
  sun: { direction: [-0.6, 0.55, -0.5], color: "#ffe2bc", intensity: 2.6, shadows: true },
});

/**
 * A level's looks, by its trait's `look`: "arena", the sky, haze and sun; "sky",
 * the sky alone, for a level whose light is its own (baked into an imported
 * map, say), where a sun would light nothing and haze would only fade it.
 */
export const LOOKS = Object.freeze({ arena: ATMOSPHERE, sky: Object.freeze({ sky: ATMOSPHERE.sky }) });

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  e.append(...kids.filter((k) => k != null));
  return e;
};

/** A stable hue for a player. */
export function hueOf(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Who knocked down how many: { [viewer]: n }, from the targets themselves. */
export function scores(objects) {
  const out = {};
  for (const o of Object.values(objects ?? {})) {
    const by = o?.traits?.[TARGET]?.down?.by;
    if (by) out[by] = (out[by] ?? 0) + 1;
  }
  return out;
}

const isTarget = (o) => !!o?.traits?.[TARGET];

export default {
  create(api) {
    const THREE = api.THREE;
    api.style(css);
    const overlay = api.overlay();
    overlay.classList.add("arena");

    let playing = false;
    let paused = false; // the lock was lost: waiting for a click to take it back
    // Pointer lock can be refused (a sandboxed frame, a headless browser, a
    // page without focus). Then play goes on without it: drag to look, click
    // to shoot. Losing a lock you had (Esc) pauses instead. The stage tells
    // them apart: lockLost({ refused }).
    let free = false; // playing without the lock
    let disarm = null;
    let releaseCamera = null;
    let stopLoop = null;
    const body = { feet: [0, 0, 0], vel: [0, 0, 0], onGround: false, yaw: 0, pitch: 0 };
    const keys = new Set();
    let ammo = MAG;
    let reloadUntil = 0;
    let lastShot = 0;
    let hitUntil = 0;
    let scene = null;
    const names = new Map(); // viewer → name (contact docs, looked up once)

    // ─── drawing ──────────────────────────────────────────────────────────
    const world = api.world();
    const tracers = []; // { line, until }
    const avatars = new Map(); // session → { group, until }
    const labels = api.labels();

    function tracer(from, to, hue) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
      const m = new THREE.LineBasicMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.9, 0.6), transparent: true, opacity: 0.9 });
      const line = new THREE.Line(g, m);
      line.userData.noPick = true;
      // the muzzle flash: a small hot spike where the shot leaves, drawn out
      // along it, briefly (a child of the tracer, so it goes with it)
      const flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.025), new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
      flash.position.set(...from);
      flash.lookAt(...to);
      flash.scale.set(1, 1, 3.5);
      line.add(flash);
      world.add(line);
      const now = performance.now();
      tracers.push({ line, flash, until: now + 120, flashUntil: now + FLASH_MS });
      api.invalidate();
      // playing, tick() prunes them; watching, a loop of their own does (else
      // a peer's shot hangs in the air until you play)
      if (!playing) pruneLater();
    }
    let tracerLoop = null;

    function pruneLater() {
      if (!tracerLoop && tracers.length) {
        tracerLoop = api.loop(() => {
          pruneTracers();
          if (tracers.length && !playing) return;
          const off = tracerLoop;
          tracerLoop = null;
          off?.();
          api.invalidate();
        });
      }
    }

    function pruneTracers() {
      const now = performance.now();
      for (let i = tracers.length - 1; i >= 0; i--) {
        const t = tracers[i];
        if (now >= t.flashUntil) t.flash.visible = false;
        if (now < t.until) continue;
        t.line.removeFromParent();
        disposeTracer(t);
        tracers.splice(i, 1);
      }
    }

    function disposeTracer(t) {
      t.line.geometry.dispose();
      t.line.material.dispose();
      t.flash.geometry.dispose();
      t.flash.material.dispose();
    }

    function avatarFor(session, hue) {
      let a = avatars.get(session);
      if (!a) {
        const group = new THREE.Group();
        group.userData.noPick = true;
        const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.6, 0.55), roughness: 0.6 });
        const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 16), mat);
        torso.position.y = 0.75;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), mat);
        head.position.y = 1.55;
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0x111111 }));
        visor.position.set(0, 1.58, -0.2);
        group.add(torso, head, visor);
        world.add(group);
        a = { group };
        avatars.set(session, a);
      }
      return a;
    }

    function drawPeers() {
      const peers = api.presence.get();
      const seen = new Set();
      const items = [];
      for (const [session, p] of Object.entries(peers)) {
        const av = p.keys?.arena?.avatar;
        if (!av || !Array.isArray(av.feet)) continue;
        seen.add(session);
        const a = avatarFor(session, hueOf(p.viewer ?? session));
        a.group.position.set(av.feet[0], av.feet[1], av.feet[2]);
        a.group.rotation.set(0, av.yaw ?? 0, 0);
        items.push({ key: session, text: nameOf(p.viewer), position: [av.feet[0], av.feet[1] + 2.05, av.feet[2]], className: "arena-name", rank: 1 });
      }
      for (const [session, a] of avatars) {
        if (seen.has(session)) continue;
        a.group.removeFromParent();
        a.group.traverse((o) => {
          o.geometry?.dispose?.();
          o.material?.dispose?.();
        });
        avatars.delete(session);
      }
      labels.set(items);
      api.invalidate();
    }

    function nameOf(viewer) {
      if (!viewer) return "Someone";
      if (viewer === api.viewer) return "You";
      const known = names.get(viewer);
      if (known) return known;
      names.set(viewer, "Player");
      if (String(viewer).startsWith("automerge:")) {
        api.repo
          .find(viewer)
          .then((h) => {
            const n = h.doc()?.name;
            if (n) {
              names.set(viewer, String(n));
              render();
            }
          })
          .catch(() => {});
      }
      return "Player";
    }

    // ─── the HUD ──────────────────────────────────────────────────────────
    const hud = el("div", { class: "arena-hud" });
    overlay.append(hud);
    let hudKey = "";

    function render() {
      const objects = scene?.objects ?? {};
      const targets = Object.values(objects).filter(isTarget);
      const standing = targets.filter((o) => !isDown(o)).length;
      const board = Object.entries(scores(objects)).sort((a, b) => b[1] - a[1]);
      const now = performance.now();
      const reloading = now < reloadUntil;
      const key = JSON.stringify([playing, paused, free, standing, targets.length, board, ammo, reloading, hitUntil > now ? hitUntil : 0, [...names]]);
      if (key === hudKey) return;
      hudKey = key;
      const scoreList = el("ol", { class: "arena-scores" }, ...board.slice(0, 6).map(([viewer, n]) => el("li", { "data-you": viewer === api.viewer }, el("span", {}, nameOf(viewer)), el("strong", {}, String(n)))));
      const show = (...kids) => hud.replaceChildren(...kids.filter((k) => k != null));
      if (!playing) {
        // the start bar with the scores under it, in one column (so a narrow view wraps rather than overlaps)
        show(
          el(
            "div",
            { class: "arena-lobby" },
            el(
              "div",
              { class: "arena-start" },
              el("button", { type: "button", class: "arena-play", onclick: () => start() }, "▶ Play"),
              el("span", { class: "arena-count" }, targets.length ? `${standing} of ${targets.length} targets standing` : "No targets yet"),
              standing < targets.length ? el("button", { type: "button", class: "arena-reset", onclick: () => resetTargets() }, "Stand them up") : null,
            ),
            board.length ? scoreList : null,
          ),
        );
        return;
      }
      show(
        el("div", { class: "arena-crosshair" }),
        // the hit marker: four ticks round the crosshair, fading (play.css)
        now < hitUntil ? el("div", { class: "arena-hit" }) : null,
        el("div", { class: "arena-top" }, el("span", {}, `${standing} of ${targets.length} standing`), board.length ? scoreList : null),
        el("div", { class: "arena-ammo", "data-empty": ammo === 0 }, reloading ? "Reloading…" : `${ammo} / ${MAG}`),
        el("div", { class: "arena-help" }, free ? "WASD move · Drag to look · Click shoot · Space jump · Shift run · Right-click reload · Esc stop" : "WASD move · Space jump · Shift run · Click shoot · Right-click reload · Esc stop"),
        paused ? el("button", { type: "button", class: "arena-resume", onclick: () => resume() }, "Click to carry on") : null,
      );
    }

    // ─── playing ──────────────────────────────────────────────────────────
    /** A spawn point (a random one), else above the middle of what's there. */
    function spawn() {
      const spots = Object.entries(scene?.objects ?? {}).filter(([, o]) => o?.traits?.[SPAWN]);
      const pick = spots.length ? spots[Math.floor(Math.random() * spots.length)] : null;
      if (pick) {
        const m = api.worldOf(pick[0]);
        if (m) {
          body.feet = [m[12], m[13] + 0.1, m[14]];
          body.yaw = Math.atan2(m[8], m[10]); // face the way the spawn point faces
          body.pitch = 0;
        }
      } else {
        const box = api.sceneBox();
        const c = box ? [(box.min[0] + box.max[0]) / 2, box.max[1] + 1, (box.min[2] + box.max[2]) / 2] : [0, 2, 0];
        body.feet = c;
        body.yaw = 0;
        body.pitch = 0;
      }
      body.vel = [0, 0, 0];
      body.onGround = false;
    }

    const walkWorld = {
      down: (from, max) => api.raycast(from, [0, -1, 0], { far: max })?.distance ?? null,
      ahead: (from, dir, max) => {
        const h = api.raycast(from, dir, { far: max });
        return h ? { distance: h.distance, normal: h.normal } : null;
      },
    };

    function eye() {
      return [body.feet[0], body.feet[1] + BODY.eye, body.feet[2]];
    }

    function placeCamera() {
      const e = eye();
      const d = lookDir(body.yaw, body.pitch);
      api.camera.set({ position: e, target: [e[0] + d[0], e[1] + d[1], e[2] + d[2]], fov: FOV, near: 0.05, far: 800 });
    }

    function tick(dt) {
      const input = {
        forward: (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0),
        strafe: (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
        run: keys.has("ShiftLeft") || keys.has("ShiftRight"),
        jump: keys.has("Space"),
      };
      const next = step(body, input, body.yaw, Math.min(dt, 0.05), walkWorld);
      Object.assign(body, next);
      if (body.feet[1] < BODY.fallLimit) spawn();
      if (reloadUntil && performance.now() >= reloadUntil) {
        reloadUntil = 0;
        ammo = MAG;
      }
      placeCamera();
      api.presence.set("avatar", { feet: body.feet.map((v) => +v.toFixed(3)), yaw: +body.yaw.toFixed(3), pitch: +body.pitch.toFixed(3) });
      pruneTracers();
      render();
    }

    function shoot() {
      const now = performance.now();
      if (now - lastShot < SHOT_MS || now < reloadUntil) return;
      if (ammo <= 0) return reload();
      lastShot = now;
      ammo--;
      const e = eye();
      const d = lookDir(body.yaw, body.pitch);
      const hit = api.raycast(e, d, { far: 300 });
      const to = hit ? hit.point : [e[0] + d[0] * 300, e[1] + d[1] * 300, e[2] + d[2] * 300];
      // from just below, right of and ahead of the eye, where a gun's muzzle would be
      const from = [e[0] + Math.cos(body.yaw) * 0.22 - Math.sin(body.yaw) * 0.55, e[1] - 0.22, e[2] - Math.sin(body.yaw) * 0.22 - Math.cos(body.yaw) * 0.55];
      tracer(from, to, hueOf(api.viewer));
      api.send("shot", { from, to });
      const o = hit ? scene?.objects?.[hit.id] : null;
      if (o && isTarget(o) && !isDown(o)) {
        hitUntil = now + HIT_MS;
        const yaw = body.yaw;
        api.change((dd) => {
          const t = dd.objects?.[hit.id];
          const tr = t?.traits?.[TARGET];
          if (!tr || isDown(t)) return; // someone got there first
          tr.stand = { rotation: [...(t.transform.rotation ?? [0, 0, 0])] };
          tr.down = { by: api.viewer, at: Date.now() };
          const fallen = knockedOver(t.transform, yaw);
          t.transform.position = fallen.position;
          t.transform.rotation = fallen.rotation;
        });
      }
      if (ammo === 0) reload();
      render();
    }

    function reload() {
      if (reloadUntil || ammo === MAG) return;
      reloadUntil = performance.now() + RELOAD_MS;
      render();
    }

    function resetTargets() {
      api.change((d) => standTargetsUp(d));
    }

    function turn(dx, dy) {
      const l = look(body.yaw, body.pitch, dx, dy);
      body.yaw = l.yaw;
      body.pitch = l.pitch;
    }

    /** Take the lock back after losing it (refused, lockLost says so and play goes on without it). */
    function resume() {
      Promise.resolve(api.relock()).catch(() => {});
    }

    /** The lock was refused: play on without it. */
    function onRefused() {
      if (!playing) return;
      free = true;
      paused = false;
      render();
    }

    function start() {
      if (playing) return;
      playing = true;
      paused = false;
      free = false;
      spawn();
      ammo = MAG;
      api.presence.rate(20);
      releaseCamera = api.camera.hold();
      // a bare session: a press while playing is a shot, never a drag
      const shotSession = { move() {}, end() {}, cancel() {}, tap: () => true };
      // without the lock: a drag looks around, a tap shoots
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
          tap() {
            shoot();
            return true;
          },
          cursor: "grabbing",
        };
      };
      disarm = api.arm(
        {
          move(ev) {
            if (!ev.locked || paused) return;
            turn(ev.dx ?? 0, ev.dy ?? 0);
          },
          press(ev) {
            if (paused) return null; // the resume button takes it
            // the other button reloads: no key of its own, so every key but walking's is the use prompt's
            if (ev.button === 2) reload();
            if (ev.button !== 0) return shotSession;
            if (!ev.locked) return lookSession(ev);
            shoot();
            return shotSession;
          },
          click: () => true,
          menu: () => true,
          wheel: () => true,
          // only play's own keys: F, R, E and the rest go on to the use prompt (a door's Open, a die's Roll)
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
            if (!keys.has(ev.code)) return false;
            keys.delete(ev.code);
            return true;
          },
          lockLost({ refused = false } = {}) {
            keys.clear();
            if (refused) return onRefused();
            paused = true; // lost (Esc): wait for a click
            render();
          },
          resumed() {
            paused = false;
            render();
          },
          disarmed() {
            if (playing) stop();
          },
          cursor: (ev) => (ev.locked ? "none" : "crosshair"),
        },
        // immersive: the editor's decorations (grid, axes) stand aside while playing
        { lock: true, replace: true, immersive: true },
      );
      stopLoop = api.loop((dt) => {
        if (!paused) tick(dt);
      });
      render();
    }

    function stop() {
      if (!playing) return;
      playing = false;
      paused = false;
      free = false;
      keys.clear();
      const d = disarm;
      disarm = null;
      d?.();
      stopLoop?.();
      stopLoop = null;
      releaseCamera?.();
      releaseCamera = null;
      api.presence.set("avatar", undefined);
      api.presence.rate(0);
      pruneLater(); // your last shots' tracers
      render();
    }

    // the lock was granted, or came back (a click on "carry on")
    const onLock = () => {
      if (!playing || !document.pointerLockElement) return;
      if (paused || free) {
        paused = false;
        free = false;
        render();
      }
    };
    api.listen(document, "pointerlockchange", onLock);
    // other players move between doc changes
    api.presence.watch(() => drawPeers());

    return {
      update(s, local, prev) {
        scene = s;
        if (s !== prev?.scene) render();
        drawPeers();
      },
      receive(type, data, from) {
        if (type !== "shot" || !Array.isArray(data?.from) || !Array.isArray(data?.to)) return;
        tracer(data.from, data.to, hueOf(from?.viewer ?? from?.session));
      },
      commands: [
        { id: "play", name: "Play", key: "Enter", show: ["toolbar", "menu"], state: () => (playing ? null : { title: "Walk the level in first person (Enter)" }), run: () => start() },
      ],
      hud: () => [],
      // only a laid-out level has the arena's look (see the top): adding a
      // target to a boat writes the level trait too, but not its look
      atmosphere: () => {
        const look = scene?.d?.traits?.["arena.level"]?.look;
        return typeof look === "string" && Object.hasOwn(LOOKS, look) ? LOOKS[look] : null;
      },
      dispose() {
        stop();
        for (const t of tracers) disposeTracer(t);
      },
    };
  },
};
