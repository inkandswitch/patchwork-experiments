// Selection boxes: a world layer of Box3Helpers, one per target, in the
// api's doc and frame. scene.select draws this view's selection with it and
// scene.others everyone else's (TOOLS.md §3; COMPOSITION.md §3, "Presence
// where it is"). The boxes follow held poses (checked after each frame).

const EPS = 1e-9;
const sameBox = (a, b) => !!a && !!b && a.min.every((v, i) => Math.abs(v - b.min[i]) <= EPS) && a.max.every((v, i) => Math.abs(v - b.max[i]) <= EPS);
const sameRgb = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * @param {object} api  an extension's
 * @param {(objects: object, theme: object) => { key: string, id: string, rgb: number[] }[]} targetsOf
 *   what to box now, from the doc's objects and the view's theme
 * @param {{ renderOrder?: number }} [o]  drawn after lower orders (where two boxes coincide, the higher shows)
 * @returns {{ refresh(): void, dispose(): void }}
 */
export function boxes(api, targetsOf, { renderOrder = 0 } = {}) {
  const { THREE } = api;
  const layer = api.world();
  layer.name = api.id;
  layer.userData.noPick = true;

  // key → { id, rgb, box, helper }
  const drawn = new Map();
  // what should be boxed: [{ key, id, rgb }], recomputed on refresh (not every frame)
  let targets = [];

  function drop(key) {
    const d = drawn.get(key);
    if (!d) return false;
    d.helper.removeFromParent();
    d.helper.geometry?.dispose?.();
    d.helper.material?.dispose?.();
    drawn.delete(key);
    return true;
  }

  /** Bring the boxes up to date with `targets`. @returns whether anything changed */
  function drawBoxes() {
    let changed = false;
    const keep = new Set();
    for (const t of targets) {
      const box = api.box(t.id);
      if (!box) continue;
      keep.add(t.key);
      let d = drawn.get(t.key);
      if (!d) {
        const helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color());
        helper.material.depthTest = true;
        helper.material.transparent = true;
        helper.renderOrder = renderOrder;
        helper.raycast = () => {};
        helper.userData.noPick = true;
        helper.userData.selection = t.key;
        layer.add(helper);
        drawn.set(t.key, (d = { id: null, rgb: null, box: null, helper }));
        changed = true;
      }
      if (!sameBox(d.box, box)) {
        d.box = box;
        d.helper.box.min.fromArray(box.min);
        d.helper.box.max.fromArray(box.max);
        changed = true;
      }
      if (!sameRgb(d.rgb, t.rgb)) {
        d.rgb = t.rgb;
        d.helper.material.color.setRGB(t.rgb[0], t.rgb[1], t.rgb[2], THREE.SRGBColorSpace);
        changed = true;
      }
      d.id = t.id;
    }
    for (const key of [...drawn.keys()]) if (!keep.has(key)) changed = drop(key) || changed;
    if (changed) api.invalidate();
    return changed;
  }

  function refresh() {
    targets = targetsOf(api.scene().objects ?? {}, api.view.get().theme ?? {});
    drawBoxes();
  }

  // Held poses (a halo drag, a carry, a peer's carry) move objects without a
  // doc change: check the boxes after each frame; a moved one draws next frame.
  api.afterRender(() => {
    if (targets.length) drawBoxes();
  });

  return {
    refresh,
    dispose() {
      for (const key of [...drawn.keys()]) drop(key);
      targets = [];
    },
  };
}
