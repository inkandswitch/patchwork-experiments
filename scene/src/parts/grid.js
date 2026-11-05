// scene.grid: the ground grid, its ruler labels along X and Z, and the
// "grid 10 cm" caption in the corner, while the viewer's `grid` pref is on
// (ported from the old viewport's rebuildHelpers). The grid is sized to the
// scene in the current units (units.js gridFor), and its plane is given to
// the stage as an extent so the near plane never cuts it.

import css from "./grid.css?inline";
import { gridFor, roundForDisplay, toUnits } from "../units.js";

/** How far the scene reaches from the origin, horizontally (or half its height): what the grid must cover. */
export function sceneExtent(box) {
  if (!box) return 0.5;
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  return Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1), (y1 - y0) / 2);
}

/**
 * The ruler ticks along X and Z, where they stay in view when framed; the
 * last one on each side says the unit. Pure.
 * @param {{ step: number, divisions: number }} grid  gridFor's result
 * @returns {{ key, position, text, className, rank, data }[]}
 */
export function rulerLabels(grid, unit) {
  const out = [];
  const every = Math.max(1, Math.ceil(grid.divisions / 2 / 4));
  const lastI = Math.floor(grid.divisions / 2 / every) * every;
  for (let i = -lastI; i <= lastI; i += every) {
    if (i === 0) continue;
    const x = i * grid.step;
    const text = `${roundForDisplay(toUnits(x, unit))}${i === lastI ? ` ${unit}` : ""}`;
    out.push({ key: `x${i}`, position: [x, 0, 0], text, className: "grid-label", rank: 0, data: { axis: "x" } });
    out.push({ key: `z${i}`, position: [0, 0, x], text, className: "grid-label", rank: 0, data: { axis: "z" } });
  }
  return out;
}

export default {
  create(api) {
    const { THREE } = api;
    api.style(css);
    const layer = api.world();
    layer.userData.noPick = true;
    const labels = api.labels();
    const caption = document.createElement("div");
    caption.className = "grid-caption";
    caption.hidden = true;
    api.overlay().append(caption);

    const shown = () => api.pref("grid", true) !== false;
    // what's drawn: shown, and not while an immersive arm (first-person play) is on
    const drawn = () => shown() && !api.local.get().immersive;
    const color = (rgb, fallback) => (Array.isArray(rgb) ? new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace) : new THREE.Color(fallback));
    let key = null;

    function clear() {
      for (const c of [...layer.children]) {
        c.removeFromParent();
        c.geometry?.dispose?.();
        c.material?.dispose?.();
      }
    }

    function redraw(theme) {
      const on = drawn();
      const unit = api.pref("units", "m");
      const grid = gridFor(sceneExtent(api.sceneBox()), unit);
      const next = on ? JSON.stringify([unit, grid.size, grid.divisions]) : "off";
      if (next === key) return;
      key = next;
      clear();
      if (!on) {
        labels.set([]);
        caption.hidden = true;
        api.extent(null);
        api.invalidate();
        return;
      }
      const helper = new THREE.GridHelper(grid.size, grid.divisions, color(theme?.gridMajor, 0x999999), color(theme?.gridMinor, 0xd0d0d0));
      helper.material.transparent = true;
      helper.material.opacity = 0.8;
      helper.material.depthWrite = false;
      helper.renderOrder = -1;
      helper.raycast = () => {};
      layer.add(helper);
      const half = grid.size / 2;
      api.extent({ min: [-half, 0, -half], max: [half, 0, half] });
      labels.set(rulerLabels(grid, unit));
      caption.hidden = false;
      caption.textContent = `grid ${roundForDisplay(grid.stepInUnits)} ${unit}`;
      api.invalidate();
    }

    return {
      commands: [
        {
          id: "grid",
          name: "Grid",
          show: ["toolbar"],
          state: (target) => (target == null ? { checked: shown(), title: "Show the ground grid" } : null),
          run: () => api.setPref("grid", !shown()),
        },
      ],
      update(scene, local, prev) {
        // only a doc change, a content change (same scene and local) or a pref or theme change can move the grid
        const was = prev.local;
        const content = scene === prev.scene && local === was;
        if (was && scene === prev.scene && !content && local.prefs === was.prefs && local.theme === was.theme && local.immersive === was.immersive) return;
        if (was && local.theme !== was.theme) key = null;
        redraw(local.theme);
      },
      dispose() {
        clear();
      },
    };
  },
};
