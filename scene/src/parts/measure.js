// scene.measure: point-to-point measuring, as a held tool (STAGE.md, "Bodies").
//
// "Measure" (M, or the Dimensions panel's button) picks it up, on top of the hands; M again (from wherever it
// is in them), or Escape while it's the top hand, puts it down. It takes
// every click and passes presses on (a drag still orbits), and it wants the
// pointer (`pointer: true`: no lock while it's held; carrying and the halo
// stand aside: stage/bodies.js pointing).
// While held:
//   - the pointer's hover picks a point (the ground counts; a vertex within
//     10 px snaps) and shows a rubber band from the first point, with its
//     length in the viewer's units, and a glow when it snapped;
//   - a click places the first point, then the second, which hands the two
//     anchors to scene.dimensions (its "add" command), which saves the
//     dimension and selects it;
// It draws only the preview; the dimensions part draws what's saved. It
// measures in the focus stage (api.focus()), made again there wherever the
// focus goes; one held as the focus moves goes on where it was picked up
// until it's put down.

import css from "./measure.css?inline";
import { resolveCssColor } from "../stage/public.js";
import { distance, makeAnchor } from "../anchors.js";
import { applyMatrix } from "../transform.js";
import { formatLength } from "../units.js";
import { perFocus } from "../per-focus.js";
import { placeBetween } from "./segment-label.js";

/** The extension that owns doc.dimensions (and saves what's measured). */
export const DIMENSIONS = "scene.dimensions";
/** How near (px) a vertex must be to snap to it. */
export const SNAP_PX = 10;

export const HINT_FIRST = "Click the first point · Esc to stop measuring";
export const HINT_SECOND = "Click the second point · Esc to stop measuring";

/**
 * Where an anchor is now: through its object's displayed world matrix while
 * that object is there, else its stored world point. Pure.
 * @param {{ objectId?, local?, world? }} anchor
 * @param {object} objects  scene.objects
 * @param {(id: string) => number[] | null} worldOf
 */
export function anchorWorld(anchor, objects, worldOf) {
  const id = anchor?.objectId;
  if (id && objects?.[id] && Array.isArray(anchor.local) && anchor.local.length === 3) {
    const m = worldOf(id);
    if (Array.isArray(m) && m.length === 16) return applyMatrix(m, anchor.local.map(Number));
  }
  const w = anchor?.world;
  return Array.isArray(w) ? [0, 1, 2].map((i) => Number(w[i]) || 0) : [0, 0, 0];
}

/**
 * The anchor for a picked point: on the hit object (local to its displayed
 * world matrix, so it follows the object and whatever it's attached to), or
 * free in the world (the ground, or nothing the doc knows).
 * @param {{ id?: string | null, point: number[] }} hit
 */
export function anchorFor(hit, objects, worldOf) {
  const id = hit?.id && objects?.[hit.id] ? hit.id : null;
  const frame = id ? worldOf(id) : null;
  return makeAnchor(hit.point, id && frame ? id : null, id && frame ? frame : null);
}

