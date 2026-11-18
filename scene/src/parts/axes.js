// scene.axes: the world axes (X, Y, Z lines from the origin, with labels just
// past their ends) and the orientation triad in the bottom-left corner, while
// the viewer's `axes` pref is on. The triad is its own small orthographic
// scene, drawn after the main pass in a scissored corner (api.afterRender),
// turned with the camera; its X/Y/Z labels go on screen through api.labels.

import { editing } from "../stage/bodies.js";
import { perFocus } from "./per-focus.js";
import css from "./axes.css?inline";
import { gridFor } from "../units.js";

const TRIAD_PX = 96;
const TRIAD_PAD = 8;
const AXES = ["x", "y", "z"];

/** How far the scene reaches from the origin, horizontally (or half its height). */
function sceneExtent(box) {
  if (!box) return 0.5;
  const [x0, y0, z0] = box.min;
  const [x1, y1, z1] = box.max;
  return Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1), (y1 - y0) / 2);
}

/** How long the axes are: to the grid's edge when the grid is on, else a little past the scene. Pure. */
export function axisLength(box, { grid, unit }) {
  const extent = sceneExtent(box);
  return grid ? gridFor(extent, unit).size / 2 : Math.max(extent * 1.2, 0.1);
}

/** The world axes' labels, just past each line's end (so not on the last ruler tick). Pure. */
export function axisLabels(len) {
  return AXES.map((axis, i) => {
    const at = [0, 0, 0];
    at[i] = len * 1.07;
    return { key: axis, position: at, text: axis.toUpperCase(), className: "axis-label", rank: 2, data: { axis } };
  });
}

/**
 * Where the triad's labels go on screen (port px), from where its tips
 * project in its own camera ([-1, 1] ndc). Pure.
 * @param {{ x: number, y: number }[]} tips  ndc of the X, Y and Z tips
 * @param {number} height  the port's height
 */
export function triadLabels(tips, height) {
  return AXES.map((axis, i) => ({
    key: `triad-${axis}`,
    text: axis.toUpperCase(),
    className: "triad-label",
    rank: 2,
    data: { axis },
    screen: { x: TRIAD_PAD + ((tips[i].x + 1) / 2) * TRIAD_PX, y: height - TRIAD_PAD - ((tips[i].y + 1) / 2) * TRIAD_PX },
  }));
}

