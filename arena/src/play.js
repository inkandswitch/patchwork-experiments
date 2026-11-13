// Playing a level (the "arena" extension): a gun, and targets to shoot down,
// in whatever the scene is made of. Walking is the walk body's (the walk
// package, scene/TOOLS.md §4): this enters it, at a spawn point, when you
// walk in. The gun is a held tool: "Gun" (G) picks it up and Escape (the
// stage's ladder) puts it down; a click shoots, R reloads, and so does the
// other mouse button. Shooting is one more ray, and what counts as a target
// is a trait on an object, so a boat with a few targets on its deck is a
// level too.
//
// State lives where the scene's contract says it should:
// - doc: a target knocked over ({ down: { by, at }, stand: { rotation } }:
//   level.js isDown) and its fallen pose. Scores aren't stored; they're
//   counted from who knocked what down, so two players hitting one target at
//   once agree on whose it is.
// - sends: shots, so peers see the tracer; nobody keeps them.
// - local (this closure): ammo.
//
// A level also has a look: a sky, a light haze that hides the void past the
// walls, and a warm low sun that casts shadows (the stage's atmosphere). Only
// a laid-out level (its trait says look: "arena") gives it; a boat with a few
// targets on its deck keeps its own.

import css from "./play.css?inline";
import { isDown, knockedOver, standTargetsUp } from "./level.js";
import { resetCommand } from "./reset.js";