/** Measuring in one focus stage: `api` is its facet, `view` the view plugin's api, `hint` the view's hint. */
function measureAt(api, view, hint) {
  const { THREE } = api;
  const layer = api.world({ onTop: true });
  layer.userData.noPick = true;
  const labels = api.labels();

  let holding = false; // set while it's held
  let a = null; // the first point's anchor
  let hover = null; // { world, snapped } under the pointer

  const units = () => view.use("prefs")?.get("units", "m") ?? "m";
  const worldOf = (id) => api.worldOf(id);
  const color = (rgb, fallback) =>
    Array.isArray(rgb) ? new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace) : new THREE.Color(fallback);

  /** The picked point under port px (ground included, vertex-snapped), or null. */
  function pickAt(x, y) {
    const hit = api.pick(x, y, { ground: true, snapPx: SNAP_PX });
    return hit && Array.isArray(hit.point) ? hit : null;
  }

  function clearLayer() {
    for (const c of [...layer.children]) {
      c.removeFromParent();
      c.geometry?.dispose?.();
      c.material?.dispose?.();
    }
  }

  function points(list) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(list.flat(), 3));
    return g;
  }

  function add(obj, order) {
    obj.renderOrder = order;
    obj.raycast = () => {};
    obj.userData.noPick = true;
    layer.add(obj);
  }

  /** The preview: line, markers, snap glow, length label, hint. */
  function draw() {
    clearLayer();
    if (!holding) {
      labels.set([]);
      hint.hidden = true;
      api.invalidate();
      return;
    }
    const theme = api.view.get().theme ?? {};
    // a dimension's colour token (dimensions.css: a measurement is a dimension not yet saved)
    const dimCol = color(resolveCssColor(view.root, "--scene-dimension"));
    const accent = color(theme.accent, 0x33e6bf);
    const aw = a ? anchorWorld(a, api.scene().objects, worldOf) : null;
    const hw = hover?.world ?? null;
    if (aw && hw) {
      add(new THREE.LineSegments(points([aw, hw]), new THREE.LineBasicMaterial({ color: dimCol, depthTest: false, transparent: true })), 10);
    }
    const markers = [aw, hw].filter(Boolean);
    if (markers.length) {
      add(new THREE.Points(points(markers), new THREE.PointsMaterial({ color: dimCol, size: 7, sizeAttenuation: false, depthTest: false, transparent: true })), 11);
    }
    if (hw && hover.snapped) {
      add(
        new THREE.Points(
          points([hw]),
          new THREE.PointsMaterial({ color: accent, size: 12, sizeAttenuation: false, depthTest: false, transparent: true, blending: THREE.AdditiveBlending }),
        ),
        12,
      );
    }
    labels.set(
      aw && hw
        ? [
            {
              key: "preview",
              place: placeBetween(aw, hw),
              text: formatLength(distance(aw, hw), units()),
              className: "measure-label",
              data: { preview: true },
              rank: 3,
            },
          ]
        : [],
    );
    hint.hidden = false;
    hint.textContent = a ? HINT_SECOND : HINT_FIRST;
    api.invalidate();
  }

  function setHover(hit) {
    const next = hit ? { world: hit.point.slice(0, 3).map(Number), snapped: !!hit.snapped } : null;
    if (!next && !hover) return;
    if (next && hover && next.snapped === hover.snapped && next.world.every((v, i) => v === hover.world[i])) return;
    hover = next;
    draw();
  }

  function reset() {
    a = null;
    hover = null;
  }

  /** Place a point at a pick: the first, or the second (which saves the dimension). */
  function place(hit) {
    const objects = api.scene().objects;
    const anchor = anchorFor(hit, objects, worldOf);
    if (!a) {
      a = anchor;
      hover = null;
      draw();
      return null;
    }
    const first = a;
    const dimId = api.newId("d");
    const saved = view.run({ ext: DIMENSIONS, command: "add", value: { id: dimId, a: first, b: anchor } });
    a = null;
    hover = null;
    draw();
    if (!saved) {
      view.use("notices")?.notify("Dimensions aren't on here, so the measurement wasn't saved.", "error");
      return null;
    }
    return dimId;
  }

  const handlers = {
    move(ev) {
      if (ev.locked || ev.buttons) return; // orbiting: keep the preview where it was
      if (holding) setHover(pickAt(ev.x, ev.y));
    },
    click(ev) {
      const hit = pickAt(ev.x, ev.y);
      if (hit) place(hit);
      return true;
    },
    cursor: () => "crosshair",
    put() {
      // put down (M again, Escape, another tool picked up, or the stage): forget everything
      if (!holding) return;
      holding = false;
      reset();
      draw();
    },
  };

  /** Pick it up: what the stage holds is this input. */
  function start() {
    reset();
    holding = true;
    draw();
    return handlers;
  }

  /** the pointer left the view: no hover point */
  function left() {
    if (!holding) return;
    setHover(null);
  }

  const commands = [
    {
      id: "measure",
      hand: "edit",
      name: "Measure",
      key: "m",
      // (the Dimensions panel's, not the bar's: PLANS.md §5)
      show: [],
      // a tool: its run's input goes on top of the hands
      tool: { pointer: true },
      state: (target) => (target == null ? { checked: holding, title: "Measure point to point" } : null),
      run: () => start(),
    },
  ];

  return {
    commands,
    left,
    update(scene, local, prev, v) {
      if (!holding) return;
      const was = prev?.view;
      // the first point follows its object; the units or theme may have changed
      const moved = a?.objectId && scene !== prev?.scene;
      if (!was || moved || v["scene.prefs"] !== was["scene.prefs"] || v.theme !== was.theme) draw();
    },
    dispose() {},
    // for tests
    get state() {
      return { held: holding, a, hover };
    },
  };
}

export function create(api) {
  api.style(css);
  const overlay = api.overlay();
  const hint = document.createElement("div");
  hint.className = "measure-hint";
  hint.hidden = true;
  overlay.append(hint);
  const at = perFocus(api, (f) => measureAt(f, api, hint));
  api.listen(overlay.parentElement ?? overlay, "pointerleave", () => at()?.left());
  return {
    get commands() {
      return at()?.commands ?? [];
    },
    update: (...args) => at()?.update(...args),
    // for tests
    get state() {
      return at()?.state ?? { held: false, a: null, hover: null };
    },
  };
}

export default { create };
