// walk.people: everyone else who walks, drawn where their presence says they
// stand (`avatar`: { feet, yaw, pitch }, which the walk body says 20 Hz on
// the channel of the doc it walks in, in that doc's frame: body.js), named
// from their contact docs.
//
// A part of every doc (traits ["*"]), so the stage runs it in every stage,
// as that doc's own part, whatever the focus: someone walking a boat's deck
// is seen from inside the game on her table, in the boat's frame
// (scene/COMPOSITION.md §3, "Presence where it is"). A pin has no channel,
// so it draws nobody; a mirror hears its doc's, so it draws them again, as
// it draws everything else of its doc. This view is never drawn: its walker
// is the camera.

/** whose presence says where someone walks: the walk body's part (extension.js) */
const WALK = "walk";

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

  function drawPeers() {
    const seen = new Set();
    const items = [];
    for (const [session, p] of Object.entries(api.presence.get() ?? {})) {
      if (session === api.session) continue;
      const av = p?.keys?.[WALK]?.avatar;
      if (!av || !Array.isArray(av.feet)) continue;
      seen.add(session);
      const a = avatarFor(session, hueOf(p.viewer ?? session));
      a.group.position.set(av.feet[0], av.feet[1], av.feet[2]);
      a.group.rotation.set(0, av.yaw ?? 0, 0);
      items.push({ key: session, text: nameOf(p.viewer), position: [av.feet[0], av.feet[1] + 2.05, av.feet[2]], className: "walk-name", rank: 1 });
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

  // the others move between doc changes
  api.presence.watch(() => drawPeers());

  return {
    update: () => drawPeers(),
    dispose() {
      for (const a of avatars.values()) a.group.removeFromParent();
      avatars.clear();
    },
  };
}

export default { create };
