// scene.transfer: objects from another scene (or this one), by dragging or
// by Copy and Paste (STAGE.md, "Copying objects"; the copy is ../transfer.js).
//
//   - An outline row from another scene, dragged into this view, is copied
//     here and lands where the pointer hits, as a part from the bin does
//     (./parts-place.js): on an object it goes under that object and snaps
//     to the nearest of its connectors whose tags take the object's (Alt,
//     or the Snap pref off, places freely); on the ground, under nothing.
//     Snapped or on an object, it turns to the connector's (or that
//     object's) heading; on the ground it keeps the heading it had. Its
//     tilt and scale, and everything attached under it, come as they were.
//     A ring shows where it will land while it's dragged, sized to the
//     object when the drag says how big it is.
//     A row from this scene dropped in the view does nothing, as before:
//     moving rows is the outline's.
//     A copy that doesn't snap lands on its base, not its origin (the
//     payload's `lift`): a crate whose origin is its middle sits on the floor.
//   - Copy (⌘C / Ctrl+C with something selected and no text selected, or
//     the menu's Copy) puts the selection on the clipboard: the row payload,
//     and its document link as text for anything else. (The menu's Copy
//     writes both through a copy event of its own; where the browser won't
//     run one, only the link, and the copy reaches scenes on this page.)
//     Paste (⌘V / Ctrl+V, or the menu's Paste) copies it in where the view is
//     looking: under the object there only when it snaps to one of its
//     connectors, else on the surface there, under nothing; each repeat of
//     the same Copy goes beside the last. Pasted in its own scene, it's a
//     duplicate beside the original, on the same parent, each repeat one
//     more width along.
// Keys, pastes and drops inside an embedded document are that document's.

import { isGroup } from "../groups.js";
import { fromEmbed } from "../embed.js";
import { landings } from "./landing.js";
import { parseAutomergeUrl } from "../dnd.js";
import { ROW_MIME, copyObjects, rowDocument, currentDrag, fromScene, heldCopy, hold, isRowDrag, liftOf, reachOf, readRowPayload, rowPayload, sizeOf, subtreeOf } from "../transfer.js";

const RING_SEGMENTS = 48;
/** A ring of unknown size: this fraction of its distance from the eye (the parts bin's). */
const RING_SIZE = 0.025;
/** What a duplicate is moved by when nothing says how big it is (scene units). */
const BESIDE = 1;

/** Is someone typing into this element? */
function isTyping(el) {
  if (!el || el.nodeType !== 1) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.isContentEditable || el.getAttribute?.("contenteditable") === "true";
}

/** Is there text selected on the page (a label, a panel)? Then Copy is the browser's. */
function textSelected() {
  try {
    const s = globalThis.getSelection?.();
    return !!s && !s.isCollapsed && String(s).length > 0;
  } catch {
    return false;
  }
}

/** The clipboard text for a copy: the first object's document link, else its name. Pure. */
export function clipText(objects, ids) {
  const o = objects?.[ids?.[0]];
  return rowDocument(o)?.url ?? String(o?.name ?? "");
}

/** How far a duplicate moves beside the original: the width of what's copied, and a tenth more; `n` times that for the nth repeat. Pure. */
export function besideOffset(box, n = 1) {
  const w = box ? box.max[0] - box.min[0] : 0;
  return [(w > 0 ? w * 1.1 : BESIDE) * Math.max(1, n), 0, 0];
}

/** How far a repeated paste into another scene steps sideways: the copy's width (twice its reach), and a tenth more. Pure. */
export const pasteStep = (radius, n) => (n > 0 ? (radius > 0 ? radius * 2.2 : BESIDE) * n : 0);

// How many times each Copy has been pasted into each scene, on this page, and
// where the first one landed (when it didn't snap): "<copy>|<scene url>" →
// { n, at }. A repeat goes beside the last one.
const pasted = new Map();
let copies = 0;

/**
 * Write to the clipboard through a copy event of our own (what ⌘C writes,
 * custom types and all), from a menu click. False when the browser won't.
 */
function writeClipboard(data, doc = globalThis.document) {
  const win = doc?.defaultView ?? globalThis;
  if (typeof doc?.execCommand !== "function" || !win?.addEventListener) return false;
  let wrote = false;
  const on = (e) => {
    if (!e.clipboardData) return;
    for (const [t, v] of Object.entries(data)) if (v) e.clipboardData.setData(t, v);
    e.preventDefault();
    e.stopImmediatePropagation();
    wrote = true;
  };
  win.addEventListener("copy", on, true);
  try {
    doc.execCommand("copy");
  } catch {
    wrote = false;
  } finally {
    win.removeEventListener("copy", on, true);
  }
  return wrote;
}

