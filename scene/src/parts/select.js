// scene.select: the selection.
//
// - A click on an object selects it; a click on nothing clears the selection
//   (a group is never hit: groups are selected from the outline).
// - local.selected is this view's selection: a target (STAGE.md, "Targets
//   and refs"), an object or group id, or a ref such as "dimension:<id>" that
//   another extension made selectable, or null. A click on nothing clears
//   whatever it is. An object selection is pruned when its object goes; a
//   ref is its owner's to let go of.
// - Draws the selection box (accent) and each peer's (their colour) in a
//   world layer; the boxes follow held poses (checked after each frame).
// - Tells peers what is selected and hovered (presence "selected", "hovered").
// - Asks the stage to load the selection first (api.focus), if it's an object.
// - Commands: Deselect (Escape), Remove (Delete, Backspace; objects only), Select.
//
// Ported from tool.js select() / setHover / broadcastPresence / removeObject
// and viewport.js setSelection / setRemoteSelections / the boxes in
// rebuildHelpers.

import { peerColor, peerSelections } from "../peers.js";

const ACCENT = [0.2, 0.9, 0.75];
const REMOTE = [0.6, 0.4, 0.9];
const EPS = 1e-9;

const isGroupObj = (o) => o?.kind === "group";
// "<kind>:<id>": a target another extension owns (an object id has no colon)
const isRef = (target) => typeof target === "string" && target.includes(":");
const sameBox = (a, b) => !!a && !!b && a.min.every((v, i) => Math.abs(v - b.min[i]) <= EPS) && a.max.every((v, i) => Math.abs(v - b.max[i]) <= EPS);
const sameRgb = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function confirmRemove(message) {
  try {
    return typeof globalThis.confirm === "function" ? globalThis.confirm(message) !== false : true;
  } catch {
    return true;
  }
}

export function create(api) {
  const { THREE } = api;
  const layer = api.world();
  layer.name = "scene.select";
  layer.userData.noPick = true;

  // key ("self" | "peer:<session>") → { id, rgb, box, helper }
  const drawn = new Map();
  // what should be boxed: [{ key, id, rgb }], recomputed when the selection,
  // the doc, the theme or presence changes (not every frame)
  let targets = [];

  const selected = () => api.local.get().selected ?? null;

  function select(id) {
    const next = id ?? null;
    api.local.swap((m) => ((m.selected ?? null) === next ? m : { ...m, selected: next }));
  }

  function computeTargets() {
    const loc = api.local.get();
    const objects = api.scene().objects ?? {};
    const theme = loc.theme ?? {};
    const out = [];
    const mine = loc.selected ?? null;
    if (mine && objects[mine]) out.push({ key: "self", id: mine, rgb: theme.accent ?? ACCENT });
    const seen = new Set(mine ? [mine] : []);
    for (const p of peerSelections(api.presence.get(), api.id, objects)) {
      if (!p.selected || seen.has(p.selected)) continue;
      seen.add(p.selected);
      out.push({ key: `peer:${p.session}`, id: p.selected, rgb: peerColor(theme.remote ?? REMOTE, p.viewer ?? p.session) });
    }
    targets = out;
  }

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
    computeTargets();
    drawBoxes();
  }

  // Peers' selections come and go without a doc or local change.
  api.presence.watch(() => api.schedule(refresh));
  // Held poses (a gizmo drag, a carry, a peer's hand) move objects without a
  // doc change: check the boxes after each frame; a moved one draws next frame.
  api.afterRender(() => {
    if (targets.length) drawBoxes();
  });

  function update(scene, local, prev) {
    const sel = local.selected ?? null;
    // the selection's object went (removed here or by a peer); a ref that
    // names no object is left to the extension that made it
    if (sel != null && !scene.objects?.[sel] && (!isRef(sel) || prev?.scene?.objects?.[sel])) {
      select(null);
      return;
    }
    const was = prev?.local;
    if (!was || sel !== (was.selected ?? null)) {
      // peers are told any target; their surfaces mark only what they know
      api.presence.set("selected", sel ?? undefined);
      api.focus(sel != null && scene.objects?.[sel] ? [sel] : []);
    }
    if (!was || local.hovered !== was.hovered) api.presence.set("hovered", local.hovered ?? undefined);
    // only the hover (or something else of no concern here) changed
    if (was && scene === prev.scene && local !== was && sel === (was.selected ?? null) && local.theme === was.theme) return;
    // the doc, the selection or the theme changed, or content loaded (same scene and local)
    refresh();
  }

  const commands = [
    {
      id: "deselect",
      name: "Deselect",
      key: "Escape",
      show: [],
      state: (target, { local }) => (target == null && local?.selected != null ? { title: "Clear the selection" } : null),
      run: () => select(null),
    },
    {
      id: "select",
      name: "Select",
      show: ["menu"],
      state: (target, { scene, local }) => {
        if (target == null || !scene?.objects?.[target]) return null;
        return local?.selected === target ? { disabled: true, title: "Already selected" } : { title: "Select this" };
      },
      run: (target) => select(target),
    },
    {
      id: "remove",
      name: "Remove",
      key: ["Delete", "Backspace"],
      show: ["menu", "inspector"],
      state: (target, { scene }) => {
        const o = target != null ? scene?.objects?.[target] : null;
        if (!o) return null;
        return { title: isGroupObj(o) ? "Remove this group and everything in it" : "Remove this from the scene" };
      },
      run: (target) => removeObject(target),
    },
  ];

  /** Remove an object; a group goes with everything in it (after a confirm). */
  function removeObject(id) {
    const snap = api.scene();
    const o = snap.objects?.[id];
    if (!o) return false;
    const plan = api.ops.removeObjects(snap, [id]);
    if (!plan || plan.ok === false) return false;
    const n = plan.within?.length ?? 0;
    if (n > 0 && !confirmRemove(`Remove “${o.name || "Group"}” and the ${n} object${n === 1 ? "" : "s"} in it?`)) return false;
    const done = api.remove([id]);
    const gone = new Set(done?.ids ?? plan.ids ?? [id]);
    if (gone.has(selected())) select(null);
    return true;
  }

  const input = {
    click(ev) {
      const id = ev?.hit?.id ?? null;
      if (id != null && api.scene().objects?.[id]) {
        select(id);
        return true;
      }
      if (selected() != null) {
        select(null);
        return true;
      }
      return false;
    },
  };

  return {
    update,
    input,
    commands,
    dispose() {
      for (const key of [...drawn.keys()]) drop(key);
      targets = [];
    },
  };
}

export default { create };