const TARGET = "arena.target";
/** The walk body's spawn point (the walk package's trait; arena's spawn part writes it). */
export const SPAWN = "walk.spawn";
const MAG = 12;
const RELOAD_MS = 1200;
const SHOT_MS = 110; // between shots
const HIT_MS = 260; // how long the hit marker shows
const FLASH_MS = 60; // how long a muzzle flash shows
/** The keys the gun takes while it's held: R reloads. */
export const GUN_KEYS = Object.freeze([{ code: "KeyR", label: "Reload" }]);

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

    let holding = false; // the gun is the held tool
    let ammo = MAG;
    let reloadUntil = 0;
    let lastShot = 0;
    let hitUntil = 0;
    let scene = null;
    const names = new Map(); // viewer → name (contact docs, looked up once)

    // ─── drawing ──────────────────────────────────────────────────────────
    const world = api.world();
    const tracers = []; // { line, flash, until, flashUntil }

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
      const now = api.clock.now();
      tracers.push({ line, flash, until: now + 120, flashUntil: now + FLASH_MS });
      api.invalidate();
      pruneLater();
    }
    let tracerLoop = null;

    function pruneLater() {
      if (tracerLoop || (!tracers.length && !holding)) return;
      tracerLoop = api.loop(() => {
        pruneTracers();
        if (holding) render();
        if (tracers.length || holding) return;
        const off = tracerLoop;
        tracerLoop = null;
        off?.();
        api.invalidate();
      });
    }

    function pruneTracers() {
      const now = api.clock.now();
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
      const now = api.clock.now();
      const reloading = now < reloadUntil;
      const walking = api.local.get()?.body?.id === "walk";
      const key = JSON.stringify([holding, walking, standing, targets.length, board, ammo, reloading, hitUntil > now ? hitUntil : 0, [...names]]);
      if (key === hudKey) return;
      hudKey = key;
      const scoreList = el("ol", { class: "arena-scores" }, ...board.slice(0, 6).map(([viewer, n]) => el("li", { "data-you": viewer === api.viewer }, el("span", {}, nameOf(viewer)), el("strong", {}, String(n)))));
      const show = (...kids) => hud.replaceChildren(...kids.filter((k) => k != null));
      if (!holding) {
        // the start bar with the scores under it, in one column (so a narrow view wraps rather than overlaps)
        show(
          el(
            "div",
            { class: "arena-lobby" },
            el(
              "div",
              { class: "arena-start" },
              el("button", { type: "button", class: "arena-play", onclick: () => start() }, walking ? "▶ Pick up the gun" : "▶ Play"),
              // a level without targets (an imported map) has nothing to count
              targets.length ? el("span", { class: "arena-count" }, `${standing} of ${targets.length} targets standing`) : null,
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
        targets.length || board.length ? el("div", { class: "arena-top" }, targets.length ? el("span", {}, `${standing} of ${targets.length} standing`) : null, board.length ? scoreList : null) : null,
        el("div", { class: "arena-ammo", "data-empty": ammo === 0 }, reloading ? "Reloading…" : `${ammo} / ${MAG}`),
        el("div", { class: "arena-help" }, "Click shoot · R or right-click reload · Esc put the gun down"),
      );
    }

    // ─── the gun ──────────────────────────────────────────────────────────

    /** Shoot along a ray ({ origin, dir }, world): the pointer's, or the eye's under lock. */
    function shoot(ray) {
      const now = api.clock.now();
      if (now - lastShot < SHOT_MS || now < reloadUntil) return;
      if (ammo <= 0) return reload();
      const e = ray?.origin ?? api.body?.eye?.()?.position;
      const d = ray?.dir ?? api.body?.eye?.()?.direction;
      if (!Array.isArray(e) || !Array.isArray(d)) return;
      lastShot = now;
      ammo--;
      const hit = api.raycast(e, d, { far: 300 });
      const to = hit ? hit.point : [e[0] + d[0] * 300, e[1] + d[1] * 300, e[2] + d[2] * 300];
      const yaw = Math.atan2(-d[0], -d[2]);
      // from just below, right of and ahead of the eye, where a gun's muzzle would be
      const from = [e[0] + Math.cos(yaw) * 0.22 - Math.sin(yaw) * 0.55, e[1] - 0.22, e[2] - Math.sin(yaw) * 0.22 - Math.cos(yaw) * 0.55];
      tracer(from, to, hueOf(api.viewer));
      api.send("shot", { from, to });
      const o = hit ? scene?.objects?.[hit.id] : null;
      if (o && isTarget(o) && !isDown(o)) {
        hitUntil = now + HIT_MS;
        api.change((dd) => {
          const t = dd.objects?.[hit.id];
          const tr = t?.traits?.[TARGET];
          if (!tr || isDown(t)) return; // someone got there first
          tr.stand = { rotation: [...(t.transform.rotation ?? [0, 0, 0])] };
          tr.down = { by: api.viewer, at: api.clock.now() };
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
      reloadUntil = api.clock.now() + RELOAD_MS;
      api.clock.after(RELOAD_MS, () => {
        reloadUntil = 0;
        ammo = MAG;
        render();
      });
      render();
    }

    function resetTargets() {
      api.change((d) => standTargetsUp(d));
    }

    // a bare session: a press the gun took is a shot (or a reload), never a drag
    const bare = { move() {}, end() {}, cancel() {}, tap: () => true };
    // the gun's input, while it's the held tool: under the lock a press
    // shoots at once; without it a press is the body's (a walk drags to look)
    // and a tap comes back as a click, which shoots
    const gun = {
      press(ev) {
        if (ev.button === 2) {
          reload();
          return bare;
        }
        if (ev.button !== 0 || !ev.locked) return null;
        shoot(ev.ray);
        return bare;
      },
      click(ev) {
        shoot(ev.ray);
        return true;
      },
      // the other button reloads: no menu while the gun is held
      menu: () => true,
      key(ev) {
        if (ev.code !== "KeyR") return false;
        reload();
        return true;
      },
      cursor: (ev) => (ev.locked ? "none" : "crosshair"),
      put() {
        holding = false;
        render();
      },
    };

    /** Walk in (at a spawn point) with the gun in hand. */
    function start() {
      if (api.local.get()?.body?.id !== "walk") {
        const spots = Object.entries(scene?.objects ?? {}).filter(([, o]) => o?.traits?.[SPAWN]).map(([id]) => id);
        const spot = spots.length ? spots[Math.floor(Math.random() * spots.length)] : null;
        if (!api.body.enter("walk", spot)) api.notify("Walking needs the walk package; you can still shoot from here.");
      }
      if (!holding) api.run({ ext: api.id, command: "gun" });
    }

    return {
      update(s, local, prev) {
        scene = s;
        if (s !== prev?.scene || local?.body !== prev?.local?.body) render();
      },
      receive(type, data, from) {
        if (type !== "shot" || !Array.isArray(data?.from) || !Array.isArray(data?.to)) return;
        tracer(data.from, data.to, hueOf(from?.viewer ?? from?.session));
      },
      commands: [
        { id: "play", name: "Play", key: "Enter", show: ["toolbar", "menu"], state: (t) => (t == null && !holding ? { title: "Walk the level with the gun" } : null), run: () => start() },
        {
          // a tool: its run's input goes in the stage's one slot
          id: "gun",
          name: "Gun",
          key: "g",
          tool: { keys: GUN_KEYS },
          show: ["toolbar", "menu"],
          state: (t) => (t == null ? { checked: holding, title: "The gun: a click shoots, R reloads" } : null),
          run() {
            holding = true;
            ammo = MAG;
            pruneLater();
            render();
            return gun;
          },
        },
        resetCommand(api),
      ],
      // only a laid-out level has the arena's look (see the top): adding a
      // target to a boat writes the level trait too, but not its look
      atmosphere: () => {
        const look = scene?.d?.traits?.["arena.level"]?.look;
        return typeof look === "string" && Object.hasOwn(LOOKS, look) ? LOOKS[look] : null;
      },
      dispose() {
        tracerLoop?.();
        for (const t of tracers) disposeTracer(t);
      },
    };
  },
};