export default {
  create(api) {
    const { THREE } = api;
    api.style(css);
    let key = null;
    let triadKey = "";
    // its layer and labels are the focus stage's, in its frame: made again where the focus goes
    const at = perFocus(api, (f) => {
      const layer = f.world();
      layer.userData.noPick = true;
      key = null;
      triadKey = "";
      return { f, layer, labels: f.labels() };
    });
    const color = (rgb, fallback) => (Array.isArray(rgb) ? new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace) : new THREE.Color(fallback));
    const FALLBACK = [0xd03030, 0x30b040, 0x3060e0];
    const axisColors = (theme) => [theme?.axisX, theme?.axisY, theme?.axisZ].map((c, i) => color(c, FALLBACK[i]));

    // One label set (the focus facet's labels()), so the axes' and the triad's are set together.
    let axisItems = [];
    let triadItems = [];
    const pushLabels = () => at()?.labels.set([...axisItems, ...triadItems]);

    const pref = (key, fallback) => api.use("prefs")?.get(key, fallback) ?? fallback;
    const shown = () => pref("axes", true) !== false;
    // what's drawn: shown, and only while editing (the aids are the editor's: ../stage/bodies.js)
    const drawn = () => shown() && editing(api.view.get());
    let theme = null;

    const dispose3 = (root) =>
      root.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    const clearGroup = (g) => {
      for (const c of [...g.children]) {
        c.removeFromParent();
        dispose3(c);
      }
    };
    const segment = (to, col, extra = {}) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, ...to], 3));
      return new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, ...extra }));
    };

    // ─── the world axes ──────────────────────────────────────────────────────

    function redraw() {
      const here = at();
      if (!here) return;
      const { f, layer } = here;
      const on = drawn();
      const len = on ? axisLength(f.sceneBox(), { grid: pref("grid", true) !== false, unit: pref("units", "m") }) : 0;
      const next = `${on}|${len}`;
      if (next === key) return;
      key = next;
      clearGroup(layer);
      axisItems = [];
      if (on) {
        const cols = axisColors(theme);
        AXES.forEach((_, i) => {
          const end = [0, 0, 0];
          end[i] = len;
          const line = segment(end, cols[i], { depthTest: false, transparent: true });
          line.renderOrder = 1;
          line.raycast = () => {};
          layer.add(line);
        });
        axisItems = axisLabels(len);
      }
      pushLabels();
      api.invalidate();
    }

    // ─── the triad ───────────────────────────────────────────────────────────

    const triadScene = new THREE.Scene();
    const triadCamera = new THREE.OrthographicCamera(-1.35, 1.35, 1.35, -1.35, 0.1, 10);
    const triad = new THREE.Group();
    triadScene.add(triad);
    const dir = new THREE.Vector3();
    const tip = new THREE.Vector3();
    let offTriad = null;

    function buildTriad() {
      clearGroup(triad);
      const cols = axisColors(theme);
      const up = new THREE.Vector3(0, 1, 0);
      AXES.forEach((_, i) => {
        const d = new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
        const shaft = segment(d.toArray(), cols[i]);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 16), new THREE.MeshBasicMaterial({ color: cols[i] }));
        cone.position.copy(d);
        cone.quaternion.setFromUnitVectors(up, d);
        triad.add(shaft, cone);
      });
    }

    function drawTriad(renderer, size) {
      // the camera in this stage's frame (the focus doc's: the axes of what's being edited), turned and rolled as it is
      const cam = at()?.f.camera.get();
      if (!cam?.position || !cam.target) return;
      dir.fromArray(cam.position).sub(tip.fromArray(cam.target));
      if (dir.lengthSq() < 1e-18) return;
      dir.normalize();
      triadCamera.position.copy(dir).multiplyScalar(4);
      triadCamera.up.fromArray(cam.up ?? [0, 1, 0]);
      triadCamera.lookAt(0, 0, 0);
      triadCamera.updateMatrixWorld();
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.setScissorTest(true);
      renderer.setScissor(TRIAD_PAD, TRIAD_PAD, TRIAD_PX, TRIAD_PX);
      renderer.setViewport(TRIAD_PAD, TRIAD_PAD, TRIAD_PX, TRIAD_PX);
      renderer.render(triadScene, triadCamera);
      // the stage puts the scissor, viewport and autoClear back after each hook
      const tips = AXES.map((_, i) => {
        tip.set(i === 0 ? 1.27 : 0, i === 1 ? 1.27 : 0, i === 2 ? 1.27 : 0).project(triadCamera);
        return { x: tip.x, y: tip.y };
      });
      const items = triadLabels(tips, size.h);
      // only when they moved: setting labels redraws, and this runs every frame drawn
      const k = items.map((it) => `${Math.round(it.screen.x)},${Math.round(it.screen.y)}`).join(" ");
      if (k === triadKey) return;
      triadKey = k;
      triadItems = items;
      pushLabels();
    }

    function setTriad(on) {
      if (on && !offTriad) {
        offTriad = api.afterRender(drawTriad);
      } else if (!on && offTriad) {
        offTriad();
        offTriad = null;
        triadKey = "";
        if (triadItems.length) {
          triadItems = [];
          pushLabels();
        }
      }
    }

    return {
      commands: [
        {
          id: "axes",
          edit: true,
          name: "Axes",
          show: ["toolbar"],
          state: (target) => (target == null ? { checked: shown(), title: "Show the world axes" } : null),
          run: () => api.use("prefs")?.set("axes", !shown()),
        },
      ],
      update(scene, local, prev, view) {
        const was = prev.view;
        const content = scene === prev.scene && local === prev.local && view === was;
        if (was && scene === prev.scene && !content && view["scene.prefs"] === was["scene.prefs"] && view.theme === was.theme && view.hands === was.hands) return;
        if (!triad.children.length || view.theme !== theme) {
          theme = view.theme;
          key = null;
          buildTriad();
        }
        setTriad(drawn());
        redraw();
      },
      dispose() {
        offTriad?.();
        offTriad = null;
        clearGroup(triad);
      },
    };
  },
};
