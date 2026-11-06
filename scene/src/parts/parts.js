// scene.parts: the parts bin, the sidebar panel "parts" (STAGE.md, "Parts").
//
// It lists every registered scene:part from the registry's metadata (name,
// icon, category, description, tags, traits; nothing is loaded to offer
// one), grouped by category, with a search once there are enough of them.
// With no parts registered there is no panel: what isn't contributed doesn't
// exist.
//
// Putting one in:
//   - drag it into the view: it lands where the pointer hits. On an object it
//     goes under that object, placed in its frame (the part may put itself
//     elsewhere: at.parent is its to honour); on the ground, under nothing.
//     It snaps to the hit object's connectors as the hand's pieces do (Alt,
//     or the Snap pref off, places freely). A ring shows where it will land
//     while it's dragged: accent when it snapped, muted when not.
//     How it stands and faces is ./parts-place.js.
//   - click it: it goes where the view is looking (the middle of the view,
//     on whatever is there), by the same rules.
// Either way the stage's part(id, at) runs the part's create(ctx, at) and
// selects what it made.
//
// The drag is the browser's own (as the outline's rows and the Patchwork
// sidebar's documents are), carrying PART_MIME = { part }, so a part can be
// dragged into another scene open beside this one. The add extension never
// takes it (it isn't a document).

import css from "./parts.css?inline";
import { isGroup } from "../groups.js";
import { fromEmbed } from "../embed.js";
import { partLanding } from "./parts-place.js";

/** What a part's drag carries: JSON { part: id }. Only `types` is readable during dragover. */
export const PART_MIME = "application/x-scene-part";
/** The search field appears once there are this many parts. */
export const SEARCH_FROM = 8;
/** Where a part without a category is listed, when others have one. */
export const OTHER = "Other";
const RING_SEGMENTS = 48;
/** The ring's radius, as a fraction of its distance from the eye: the same size on screen at any zoom. */
const RING_SIZE = 0.025;

const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s) : []);
const text = (v) => (typeof v === "string" && v ? v : null);

/** scene:part metadata as the bin offers it: those with an id, in registry order. Pure. */
export const partsOf = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p.id === "string")
    .map((p) => ({
      id: p.id,
      name: String(p.name ?? p.id),
      icon: text(p.icon),
      category: text(p.category),
      description: text(p.description),
      tags: strings(p.tags),
      traits: strings(p.traits),
    }));

/**
 * Parts by category, each category where its first part is in registry
 * order; parts without one last, under OTHER. When none has a category
 * there is one unnamed list. Pure.
 * @returns {{ category: string | null, parts: object[] }[]}
 */
export function byCategory(parts) {
  const named = new Map();
  const loose = [];
  for (const p of parts) {
    if (!p.category) loose.push(p);
    else if (named.has(p.category)) named.get(p.category).push(p);
    else named.set(p.category, [p]);
  }
  if (!named.size) return loose.length ? [{ category: null, parts: loose }] : [];
  const out = [...named].map(([category, list]) => ({ category, parts: list }));
  if (loose.length) out.push({ category: OTHER, parts: loose });
  return out;
}

/** Does a part match a search: every word in its name, category, description, tags or what its traits are called? Pure. */
export function matches(part, query, traitName = (k) => k) {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [part.name, part.category, part.description, ...part.tags, ...part.traits.map(traitName)].filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** A part drag's id, or null (not one, or not readable). */
export function readPartDrag(dt) {
  try {
    const v = JSON.parse(dt?.getData?.(PART_MIME) || "null");
    return typeof v?.part === "string" ? v.part : null;
  } catch {
    return null;
  }
}

/** Is this a part being dragged? (Readable during dragover.) */
export const isPartDrag = (dt) => [...(dt?.types ?? [])].includes(PART_MIME);

// The part being dragged out of a bin on this page, if any: dragover can't
// read the drag's data, only its types, so a bin that didn't start the drag
// (another scene beside this one) learns which part it is here, for the ring
// to snap by its tags. There's one drag at a time on a page.
let dragging = null;

function el(tag, cls, content) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (content != null) e.textContent = content;
  return e;
}

