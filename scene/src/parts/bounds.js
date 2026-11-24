// scene.bounds: each object's bounding box and its X/Y/Z size in the current
// units, while the viewer's `bounds` pref is on and the Edit hand is held (ported from the old
// viewport's rebuildHelpers). With an object selected only its sizes are
// labelled, and no box is drawn for it (the selection draws its own); a
// selection that isn't an object (a dimension's ref) counts as none;
// otherwise every shown object gets a faint box and its sizes. Boxes are of
// loaded geometry only (no hints), from api.box.

import { EDIT } from "./editing.js";
import { whileHolding } from "../stage/public.js";
import { perFocus } from "../per-focus.js";
import css from "./bounds.css?inline";
import { formatLength } from "../units.js";
import { isGroup } from "../groups.js";

/** The size labels for one box, at the middle of three of its edges. Pure. */
export function sizeLabels(id, box, unit) {
  const { min, max } = box;
  const mid = [0, 1, 2].map((i) => (min[i] + max[i]) / 2);
  const size = [0, 1, 2].map((i) => max[i] - min[i]);
  return [
    { key: `${id}:x`, position: [mid[0], min[1], max[2]], text: formatLength(size[0], unit), className: "bounds-label", rank: 1, data: { axis: "x" } },
    { key: `${id}:y`, position: [max[0], mid[1], max[2]], text: formatLength(size[1], unit), className: "bounds-label", rank: 1, data: { axis: "y" } },
    { key: `${id}:z`, position: [max[0], min[1], mid[2]], text: formatLength(size[2], unit), className: "bounds-label", rank: 1, data: { axis: "z" } },
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
    // its layer and labels are the focus stage's, in its frame: made again where the focus goes
    const at = perFocus(api, (f) => {
      const layer = f.world();
      layer.userData.noPick = true;
      return { f, layer, labels: f.labels() };
    });
    const pref = (key, fallback) => api.use("prefs")?.get(key, fallback) ?? fallback;
    const shown = () => pref("bounds", false) === true;

    function clear(layer) {
      for (const c of [...layer.children]) {
        c.removeFromParent();
        c.geometry?.dispose?.();
        c.material?.dispose?.();
      }
    }

    /** The boxes as drawn while the Edit hand is held (the aids are the editor's). */
    function bounds() {
      let key = null;
      let drawnAt = null; // the focus's layer it drew in
      const undraw = () => {
        if (!drawnAt) return;
        clear(drawnAt.layer);
        drawnAt.labels.set([]);
        api.invalidate();
      };
      function redraw(scene, view) {
        const here = at();
        if (!here) return;
        if (here !== drawnAt) key = null;
        const { f, layer, labels } = here;
        const on = shown();
        const unit = pref("units", "m");
        const selected = view.selected ?? null;
        const items = [];
        const boxes = [];
        if (on) {
          for (const id of boundsTargets(scene, selected)) {
            const b = f.box(id, { hints: false });
            if (!b) continue;
            items.push(...sizeLabels(id, b, unit));
            if (id !== selected) boxes.push(b);
          }
        }
        const next = JSON.stringify([unit, items.map((i) => [i.key, i.position]), boxes, view.theme?.muted]);
        if (next === key) return;
        key = next;
        undraw();
        drawnAt = here;
        const m = view.theme?.muted;
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
      // a displayed pose (a carry, a hull under way) moves boxes without a doc change: look after each frame
      const offFrame = api.afterRender(() => shown() && at() && redraw(at().f.scene(), api.view.get()));
      return {
        update(scene, local, prev, view) {
          const was = prev.view;
          const content = scene === prev.scene && local === prev.local && view === was;
          if (key != null && was && scene === prev.scene && !content && view["scene.prefs"] === was["scene.prefs"] && view.theme === was.theme && view.selected === was.selected) return;
          redraw(scene, view);
        },
        dispose() {
          offFrame();
          undraw();
        },
      };
    }
    const drawn = whileHolding(api, EDIT, bounds);

    return {
      commands: [
        {
          id: "bounds",
          hand: "edit",
          name: "Bounds",
          group: "view",
          icon: "bounds",
          show: ["toolbar"],
          state: (target) => (target == null ? { checked: shown(), title: "Show bounding boxes and sizes" } : null),
          run: () => api.use("prefs")?.set("bounds", !shown()),
        },
      ],
      update: (...args) => drawn()?.update(...args),
    };
  },
};
