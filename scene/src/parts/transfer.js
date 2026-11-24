// scene.transfer: objects from another scene (or this one), by dragging or
// by Copy and Paste (EDITOR.md, "Copying objects"; the copy is ../transfer.js).
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
//   - Copy (⌘C / Ctrl+C or the browser's Edit ▸ Copy: its copy event, heard
//     through scene.drops, with something selected and no text selected on
//     the page; or the menu's Copy, through a copy event of its own) puts the
//     selection on the clipboard: the row payload, and its document link as
//     text for anything else (where the browser won't run a copy event for
//     the menu, only the link, and the copy reaches scenes on this page).
//     Paste (⌘V / Ctrl+V: the browser's paste event, the one way to read the
//     clipboard; or the menu's Paste) copies it in where the view is
//     looking: under the object there only when it snaps to one of its
//     connectors, else on the surface there, under nothing; each repeat of
//     the same Copy goes beside the last. Pasted in its own scene, it's a
//     duplicate beside the original, on the same parent, each repeat one
//     more width along.
//   - Extract (on an object or group) makes it a scene of its own, linked
//     here in its place; Bundle (on a link) copies the scene it shows into
//     this one in its place, which then no longer follows it
//     (EDITOR.md, "Extract and bundle"; the rule is ../extract.js). Each takes a set of
//     the scene's root traits to go along (Extract: this scene's; Bundle:
//     the linked scene's), offered as `options`: checkboxes in the
//     inspector, none ticked; the menu takes none.
// Keys, pastes and drops inside an embedded document are that document's.
// Copying, pasting, extracting and bundling are the editor's: the commands
// say `hand: "edit"`, and a paste and a dropped row reach it through
// scene.drops (./drops.js), while the Edit hand is held, before scene.add.

import { isGroup } from "../shared/groups.js";
import { landings } from "./landing.js";
import { parseAutomergeUrl } from "../shared/dnd.js";
import { ROW_MIME, copyObjects, rowDocument, currentDrag, fromScene, heldCopy, hold, isRowDrag, liftOf, objectCopyIn, reachOf, readRowPayload, rowPayload, sizeOf, subtreeOf } from "./copy-rule.js";
import { atFocus, perFocus } from "../shared/per-focus.js";
import { isLink, atOf } from "../native/link-graph.js";
import { bundleLink, extractObjects, extractable, traitRules } from "./extract.js";

