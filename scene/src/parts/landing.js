// Where a copy from another scene (or a duplicate) lands in a view: the parts
// bin's rule (./parts-place.js), shared by scene.transfer (a drop in the view,
// Paste) and the outline (another scene's row dropped in the tree). STAGE.md,
// "Copying objects".
//
//   - at(x, y): where the pointer hits. On an object it goes under that
//     object and snaps to the nearest of its connectors that takes it; on
//     the ground, under nothing.
//   - ahead(): where the view is looking (its middle). Under the object hit
//     only when it snaps to one of its connectors; else on the surface
//     there, under nothing. A repeat (`step`, `from`: the first one's spot)
//     goes that far along world x from the first, onto whatever is under
//     that spot, without picking again (the view's middle may now be the
//     first copy's side).
//   - on(id): onto an object named in the tree: the nearest of its connectors
//     that takes it, whatever the distance; else on the object, at its origin.
//
// A landing is { point, yaw, parent, parentWorld, snapped, spot }: `yaw` null
// keeps the heading the copy had (on the ground it was facing somewhere
// already).

import { isGroup } from "../groups.js";
import { connectorFor, partLanding } from "./parts-place.js";
import { yawOfMatrix } from "./hand-carry.js";

export function landings(api) {
  const objectFor = (id) => {
    const o = id ? api.scene().objects[id] : null;
    return o && !isGroup(o) ? id : null;
  };
  const worldOf = (id) => api.worldOf?.(id) ?? api.scene().world(id);
  function parentInfo(id) {
    const matrix = id ? worldOf(id) : null;
    if (!matrix) return null;
    const extras = api.content?.(id)?.extras;
    return { id, matrix, connectors: extras?.connectors ?? [], snapRadius: extras?.snapRadius ?? null };
  }
  const snapOff = (free) => !!free || api.pref?.("snap", true) === false;

  /** From a hit: `attach` "hit" (under the object hit) or "snapped" (only when it snaps to it). */
  function from(hit, tags, free, attach = "hit") {
    const parent = parentInfo(objectFor(hit.id));
    const land = partLanding({ point: hit.point, parent, tags, eye: null, free: snapOff(free) });
    const on = parent && (attach === "hit" || land.snapped) ? parent : null;
    return { point: land.spot, yaw: on ? land.yaw : null, parent: on?.id ?? null, parentWorld: on?.matrix ?? null, snapped: land.snapped, spot: land.spot };
  }

  function pick(x, y) {
    try {
      return api.pick(x, y, { ground: true });
    } catch {
      return null;
    }
  }
  function down(x, z) {
    try {
      return api.raycast([x, 1e3, z], [0, -1, 0], { far: 2e3 });
    } catch {
      return null;
    }
  }

  function at(x, y, tags, free) {
    const hit = pick(x, y);
    return hit?.point ? from(hit, tags, free) : null;
  }

  function ahead(tags, { step = 0, from: first = null } = {}) {
    if (step && Array.isArray(first)) {
      const x = first[0] + step;
      const z = first[2];
      const h = down(x, z);
      const point = [x, h?.point ? h.point[1] : 0, z];
      return { point, yaw: null, parent: null, parentWorld: null, snapped: false, spot: point };
    }
    const port = api.port;
    let hit = pick((port?.clientWidth || 0) / 2, (port?.clientHeight || 0) / 2);
    if (!hit?.point) {
      const t = api.camera?.get?.()?.target ?? [0, 0, 0];
      const h = down(t[0], t[2]);
      hit = h?.point ? h : { id: null, point: [t[0], 0, t[2]] };
    }
    const land = from(hit, tags, false, "snapped");
    if (land.snapped || !step) return land;
    // a repeat: beside the last one, on whatever is under it there (else the ground)
    const x = land.point[0] + step;
    const z = land.point[2];
    const h = down(x, z);
    const point = [x, h?.point ? h.point[1] : 0, z];
    return { ...land, point, spot: point };
  }

  function on(id, tags, free) {
    const parent = parentInfo(objectFor(id));
    if (!parent) return null;
    const m = parent.matrix;
    const origin = [m[12], m[13], m[14]];
    const snap = snapOff(free) ? null : connectorFor({ ...parent, snapRadius: Infinity }, origin, tags);
    if (snap) return { point: snap.world, yaw: snap.yaw ?? yawOfMatrix(m), parent: id, parentWorld: m, snapped: true, spot: snap.world };
    // on top of it at its origin, if a look straight down finds it there
    const h = down(origin[0], origin[2]);
    const point = h?.point && h.id === id ? h.point : origin;
    return { point, yaw: yawOfMatrix(m), parent: id, parentWorld: m, snapped: false, spot: point };
  }

  return { at, ahead, on, from };
}
