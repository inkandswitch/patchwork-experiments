// scene.bounds: each object's bounding box and its X/Y/Z size in the current
// units, while the viewer's `bounds` pref is on (ported from the old
// viewport's rebuildHelpers). With something selected only its sizes are
// labelled, and no box is drawn for it (the selection draws its own);
// otherwise every shown object gets a faint box and its sizes. Boxes are of
// loaded geometry only (no hints), from api.box.

import css from "./bounds.css?inline";
import { formatLength } from "../units.js";
import { isGroup } from "../groups.js";

/** The size labels for one box, at the middle of three of its edges. Pure. */
export function sizeLabels(id, box, unit) {
  const { min, max } = box;
  const mid = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  const size = [0, 1, 2].map((i) => max[i] - min[i]);
  return [
    { key: `${id}:x`, position: [mid[0], min[1], max[2]], text: formatLength(size[0], unit), className: "bounds-label", data: { axis: "x" } },
    { key: `${id}:y`, position: [max[0], mid[1], max[2]], text: formatLength(size[1], unit), className: "bounds-label", data: { axis: "y" } },
    { key: `${id}:z`, position: [max[0], min[1], mid[2]], text: formatLength(size[2], unit), className: "bounds-label", data: { axis: "z" } },
  ];
}

/** Which ids get sizes: the selection if it's there, else every object (not groups). Pure. */
export function boundsTargets(scene, selected) {
  if (selected != null && scene.objects[selected]) return [selected];
  return scene.ids.filter((id) => scene.objects[id] && !isGroup(scene.objects[id]));
}

export default {
  create(api) {
    const { THREE } = api;
    api.style(css);
    const layer = api.world();
    layer.userData.noPick = true;
    const labels = api.labels();
    const shown = () => api.pref("bounds", false) === true;
    let key = null;

    function clear() {
      for (const c of [...layer.children]) {
        c.removeFromParent();
        c.geometry?.dispose?.();
        c.material?.dispose?.();
      }
    }

    function redraw(scene, local) {
      const on = shown();
      const unit = api.pref("units", "m");
      const selected = local.selected ?? null;
      const items = [];
      const boxes = [];
      if (on) {
        for (const id of boundsTargets(scene, selected)) {
          const b = api.box(id, { hints: false });
          if (!b) continue;
          items.push(...sizeLabels(id, b, unit));
          if (id !== selected) boxes.push(b);
        }
      }
      const next = JSON.stringify([unit, items.map((i) => [i.key, i.position]), boxes, local.theme?.muted]);
      if (next === key) return;
      key = next;
      clear();
      const m = local.theme?.muted;
      const col = Array.isArray(m) ? new THREE.Color().setRGB(m[0], m[1], m[2], THREE.SRGBColorSpace) : new THREE.Color(0x808080);
      for (const b of boxes) {
        const h = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)), col);
        h.material.depthTest = false;
        h.material.transparent = true;
        h.material.opacity = 0.7;
        h.raycast = () => {};
        layer.add(h);
      }
      labels.set(items);
      api.invalidate();
    }

    return {
      commands: [
        {
          id: "bounds",
          name: "Bounds",
          show: ["toolbar"],
          state: (target) => (target == null ? { checked: shown(), title: "Show bounding boxes and sizes" } : null),
          run: () => api.setPref("bounds", !shown()),
        },
      ],
      update(scene, local, prev) {
        const was = prev.local;
        const content = scene === prev.scene && local === was;
        if (was && scene === prev.scene && !content && local.prefs === was.prefs && local.theme === was.theme && local.selected === was.selected) return;
        redraw(scene, local);
      },
      dispose() {
        clear();
      },
    };
  },
};