const RING_SEGMENTS = 48;
/** A ring of unknown size: this fraction of its distance from the eye (the parts bin's). */
const RING_SIZE = 0.025;
/** What a duplicate is moved by when nothing says how big it is (scene units). */
const BESIDE = 1;

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
 * Write to the clipboard through a copy event of our own (custom types and
 * all), from a key press or a menu click. False when the browser won't.
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
  // the focus doc's: what is dropped, pasted or added goes into the focus stage, whichever it is now
  const here = atFocus(api);
  const live = () => !api.signal.aborted;
  const port = api.port;

  // ── where it lands (the parts bin's rule: ./landing.js) ───────────────
  const land = landings(here, api);
  const landAt = (x, y, tags, free) => land.at(x, y, tags, free);

  const local = (e) => {
    const r = port.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // ── the ring ─────────────────────────────────────────────────────────────
  const THREE = api.THREE;
  let shown = null; // { land, radius } (for probes)
  // the preview is drawn in the focus stage (its layer and labels, made again where the focus goes)
  const preview = perFocus(api, (f) => ({ f, labels: f.labels(), layer: null, ring: null }));

  function showRing(land, radius, name) {
    shown = { land, radius };
    const p = preview();
    if (!THREE || !p) return;
    if (!p.layer) p.layer = p.f.world({ onTop: true });
    if (!p.ring) {
      const pts = [];
      for (let i = 0; i <= RING_SEGMENTS; i++) {
        const a = (i / RING_SEGMENTS) * Math.PI * 2;
        pts.push(Math.cos(a), 0, Math.sin(a));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      p.ring = new THREE.Line(g, new THREE.LineBasicMaterial({ depthTest: false, transparent: true }));
      p.ring.renderOrder = 12;
      p.ring.userData.noPick = true;
      p.ring.raycast = () => {};
      p.layer.add(p.ring);
    }
    const theme = here.view.get().theme ?? {};
    const rgb = (land.snapped ? theme.accent : theme.muted) ?? (land.snapped ? [0.2, 0.9, 0.75] : [0.5, 0.5, 0.5]);
    p.ring.material.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
    const eye = here.camera.get()?.position;
    const d = eye ? Math.hypot(eye[0] - land.spot[0], eye[1] - land.spot[1], eye[2] - land.spot[2]) : 1;
    p.ring.position.set(land.spot[0], land.spot[1] + 0.0005, land.spot[2]);
    p.ring.scale.setScalar(Math.max(radius ?? d * RING_SIZE, 1e-4));
    p.ring.visible = true;
    const on = land.parent ? here.nameOf(land.parent) : null;
    const text = name ? (on ? `${name} → ${on}` : name) : on ? `→ ${on}` : "";
    p.labels.set(text ? [{ key: "landing", text, position: land.spot, rank: 3 }] : []);
    api.invalidate();
  }

  function hideRing() {
    const p = preview();
    shown = null;
    p?.labels.set([]);
    if (p?.ring?.visible) {
      p.ring.visible = false;
      api.invalidate();
    }
  }

  // ── a row from another scene, dropped in the view ────────────────────────
  const inPort = (e) => e.target instanceof Node && port.contains(e.target);
  /** Is this drag one of our own rows? true / false / null (can't tell until the drop). */
  function ownRow(dt) {
    const known = currentDrag();
    if (known) return parseAutomergeUrl(known.scene) === here.url;
    return fromScene(dt, here.url);
  }

  // what scene.drops offers (./drops.js): a row from another scene, dragged over the port and dropped
  const dropping = {
    wants: (dt) => isRowDrag(dt) && ownRow(dt) !== true,
    over(e) {
      const dt = e.dataTransfer;
      if (!isRowDrag(dt) || !inPort(e) || ownRow(dt) === true) return hideRing(), false;
      const known = currentDrag();
      const land = landAt(...local(e), known?.tags ?? [], e.altKey);
      if (land) showRing(land, known?.radius ?? sizeOf(dt), known?.name ?? "");
      else hideRing();
      return true;
    },
    leave: () => hideRing(),
    drop(e) {
      if (!isRowDrag(e.dataTransfer) || !inPort(e)) return false;
      let raw = "";
      try {
        raw = e.dataTransfer.getData(ROW_MIME);
      } catch {
        raw = "";
      }
      const payload = readRowPayload(raw);
      if (!payload || parseAutomergeUrl(payload.scene) === here.url) return false; // our own rows: the outline's
      const [x, y] = local(e);
      const free = e.altKey;
      void copyObjects(api.focus(), payload, { land: (tags) => landAt(x, y, tags, free) });
      return true;
    },
  };

  // ── copy and paste ───────────────────────────────────────────────────────
  /** Put these on this page's clipboard; what goes on the system's: { [type]: string }. */
  function copy(ids) {
    const snap = here.scene();
    const objects = snap.objects;
    const order = here.doc().order ?? [];
    const text = clipText(objects, ids);
    const solid = subtreeOf(objects, ids, order).ids.filter((id) => !isGroup(objects[id]));
    const box = (id) => here.box?.(id) ?? null;
    const worldOf = (id) => here.worldOf?.(id) ?? snap.world?.(id) ?? null;
    const lift = solid.length ? liftOf(objects, ids, order, { box, worldOf }) : null;
    const radius = solid.length ? reachOf(solid, { box, worldOf }) : null;
    const tag = `${Date.now().toString(36)}-${++copies}`;
    const extra = { ...(Number.isFinite(lift) ? { lift } : {}), copy: tag };
    hold({ scene: here.url, ids, text, name: here.nameOf(ids[0]) || objects[ids[0]]?.name || "", radius, ...extra });
    return { [ROW_MIME]: rowPayload(here.url, ids, extra), "text/plain": text };
  }

  /** This Copy's pastes here: { n } before this one (counted), and `at`, where the first landed. */
  function repeat(payload) {
    const key = `${payload.copy ?? `${payload.scene}|${payload.ids.join(",")}`}|${here.url}`;
    const rec = pasted.get(key) ?? { n: 0, at: null };
    pasted.set(key, { ...rec, n: rec.n + 1 });
    return { n: rec.n, at: rec.at, key };
  }

  /** Copy a payload in: beside the original in its own scene, else where the view is looking. */
  function paste(payload) {
    const { n, at, key } = repeat(payload);
    if (parseAutomergeUrl(payload.scene) === here.url) {
      return copyObjects(api.focus(), payload, {
        beside: (roots) => {
          const objects = here.scene().objects;
          const ids = subtreeOf(objects, roots, here.doc().order ?? []).ids.filter((id) => !isGroup(objects[id]));
          let box = null;
          for (const id of ids) {
            const b = here.box(id);
            if (!b) continue;
            box = box ? { min: box.min.map((v, i) => Math.min(v, b.min[i])), max: box.max.map((v, i) => Math.max(v, b.max[i])) } : b;
          }
          return { offset: besideOffset(box, n + 1) };
        },
      });
    }
    const h = heldCopy();
    const radius = h && h.copy && h.copy === payload.copy ? h.radius : null;
    return copyObjects(api.focus(), payload, {
      land: (tags) => {
        const l = land.ahead(tags, { step: pasteStep(radius, n), from: at });
        const rec = pasted.get(key);
        if (rec && !rec.at && !l.snapped && n === 0) pasted.set(key, { ...rec, at: l.point.slice() });
        return l;
      },
    });
  }

  /** What scene.drops offers (./drops.js): a paste of a copied object (../transfer.js objectCopyIn). */
  const pasting = (e) => {
    const payload = objectCopyIn(e.clipboardData);
    if (!payload) return false;
    void paste(payload);
    return true;
  };
  /** What scene.drops offers: the browser's copy (⌘C, Edit ▸ Copy) of the selected object, unless text on the page is selected (the browser copies that). */
  const copying = (e) => {
    const sel = here.view.get().selected ?? null;
    if (sel == null || !here.scene().objects[sel] || textSelected() || !e.clipboardData) return false;
    for (const [t, v] of Object.entries(copy([sel]))) if (v) e.clipboardData.setData(t, v);
    return true;
  };

  // ── extract and bundle ──────────────────────────────────────────────────
  // trait names for the options, as the extensions describe them
  let describes = new Map();
  void traitRules(here).then((r) => {
    if (live()) describes = r.describes;
  });
  const traitOptions = (keys) => keys.map((k) => ({ value: k, label: String(describes.get(k)?.name ?? k) }));
  // a linked scene's root traits, by the url (and heads) it shows, kept in this stage's local state
  // (so every surface asks for its commands again when they change): a pin's read once (a value
  // doesn't change), a live link's followed as its doc changes, until this stops
  const LINKED = "scene.transfer.linked";
  const watched = new Map(); // key → stop watching (null while it's being found)
  function rootTraitsOf(o) {
    const at = atOf(o);
    const key = at ? `${o.sourceUrl}#${at.heads.join(",")}` : o.sourceUrl;
    const known = here.local.get()[LINKED]?.[key];
    if (watched.has(key)) return known ?? [];
    watched.set(key, null);
    Promise.resolve(here.repo.find(o.sourceUrl))
      .then((h) => {
        if (!live()) return;
        const read = () => {
          const d = at ? h.view?.(at.heads)?.doc?.() : h.doc();
          const keys = Object.keys(d?.traits ?? {});
          const was = here.local.get()[LINKED]?.[key];
          if (was && was.length === keys.length && was.every((k, i) => k === keys[i])) return;
          here.local.swap((m) => ({ ...m, [LINKED]: { ...m[LINKED], [key]: Object.freeze(keys) } }));
        };
        read();
        if (at || typeof h.on !== "function") return;
        const changed = () => live() && read();
        h.on("change", changed);
        watched.set(key, () => h.off?.("change", changed));
      })
      .catch(() => watched.delete(key));
    return [];
  }
  const traitsOf = (value) => (Array.isArray(value) ? value.filter((k) => typeof k === "string") : []);

  const commands = [
    {
      id: "extract",
      hand: "edit",
      name: "Extract",
      shortcut: "Mod+E",
      show: ["menu"],
      state: (target, { scene }) => {
        if (target == null || !scene?.objects?.[target]) return null;
        if (!here.writable()) return { disabled: true, title: "view only" };
        const doc = here.doc();
        const can = extractable(doc, [target]);
        if (!can.ok) return { disabled: true, title: can.reason };
        return { title: "Make this a scene of its own, linked here in its place (tick what of this scene goes with it)", options: traitOptions(Object.keys(doc.traits ?? {})) };
      },
      run: (target, value) => void extractObjects(api.focus(), [target], traitsOf(value)),
    },
    {
      id: "bundle",
      hand: "edit",
      name: "Bundle",
      shortcut: "Shift+Mod+E",
      show: ["menu"],
      state: (target, { scene }) => {
        const o = target != null ? scene?.objects?.[target] : null;
        if (!isLink(o)) return null;
        if (!here.writable()) return { disabled: true, title: "view only" };
        const l = api.use("links")?.role(target);
        if (!l?.open) return { disabled: true, title: l?.role === "closed" ? `Not open here (${l.reason ?? "closed"})` : "Not open here yet" };
        return { title: "Copy the scene it shows into this one, in its place; the copy no longer follows it (tick what of that scene comes with it)", options: traitOptions(rootTraitsOf(o)) };
      },
      run: (target, value) => void bundleLink(api.focus(), target, traitsOf(value)),
    },
    {
      id: "copy",
      hand: "edit",
      name: "Copy",
      // (⌘C is the browser's copy event, which this part hears through scene.drops: shown, not run by scene.keys)
      shortcut: "Mod+C",
      shortcutBy: "clipboard",
      show: ["menu"],
      state: (target, { scene }) => (target != null && scene?.objects?.[target] ? { title: "Copy this, to paste here or into another scene" } : null),
      run(target) {
        const data = copy([target]);
        // both types, through a copy event of our own (a key press or a menu click may run one)
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
      hand: "edit",
      name: "Paste",
      // (⌘V is the browser's paste event, the one way to read the clipboard, which this part hears: shown, not run by scene.keys)
      shortcut: "Mod+V",
      shortcutBy: "clipboard",
      show: ["menu"],
      state: (target) => {
        const h = heldCopy();
        if (target != null || !h) return null;
        const same = parseAutomergeUrl(h.scene) === here.url;
        return { label: h.name ? `Paste “${h.name}”` : "Paste", title: same ? "A copy beside the original" : "Copy it into this scene, where the view is looking" };
      },
      run: () => {
        const h = heldCopy();
        if (h) void paste(h);
      },
    },
  ];

  return {
    commands,
    dropping,
    pasting,
    copying,
    dispose() {
      for (const stop of watched.values()) stop?.();
      watched.clear();
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
