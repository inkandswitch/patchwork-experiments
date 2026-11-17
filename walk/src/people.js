// walk.people: everyone else who walks, drawn where their presence says they
// stand (`avatar`: { on, feet, yaw, pitch, swimming }, which the walk body
// says 20 Hz on the channel of the doc it walks in: body.js), named from
// their contact docs. `feet` and `yaw` are in the frame of the support `on`
// (null: the doc's own frame), so each is drawn in that support's drawn
// frame every frame, eased toward the latest record in that frame and
// snapped when `on` changes (DESIGN.md, "Presence"). A record whose support
// isn't in this doc draws nobody.
//
// A part of every doc (traits ["*"]), so the stage runs it in every stage,
// as that doc's own part, whatever the focus: someone walking a boat's deck
// is seen from inside the game on her table, in the boat's frame
// (scene/COMPOSITION.md §3, "Presence where it is"). A pin has no channel,
// so it draws nobody; a mirror hears its doc's, so it draws them again, as
// it draws everything else of its doc. This view is never drawn: its walker
// is the camera.
//
// Someone under a body of their own at a stand spot (a boat's station) says
// no avatar; they are drawn standing at the spot whose \`walk.stand\` names
// the claim they hold there (\`standing\`).

import { apply, headingOf, scaleOf } from "./frames.js";
import { STAND, frameOf, ownerOf, seedsOf } from "./supports.js";

/** whose presence says where someone walks: the walk body's part (extension.js) */
const WALK = "walk";
/** How fast an avatar closes on its latest record (1/s). */
const EASE = 12;

/** The shorter way round from angle a to b. */
const turnTo = (a, b) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * An avatar closing on a peer's latest record (pure): eased in the record's
 * frame, snapped when the frame changes (stepping onto a deck, falling off).
 * @param {{ on, feet, yaw, pitch } | null} prev
 * @param {{ on, feet, yaw, pitch }} rec
 */
export function ease(prev, rec, dt, rate = EASE) {
  const target = { on: rec.on ?? null, feet: [...rec.feet], yaw: Number(rec.yaw) || 0, pitch: Number(rec.pitch) || 0 };
  if (!prev?.feet || prev.on !== target.on) return target;
  const k = 1 - Math.exp(-rate * Math.max(0, dt));
  return {
    on: target.on,
    feet: prev.feet.map((v, i) => v + (target.feet[i] - v) * k),
    yaw: prev.yaw + (turnTo(prev.yaw, target.yaw) - prev.yaw) * k,
    pitch: prev.pitch + (target.pitch - prev.pitch) * k,
  };
}

/** Where an avatar stands in the world: through its support's frame (`frame(on)`), or the doc's. null when its support isn't here. */
export function placeOf(a, frame) {
  if (a.on == null) return { feet: a.feet, yaw: a.yaw };
  const m = frame(a.on);
  return m ? { feet: apply(m, a.feet), yaw: a.yaw + headingOf(m) } : null;
}

/**
 * Who stands at a stand spot by its claim (DESIGN.md, "Presence under a
 * body"): for each \`walk.stand\` naming a \`claim\` kind, whoever holds that
 * claim on its object, as a record in its owner's frame: at the spot,
 * facing its \`facing\` (seedsOf's stand seed, placed by the doc). Pure over
 * the scene, \`claimedBy(id, kind)\` and \`scale(owner)\` (the owner's drawn
 * scale; the ground's 1). Mine are left out.
 * @returns {Array<{ session, viewer, rec: { on, feet, yaw, pitch } }>}
 */
export function standing(scene, claimedBy, scale) {
  const out = [];
  for (const id of Object.keys(scene?.objects ?? {}).sort()) {
    const kind = scene.objects[id]?.traits?.[STAND]?.claim;
    if (typeof kind !== "string" || !kind) continue;
    const by = claimedBy(id, kind);
    if (!by?.session || by.mine) continue;
    const on = ownerOf(scene, id);
    const seed = seedsOf(scene, on, scale(on)).find((sd) => sd.kind === "stand" && sd.id === id);
    if (seed) out.push({ session: by.session, viewer: by.viewer ?? null, rec: { on, feet: [...seed.at], yaw: seed.yaw + 0, pitch: 0 } });
  }
  return out;
}