function create(api) {
  const live = () => !api.signal.aborted;
  const port = api.port;
  const root = api.root ?? port;
  const selectedTarget = () => {
    const sel = api.local.get().selected ?? null;
    return sel != null && api.scene().objects[sel] ? sel : null;
  };

  // ── where it lands (the parts bin's rule: ./landing.js) ───────────────
  const land = landings(api);
  const landAt = (x, y, tags, free) => land.at(x, y, tags, free);

  const local = (e) => {
    const r = port.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // ── the ring ─────────────────────────────────────────────────────────────
  const THREE = api.THREE;
  let layer = null;
  let ring = null;
  let shown = null; // { land, radius } (for probes)
  const labels = api.labels();

  function showRing(land, radius, name) {
    shown = { land, radius };
    if (!THREE) return;
    if (!layer) layer = api.world({ onTop: true });
    if (!ring) {
      const pts = [];
      for (let i = 0; i <= RING_SEGMENTS; i++) {
        const a = (i / RING_SEGMENTS) * Math.PI * 2;
        pts.push(Math.cos(a), 0, Math.sin(a));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      ring = new THREE.Line(g, new THREE.LineBasicMaterial({ depthTest: false, transparent: true }));
      ring.renderOrder = 12;
      ring.userData.noPick = true;
      ring.raycast = () => {};
      layer.add(ring);
    }
    const theme = api.local.get().theme ?? {};
    const rgb = (land.snapped ? theme.accent : theme.muted) ?? (land.snapped ? [0.2, 0.9, 0.75] : [0.5, 0.5, 0.5]);
    ring.material.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
    const eye = api.camera.get()?.position;
    const d = eye ? Math.hypot(eye[0] - land.spot[0], eye[1] - land.spot[1], eye[2] - land.spot[2]) : 1;
    ring.position.set(land.spot[0], land.spot[1] + 0.0005, land.spot[2]);
    ring.scale.setScalar(Math.max(radius ?? d * RING_SIZE, 1e-4));
    ring.visible = true;
    const on = land.parent ? api.nameOf(land.parent) : null;
    const text = name ? (on ? `${name} → ${on}` : name) : on ? `→ ${on}` : "";
    labels.set(text ? [{ key: "landing", text, position: land.spot, rank: 3 }] : []);
    api.invalidate();
  }

  function hideRing() {
    shown = null;
    labels.set([]);
    if (ring?.visible) {
      ring.visible = false;
      api.invalidate();
    }
  }

  // ── a row from another scene, dropped in the view ────────────────────────
  const inPort = (e) => e.target instanceof Node && port.contains(e.target);
  /** Is this drag one of our own rows? true / false / null (can't tell until the drop). */
  function ownRow(dt) {
    const known = currentDrag();
    if (known) return parseAutomergeUrl(known.scene) === api.url;
    return fromScene(dt, api.url);
  }

  api.listen(root, "dragover", (e) => {
    if (e.defaultPrevented || fromEmbed(e, root) || !isRowDrag(e.dataTransfer)) return;
    if (!inPort(e) || ownRow(e.dataTransfer) === true) return hideRing();
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    const known = currentDrag();
    const land = landAt(...local(e), known?.tags ?? [], e.altKey);
    if (land) showRing(land, known?.radius ?? sizeOf(e.dataTransfer), known?.name ?? "");
    else hideRing();
  });
  api.listen(root, "dragleave", (e) => {
    if (!isRowDrag(e.dataTransfer)) return;
    if (!(e.relatedTarget instanceof Node) || !port.contains(e.relatedTarget)) hideRing();
  });
  api.listen(root, "drop", (e) => {
    if (!isRowDrag(e.dataTransfer)) return;
    hideRing();
    if (e.defaultPrevented || fromEmbed(e, root) || !inPort(e)) return;
    let raw = "";
    try {
      raw = e.dataTransfer.getData(ROW_MIME);
    } catch {
      raw = "";
    }
    const payload = readRowPayload(raw);
    if (!payload || parseAutomergeUrl(payload.scene) === api.url) return; // our own rows: the outline's
    e.preventDefault();
    const [x, y] = local(e);
    const free = e.altKey;
    void copyObjects(api, payload, { land: (tags) => landAt(x, y, tags, free) });
  });

  // ── copy and paste ───────────────────────────────────────────────────────
  /** Put these on this page's clipboard; what goes on the system's: { [type]: string }. */
  function copy(ids) {
    const snap = api.scene();
    const objects = snap.objects;
    const order = api.doc().order ?? [];
    const text = clipText(objects, ids);
    const solid = subtreeOf(objects, ids, order).ids.filter((id) => !isGroup(objects[id]));
    const box = (id) => api.box?.(id) ?? null;
    const worldOf = (id) => api.worldOf?.(id) ?? snap.world?.(id) ?? null;
    const lift = solid.length ? liftOf(objects, ids, order, { box, worldOf }) : null;
    const radius = solid.length ? reachOf(solid, { box, worldOf }) : null;
    const tag = `${Date.now().toString(36)}-${++copies}`;
    const extra = { ...(Number.isFinite(lift) ? { lift } : {}), copy: tag };
    hold({ scene: api.url, ids, text, name: api.nameOf(ids[0]) || objects[ids[0]]?.name || "", radius, ...extra });
    return { [ROW_MIME]: rowPayload(api.url, ids, extra), "text/plain": text };
  }

  /** This Copy's pastes here: { n } before this one (counted), and `at`, where the first landed. */
  function repeat(payload) {
    const key = `${payload.copy ?? `${payload.scene}|${payload.ids.join(",")}`}|${api.url}`;
    const rec = pasted.get(key) ?? { n: 0, at: null };
    pasted.set(key, { ...rec, n: rec.n + 1 });
    return { n: rec.n, at: rec.at, key };
  }

  /** Copy a payload in: beside the original in its own scene, else where the view is looking. */
  function paste(payload) {
    const { n, at, key } = repeat(payload);
    if (parseAutomergeUrl(payload.scene) === api.url) {
      return copyObjects(api, payload, {
        beside: (roots) => {
          const objects = api.scene().objects;
          const ids = subtreeOf(objects, roots, api.doc().order ?? []).ids.filter((id) => !isGroup(objects[id]));
          let box = null;
          for (const id of ids) {
            const b = api.box(id);
            if (!b) continue;
            box = box ? { min: box.min.map((v, i) => Math.min(v, b.min[i])), max: box.max.map((v, i) => Math.max(v, b.max[i])) } : b;
          }
          return { offset: besideOffset(box, n + 1) };
        },
      });
    }
    const h = heldCopy();
    const radius = h && h.copy && h.copy === payload.copy ? h.radius : null;
    return copyObjects(api, payload, {
      land: (tags) => {
        const l = land.ahead(tags, { step: pasteStep(radius, n), from: at });
        const rec = pasted.get(key);
        if (rec && !rec.at && !l.snapped && n === 0) pasted.set(key, { ...rec, at: l.point.slice() });
        return l;
      },
    });
  }

  api.listen(root, "copy", (e) => {
    if (e.defaultPrevented || fromEmbed(e, root)) return;
    if (isTyping(e.composedPath?.()[0] ?? e.target) || textSelected()) return;
    const sel = selectedTarget();
    if (sel == null || !e.clipboardData) return;
    for (const [t, v] of Object.entries(copy([sel]))) if (v) e.clipboardData.setData(t, v);
    e.preventDefault();
  });

  // heard before scene.add's paste (which takes a pasted URL as a document)
  api.listen(
    root,
    "paste",
    (e) => {
      if (e.defaultPrevented || fromEmbed(e, root)) return;
      if (isTyping(e.composedPath?.()[0] ?? e.target)) return;
      const cd = e.clipboardData;
      let payload = readRowPayload(cd?.getData?.(ROW_MIME) ?? "");
      if (!payload) {
        const h = heldCopy();
        const text = cd?.getData?.("text/plain") ?? "";
        if (h && text && text === h.text) payload = h;
      }
      if (!payload) return;
      e.preventDefault();
      void paste(payload);
    },
    { capture: true },
  );

  const commands = [
    {
      id: "copy",
      name: "Copy",
      show: ["menu"],
      state: (target, { scene }) => (target != null && scene?.objects?.[target] ? { title: "Copy this, to paste here or into another scene" } : null),
      run(target) {
        const data = copy([target]);
        // what ⌘C writes, through a copy event of our own (a menu click may)
        if (writeClipboard(data, port.ownerDocument)) return;
        // else the link alone: Paste on this page still has the whole copy
        try {
          const p = globalThis.navigator?.clipboard?.writeText?.(data["text/plain"]);
          p?.catch?.(() => {});
        } catch {
          // the page's own clipboard still has it, for Paste
        }
      },
    },
    {
      id: "paste",
      name: "Paste",
      show: ["menu"],
      state: (target) => {
        const h = heldCopy();
        if (target != null || !h) return null;
        const here = parseAutomergeUrl(h.scene) === api.url;
        return { label: h.name ? `Paste “${h.name}”` : "Paste", title: here ? "A copy beside the original" : "Copy it into this scene, where the view is looking" };
      },
      run: () => {
        const h = heldCopy();
        if (h) void paste(h);
      },
    },
  ];

  return {
    commands,
    dispose() {
      ring = null;
      layer = null;
    },
    // for tests and probes
    paste,
    landAt,
    debug: {
      ring: () => (shown ? { at: { parent: shown.land.parent }, spot: shown.land.spot, snapped: shown.land.snapped, radius: shown.radius ?? null } : null),
    },
  };
}

export default { create };
