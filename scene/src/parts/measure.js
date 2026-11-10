// scene.measure: point-to-point measuring, as an armed tool.
//
// "Measure" (M) arms it. While armed:
//   - the pointer's hover picks a point (the ground counts; a vertex within
//     10 px snaps) and shows a rubber band from the first point, with its
//     length in the viewer's units, and a glow when it snapped;
//   - a click places the first point, then the second, which hands the two
//     anchors to scene.dimensions (its "add" command), which saves the
//     dimension and selects it;
//   - Escape clears the first point, else disarms.
// It draws only the preview; the dimensions extension draws what's saved.

import css from "./measure.css?inline";
import { distance, makeAnchor } from "../anchors.js";
import { applyMatrix } from "../transform.js";
import { formatLength } from "../units.js";

/** The extension that owns doc.dimensions (and saves what's measured). */
export const DIMENSIONS = "scene.dimensions";
/** How near (px) a vertex must be to snap to it. */
export const SNAP_PX = 10;

export const HINT_FIRST = "Click the first point · Esc to stop measuring";
export const HINT_SECOND = "Click the second point · Esc to cancel";

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

export function create(api) {
  const { THREE } = api;
  api.style(css);
  const layer = api.world({ onTop: true });
  layer.userData.noPick = true;
  const labels = api.labels();
  const overlay = api.overlay();
  const hint = document.createElement("div");
  hint.className = "measure-hint";
  hint.hidden = true;
  overlay.append(hint);

  let disarm = null; // set while armed
  let a = null; // the first point's anchor
  let hover = null; // { world, snapped } under the pointer
  let pending = null; // the latest pointer position waiting for a frame
  let frame = 0;

  const raf = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((fn) => setTimeout(fn, 16));
  const caf = globalThis.cancelAnimationFrame?.bind(globalThis) ?? clearTimeout;

  const units = () => api.pref("units", "m");
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
    if (!disarm) {
      labels.set([]);
      hint.hidden = true;
      api.invalidate();
      return;
    }
    const theme = api.local.get().theme ?? {};
    const dimCol = color(theme.dim, 0xe68019);
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
              position: [(aw[0] + hw[0]) / 2, (aw[1] + hw[1]) / 2, (aw[2] + hw[2]) / 2],
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

  function cancelFrame() {
    if (frame) caf(frame);
    frame = 0;
    pending = null;
  }

  function reset() {
    cancelFrame();
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
    const saved = api.run({ ext: DIMENSIONS, command: "add", value: { id: dimId, a: first, b: anchor } });
    a = null;
    hover = null;
    draw();
    if (!saved) {
      api.notify("Dimensions aren't on here, so the measurement wasn't saved.", "error");
      return null;
    }
    return dimId;
  }

  const handlers = {
    move(ev) {
      if (ev.locked || ev.buttons) return; // orbiting: keep the preview where it was
      pending = { x: ev.x, y: ev.y };
      if (frame) return;
      frame = raf(() => {
        frame = 0;
        const p = pending;
        pending = null;
        if (!disarm || !p) return;
        setHover(pickAt(p.x, p.y));
      });
    },
    click(ev) {
      const hit = pickAt(ev.x, ev.y);
      if (hit) place(hit);
      return true;
    },
    key(ev) {
      if (ev.key !== "Escape") return false;
      if (a) {
        a = null;
        draw();
      } else stop();
      return true;
    },
    cursor: () => "crosshair",
    suspended() {
      cancelFrame();
      hover = null;
      draw();
    },
    disarmed() {
      // popped by someone else (or the stage): forget everything
      if (!disarm) return;
      disarm = null;
      reset();
      api.cursor(null);
      draw();
    },
  };

  function start() {
    if (disarm) return;
    reset();
    disarm = api.arm(handlers, { replace: true });
    api.cursor("crosshair");
    draw();
  }

  function stop() {
    const d = disarm;
    disarm = null;
    reset();
    api.cursor(null);
    d?.();
    draw();
  }

  // the pointer left the view: no hover point
  api.listen(overlay.parentElement ?? overlay, "pointerleave", () => {
    if (!disarm) return;
    cancelFrame();
    setHover(null);
  });

  const commands = [
    {
      id: "measure",
      name: "Measure",
      key: "m",
      state: (target) => (target == null ? { checked: !!disarm, title: "Measure point to point (M)" } : null),
      run: () => (disarm ? stop() : start()),
    },
  ];

  return {
    commands,
    update(scene, local, prev) {
      if (!disarm) return;
      const was = prev?.local;
      // the first point follows its object; the units or theme may have changed
      const moved = a?.objectId && scene !== prev?.scene;
      if (!was || moved || local.prefs !== was.prefs || local.theme !== was.theme) draw();
    },
    dispose() {
      cancelFrame();
      clearLayer();
    },
    // for tests
    get state() {
      return { armed: !!disarm, a, hover };
    },
  };
}

export default { create };