/** A stable hue for a person. */
export function hueOf(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** The others walking in this api's doc, drawn in its frame. */
function create(api) {
  const THREE = api.THREE;
  const world = api.world();
  const labels = api.labels();
  const avatars = new Map(); // session → { group }
  const names = new Map(); // viewer → name (contact docs, looked up once)
  const noRay = () => {};

  function nameOf(viewer) {
    if (!viewer) return "Someone";
    if (names.has(viewer)) return names.get(viewer) ?? "Someone";
    names.set(viewer, null);
    if (String(viewer).startsWith("automerge:")) {
      Promise.resolve(api.repo?.find?.(viewer))
        .then((h) => {
          const n = h?.doc?.()?.name;
          if (n) names.set(viewer, String(n));
          drawPeers();
        })
        .catch(() => {});
    }
    return "Someone";
  }

  function avatarFor(session, hue) {
    let a = avatars.get(session);
    if (a) return a;
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.6, 0.55), roughness: 0.6 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.2, 16), mat);
    torso.position.y = 0.75;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), mat);
    head.position.y = 1.55;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    visor.position.set(0, 1.58, -0.2);
    group.add(torso, head, visor);
    // never picked, never in a ray's way: not the prompt's, not a walker's floor
    group.traverse((o) => {
      o.userData.noPick = true;
      o.raycast = noRay;
    });
    world.add(group);
    a = { group };
    avatars.set(session, a);
    return a;
  }

  const okRecord = (r) => !!r && Array.isArray(r.feet) && r.feet.length === 3 && r.feet.every(Number.isFinite);
  let last = null; // the stage's time (ms) of the last draw
  let stopLoop = null;

  function drawPeers() {
    const now = api.clock?.now?.() ?? 0;
    const dt = last == null ? 0 : (now - last) / 1000;
    last = now;
    const seen = new Set();
    const items = [];
    for (const [session, p] of Object.entries(api.presence.get() ?? {})) {
      if (session === api.session) continue;
      const rec = p?.keys?.[WALK]?.avatar;
      if (!okRecord(rec)) continue;
      const a = avatarFor(session, hueOf(p.viewer ?? session));
      a.eased = ease(a.eased, rec, dt);
      const at = placeOf(a.eased, (id) => frameOf(api, id));
      if (!at) continue;
      seen.add(session);
      a.group.position.set(at.feet[0], at.feet[1], at.feet[2]);
      a.group.rotation.set(0, at.yaw, 0);
      items.push({ key: session, text: nameOf(p.viewer), position: [at.feet[0], at.feet[1] + 2.05, at.feet[2]], className: "walk-name", rank: 1 });
    }
    // and whoever stands at a stand spot under a body of their own (a station), by its claim
    const scale = (on) => (on == null ? 1 : scaleOf(api.worldOf?.(on) ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
    for (const { session, viewer, rec } of standing(api.scene?.(), (id, kind) => api.claimedBy?.(id, kind) ?? null, scale)) {
      if (seen.has(session) || session === api.session) continue;
      const a = avatarFor(session, hueOf(viewer ?? session));
      a.eased = ease(a.eased, rec, dt);
      const at = placeOf(a.eased, (id) => frameOf(api, id));
      if (!at) continue;
      seen.add(session);
      a.group.position.set(at.feet[0], at.feet[1], at.feet[2]);
      a.group.rotation.set(0, at.yaw, 0);
      items.push({ key: session, text: nameOf(viewer), position: [at.feet[0], at.feet[1] + 2.05, at.feet[2]], className: "walk-name", rank: 1 });
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
    // while anyone is drawn, every frame: they ease, and their supports move
    if (avatars.size && !stopLoop) stopLoop = api.loop?.(() => drawPeers()) ?? null;
    else if (!avatars.size && stopLoop) (stopLoop(), (stopLoop = null));
  }

  // the others move between doc changes
  api.presence.watch(() => drawPeers());

  return {
    update: () => drawPeers(),
    dispose() {
      stopLoop?.();
      stopLoop = null;
      for (const a of avatars.values()) a.group.removeFromParent();
      avatars.clear();
    },
  };
}

export default { create };