function create(api) {
  api.style(css);
  const live = () => !api.signal.aborted;
  const port = api.port;
  const root = api.root ?? port;

  // ── what there is ────────────────────────────────────────────────────────
  let parts = [];
  /** trait key → what the scene:extension registry calls it (describes), for "what it does" */
  let traitNames = new Map();
  const traitName = (k) => traitNames.get(k) ?? k;
  const views = new Set();
  const redraw = () => {
    for (const v of views) v.draw();
  };

  /** Read a registry now and whenever it changes. */
  function follow(type, read) {
    Promise.resolve(api.registry(type))
      .then((reg) => {
        if (!live() || !reg) return;
        const go = () => {
          let list = [];
          try {
            list = reg.filter?.(() => true) ?? [];
          } catch {
            list = [];
          }
          if (!live()) return;
          read(list);
          redraw();
        };
        go();
        try {
          const off = reg.on?.("changed", go);
          if (typeof off === "function") api.signal.addEventListener("abort", off, { once: true });
        } catch {
          // what's installed now is what's offered
        }
      })
      .catch(() => {});
  }
  follow("scene:part", (list) => (parts = partsOf(list)));
  follow("scene:extension", (list) => {
    const names = new Map();
    for (const m of list) for (const [k, d] of Object.entries(m?.describes ?? {})) if (!names.has(k) && typeof d?.name === "string") names.set(k, d.name);
    traitNames = names;
  });

  // ── where it lands ───────────────────────────────────────────────────────
  /** What a part put on this object goes under: the object (a group is only a folder). */
  function parentFor(id) {
    const o = id ? api.scene().objects[id] : null;
    return o && !isGroup(o) ? id : null;
  }

  /** The landing from a hit ({ id, point }), for a part with these tags. */
  function landFrom(hit, tags, free) {
    const pid = parentFor(hit.id);
    const matrix = pid ? (api.worldOf(pid) ?? api.scene().world(pid)) : null;
    const extras = pid ? api.content(pid)?.extras : null;
    const parent = matrix ? { id: pid, matrix, connectors: extras?.connectors ?? [], snapRadius: extras?.snapRadius ?? null } : null;
    return partLanding({ point: hit.point, parent, tags, eye: api.camera.get()?.position ?? null, free: free || api.pref("snap", true) === false });
  }

  const local = (e) => {
    const r = port.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const tagsOf = (id) => parts.find((p) => p.id === id)?.tags ?? [];

  /** Where a part dropped at port-local (x, y) lands, or null (the sky). */
  function landAt(x, y, tags, free) {
    let hit = null;
    try {
      hit = api.pick(x, y, { ground: true });
    } catch {
      hit = null;
    }
    return hit?.point ? landFrom(hit, tags, free) : null;
  }

  /** Where the view is looking: the middle of the view, else straight down from the orbit's target (on whatever is there, else the ground). */
  function landAhead(tags) {
    const land = landAt(port.clientWidth / 2, port.clientHeight / 2, tags, false);
    if (land) return land;
    const t = api.camera.get()?.target ?? [0, 0, 0];
    let hit = null;
    try {
      hit = api.raycast([t[0], t[1] + 1e3, t[2]], [0, -1, 0], { far: 2e3 });
    } catch {
      hit = null;
    }
    return landFrom(hit?.point ? hit : { id: null, point: [t[0], 0, t[2]] }, tags, false);
  }

  async function place(id, land) {
    if (!land || !live()) return null;
    return api.part(id, land.at);
  }

  // ── the ring ─────────────────────────────────────────────────────────────
  const THREE = api.THREE;
  let layer = null;
  let ring = null;
  let shownLanding = null; // what the ring shows (for probes)
  const labels = api.labels();

  function showRing(land, id) {
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
    ring.scale.setScalar(Math.max(d * RING_SIZE, 1e-4));
    ring.visible = true;
    shownLanding = land;
    const name = parts.find((p) => p.id === id)?.name ?? "";
    const on = land.at.parent ? api.nameOf(land.at.parent) : null;
    labels.set(name ? [{ key: "landing", text: on ? `${name} → ${on}` : name, position: land.spot, rank: 3 }] : []);
    api.invalidate();
  }

  function hideRing() {
    shownLanding = null;
    labels.set([]);
    if (ring?.visible) {
      ring.visible = false;
      api.invalidate();
    }
  }

  // ── dragging into the view ───────────────────────────────────────────────
  const inPort = (e) => e.target instanceof Node && port.contains(e.target);

  api.listen(root, "dragover", (e) => {
    if (e.defaultPrevented || fromEmbed(e, root) || !isPartDrag(e.dataTransfer)) return;
    if (!inPort(e)) return hideRing();
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    const land = landAt(...local(e), tagsOf(dragging), e.altKey);
    if (land) showRing(land, dragging);
    else hideRing();
  });
  api.listen(root, "dragleave", (e) => {
    if (!isPartDrag(e.dataTransfer)) return;
    if (!(e.relatedTarget instanceof Node) || !port.contains(e.relatedTarget)) hideRing();
  });
  api.listen(root, "drop", (e) => {
    if (e.defaultPrevented || fromEmbed(e, root) || !isPartDrag(e.dataTransfer)) return;
    hideRing();
    if (!inPort(e)) return;
    e.preventDefault();
    const id = readPartDrag(e.dataTransfer);
    if (!id) return;
    void place(id, landAt(...local(e), tagsOf(id), e.altKey));
  });

  // ── the panel ────────────────────────────────────────────────────────────
  function mountView(body) {
    const filter = el("input", "parts-filter");
    filter.type = "search";
    filter.placeholder = "Search parts";
    filter.setAttribute("aria-label", "Search parts");
    const search = el("div", "parts-search");
    search.append(filter);
    const list = el("div", "parts-list");
    const none = el("p", "parts-none", "No parts match.");
    const box = el("div", "scene-parts");
    box.append(search, list, none);
    body.append(box);
    let query = "";
    let drawn = null;

    filter.addEventListener("input", () => {
      query = filter.value.trim();
      view.draw();
    });
    filter.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && filter.value) {
        e.preventDefault();
        e.stopPropagation();
        filter.value = "";
        query = "";
        view.draw();
      }
    });

    function item(p) {
      const b = el("button", "button part");
      b.type = "button";
      b.draggable = true;
      b.dataset.part = p.id;
      const does = p.traits.map(traitName);
      b.title = [p.description, "Drag it into the view, or click to put it where you're looking"].filter(Boolean).join("\n");
      const icon = el("span", "part-icon", p.name.slice(0, 1).toUpperCase());
      icon.setAttribute("aria-hidden", "true");
      if (p.icon) icon.dataset.icon = p.icon;
      const words = el("span", "part-text");
      words.append(el("span", "part-name", p.name));
      if (does.length) words.append(el("span", "part-does", does.join(" · ")));
      b.append(icon, words);
      b.addEventListener("click", () => void place(p.id, landAhead(p.tags)));
      b.addEventListener("dragstart", (e) => {
        dragging = p.id;
        e.dataTransfer?.setData(PART_MIME, JSON.stringify({ part: p.id }));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
      });
      b.addEventListener("dragend", () => {
        if (dragging === p.id) dragging = null;
        hideRing();
      });
      return b;
    }

    const view = {
      draw() {
        body.hidden = parts.length === 0;
        search.hidden = parts.length < SEARCH_FROM && !query;
        const shown = parts.filter((p) => matches(p, query, traitName));
        const key = JSON.stringify([shown, [...traitNames]]);
        none.hidden = shown.length > 0 || !parts.length;
        if (key === drawn) return;
        drawn = key;
        const groups = byCategory(shown);
        list.replaceChildren(
          ...groups.map(({ category, parts: those }) => {
            const g = el("div", "parts-group");
            if (category) {
              g.dataset.category = category;
              g.append(el("h4", "parts-category", category));
            }
            const items = el("div", "parts-items");
            items.append(...those.map(item));
            g.append(items);
            return g;
          }),
        );
      },
      dispose() {
        views.delete(view);
        box.remove();
      },
    };
    views.add(view);
    view.draw();
    return view;
  }

  return {
    panels: [
      {
        id: "parts",
        title: "Parts",
        mount(body) {
          const v = mountView(body);
          return { update: () => v.draw(), dispose: () => v.dispose() };
        },
      },
    ],
    dispose() {
      for (const v of [...views]) v.dispose();
      ring = null;
      layer = null;
    },
    // for tests and probes
    landAt,
    landAhead,
    debug: {
      /** where the ring is showing a part will land ({ at, spot, snapped }), or null */
      ring: () => (shownLanding ? { at: shownLanding.at, spot: shownLanding.spot, snapped: shownLanding.snapped } : null),
    },
  };
}

export default { create };
