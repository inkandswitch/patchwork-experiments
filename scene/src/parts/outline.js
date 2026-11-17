// The object tree: the top of the inspector's one pane (./inspector.js,
// STAGE.md, "The interface"), mounted with it and following the same selection
// (view.selected): a row click selects, and the inspector's fields below
// follow in the same flush. Not an extension of its own: createOutline(api,
// { shown }) is called by the inspector with its api, and answers
//   mount(host) → view   its one view, drawn while shown() (the pane is docked)
//   note(prev, view)     every flush: a selection that changed is to be revealed
//   opened()             the pane docked: the selection is revealed again (its
//                        scroller came back at the top)
//   draw()               the pane's flush, only while it's shown: rows, then the
//                        reveal, then names
//   dispose()
// So nothing is drawn into a pane nobody sees, and a selection made while it
// was shut is revealed when it opens. Its writes are edits (api.edit), so
// undo takes them back.
//
// Expand state, rows, the filter, keyboard navigation, row drag and drop,
// New group. A double-click on a row, or Enter in the filter, frames it. A link's row (an object whose
// content is another scene) says what the link is here (linked, shown again,
// fixed, closed) and, where it can be entered, has Enter (→): the outline
// shows the focus doc, so going inside a link is entering it (a double-click
// on its row does too), and the pane opens again inside (./focus.js). It
// reads the doc through api.scene(), writes it through api.ops planners, and selects by
// writing local.selected. Everything else is someone else's:
//   - Remove runs scene.select's "remove" command when it's running (it owns
//     the confirm), else api.remove;
//   - load and build state comes from local.status (the stage's);
//   - names come from api.nameOf (lenses applied);
//   - peers' selections and hovers come from presence, under "scene.select".
//
// Collapsed / expanded is this viewer's alone: localStorage
// ("scene-outline:<url>"), never the doc. The filter is view-only too.
//
// Rows are kept per object id and updated in place: rebuilding them on every
// doc change would destroy the colour input mid-drag (its picker closes).

import css from "./outline.css?inline";
import { childrenMap, defaultExpanded, groupsWithHidden, inheritedDisplay, isGroup, outlineParents, searchOutline, visibleRows } from "../groups.js";
import { treeOrder } from "../hierarchy.js";
import { dropIntent, placementFor } from "../tree-drop.js";
import { DND_MIME, ROW_MIME, URLS_MIME, hasPatchworkDrop, ownDrag, parsePatchworkDrop } from "../dnd.js";
import { peerCss } from "../peers.js";
import { copyObjects, endDrag, liftOf, reachOf, readRowPayload, rowDocument, rowPayload, startDrag, subtreeOf, summaryTypes } from "../transfer.js";
import { landings } from "./landing.js";
import { enterState } from "./focus.js";

/** What a link's row says it is, by its role here (api.link), and why. Pure. */
export function linkMark(link) {
  if (!link) return null;
  if (link.role === "acting") return { text: "linked", title: "Another scene, placed here live: Enter to select and edit what's in it" };
  if (link.role === "pinned") return { text: "fixed", title: "Another scene, fixed at a version: Follow latest (the inspector) to go inside" };
  return { text: "closed", title: `Another scene that isn't open here (${link.reason ?? "closed"})` };
}

/** The filter field appears once there are this many objects. */
export const SEARCH_FROM = 8;

/**
 * Our own drag payload, so a row being moved inside the tree is told apart
 * from a document arriving from the sidebar. Only `types` is readable during
 * dragover, which is why the kind of drag has to be legible from the mime
 * alone. The data is `{ scene, id }`: the scene's url too, because two scenes
 * open side by side share one drag session and ids are only unique within a
 * scene.
 */
export { ROW_MIME };

/** The extension whose presence keys say what peers select and hover. */
const SELECT_EXT = "scene.select";
/** A colour for an object with none of its own (the swatch shows it faded). */
const AUTO_COLOUR = "#9aa3b5";
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** True when an object is fixed at a version of its source (`at`), cheaply. */
export function isFixed(o) {
  return !!o?.renderUrl && Array.isArray(o.at?.heads) && o.at.heads.length > 0;
}

/** Heads, shortened for display: the first 8 characters of each. */
function shortHeads(heads) {
  return (heads ?? []).map((h) => String(h).slice(0, 8)).join(" + ");
}

/** What a row is as a document outside the scene (../transfer.js). */
export { rowDocument };

/** A row-drag payload `{ scene, id, ids }`, or null if there is none (or it isn't ours). */
export function readRowDrag(dt) {
  let raw = "";
  try {
    raw = dt?.getData?.(ROW_MIME) ?? "";
  } catch {
    return null;
  }
  return readRowPayload(raw);
}

// ─── peers ─────────────────────────────────────────────────────────────────

/** A peer's colour, as CSS: the same as their box in the view (src/peers.js). */
export const peerColor = peerCss;

/**
 * Which rows peers have selected and hovered, from presence.get(): two maps
 * id → the first peer's colour (by session, so every view picks the same).
 */
export function peerMarks(peers, remote, objects) {
  const selected = new Map();
  const hovered = new Map();
  const sessions = Object.keys(peers ?? {}).sort();
  for (const session of sessions) {
    const rec = peers[session];
    const k = rec?.keys?.[SELECT_EXT];
    if (!k) continue;
    const colour = () => peerColor(remote, rec.viewer ?? session);
    if (typeof k.selected === "string" && objects[k.selected] && !selected.has(k.selected)) selected.set(k.selected, colour());
    if (typeof k.hovered === "string" && objects[k.hovered] && !hovered.has(k.hovered)) hovered.set(k.hovered, colour());
  }
  return { selected, hovered };
}

// ─── small DOM helper ──────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

// ─── the tree ──────────────────────────────────────────────────────────────

/**
 * The tree, for the inspector's pane: called once with the inspector's api
 * (a stage part's, so its writes are edits). `mount(host)` builds its one
 * view in `host`; `draw()` draws it, only while `shown()` (the pane is
 * docked); `note(prev, view)` runs on every flush, shown or not, so a
 * selection made while it's shut is the one revealed as it opens
 * (`opened()`, which also reveals an unchanged selection again).
 * @param {object} api
 * @param {{ shown?: () => boolean }} [o]
 * @returns {{ mount: (host: HTMLElement) => object, note: (prev: object, view: object) => void, opened: () => void, draw: () => void, dispose: () => void }}
 */
export function createOutline(api, { shown = () => true } = {}) {
  api.style(css);

  // ── expand state: this viewer's, in localStorage ──────────────────────
  const storeKey = `scene-outline:${api.url ?? "scene"}`;
  const overrides = new Map();
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(storeKey) ?? "null");
    if (saved && typeof saved === "object") for (const [k, v] of Object.entries(saved)) if (typeof v === "boolean") overrides.set(k, v);
  } catch {
    // no storage (private window, sandbox): defaults only
  }
  const save = () => {
    try {
      globalThis.localStorage?.setItem(storeKey, JSON.stringify(Object.fromEntries(overrides)));
    } catch {
      // best effort
    }
  };
  // A row's default is taken the first time it's drawn, so hiding a root
  // group later doesn't fold it away under the pointer.
  const firstDefaults = new Map();
  let expandSeq = 0; // bumped on every expand change, so the view redraws

  // ── what the tree is, once per scene snapshot ──────────────────────────
  let model = null;
  function derive(snap = api.scene()) {
    if (model && model.snap === snap) return model;
    const { objects, ids, parents, groups } = snap;
    const outline = outlineParents(objects, parents, groups);
    const tree = treeOrder(objects, ids, outline);
    model = {
      snap,
      objects,
      ids,
      groups,
      outline,
      tree,
      depth: new Map(tree.map((r) => [r.id, r.depth])),
      kids: childrenMap(outline, ids),
      inherited: inheritedDisplay(objects, outline),
      mixed: null,
      search: null,
    };
    return model;
  }
  const mixedOf = (m) => (m.mixed ??= groupsWithHidden(m.objects, m.outline));
  const shownIn = (m, id) => {
    const o = m.objects[id];
    return !!o && o.visible !== false && (m.inherited.get(id)?.visible ?? true);
  };

  const isExpanded = (m, id, depth) => {
    if (overrides.has(id)) return overrides.get(id);
    let v = firstDefaults.get(id);
    if (v === undefined) firstDefaults.set(id, (v = defaultExpanded(m.objects, id, depth)));
    return v;
  };
  function setExpanded(id, value) {
    if (overrides.get(id) === value) return;
    overrides.set(id, value);
    expandSeq++;
    save();
  }
  function toggleExpanded(id, value = null) {
    const m = derive();
    setExpanded(id, value ?? !isExpanded(m, id, m.depth.get(id) ?? 0));
    renderAll();
  }
  /**
   * Open every row above `id`; then scroll it into view.
   * @returns {boolean} whether it was revealed: false while it isn't in the
   *   scene yet, or the tree isn't shown (it's revealed when it opens)
   */
  function reveal(id) {
    const m = derive();
    if (!m.objects[id] || !isShown()) return false;
    for (let p = m.outline.get(id); p != null; p = m.outline.get(p)) {
      if (!isExpanded(m, p, m.depth.get(p) ?? 0)) setExpanded(p, true);
    }
    renderAll();
    view.rows.get(id)?.li?.scrollIntoView?.({ block: "nearest" });
    return true;
  }

  // ── what this view is doing ────────────────────────────────────────────
  let query = "";
  let presenceSeq = 0;
  let pendingReveal = null; // a selection not revealed yet (not in the scene yet, or the pane shut)
  let view = null; // the one mounted view
  const isShown = () => !!view && shown();

  const selectedId = () => api.view.get().selected ?? null;
  /** Can this row be entered (an open link whose doc acts, here or where it's live)? */
  const enterable = (id) => {
    const can = enterState(api.link(id));
    return !!can && !can.disabled;
  };
  /** What each link is here, as one value: a link's role changing (it opens, closes, is fixed) draws the rows again. */
  const linksKey = (snap) => JSON.stringify(snap.ids.map((id) => api.link(id)).filter(Boolean));
  function select(id) {
    if ((api.view.get().selected ?? null) !== id) api.view.select(id);
  }

  /** Point the camera at a row's object (or the group's members). */
  function frameRow(id) {
    const o = api.scene().objects[id];
    const box = !o ? null : isGroup(o) ? api.groupBox(id) : api.box(id);
    if (box) api.camera.frame(box);
  }

  // every write here is an edit (api.edit), so undo takes it back
  function write(plan, label = "Edit") {
    if (plan && plan.ok === false) api.notify(plan.reason, "error");
    else if (plan) api.edit(plan, { label });
    return plan;
  }

  function setField(id, key, value) {
    write(api.ops.setField(api.scene(), id, key, value), key === "name" ? "Rename" : key === "visible" ? "Visible" : key);
  }

  /** Remove: scene.select's command when it's running (it confirms), else straight through the stage. */
  function removeRow(id) {
    const sel = api.collect("commands").find((c) => c.id === SELECT_EXT);
    if (Array.isArray(sel?.value) && sel.value.some((c) => c?.id === "remove")) {
      api.run({ ext: SELECT_EXT, command: "remove", target: id });
      return;
    }
    const snap = api.scene();
    const o = snap.objects[id];
    if (!o) return;
    const plan = api.ops.removeObjects(snap, [id]);
    if (!plan || plan.ok === false) return;
    const n = plan.within?.length ?? 0;
    if (n > 0 && typeof globalThis.confirm === "function") {
      if (!globalThis.confirm(`Remove “${o.name || "Group"}” and the ${n} object${n === 1 ? "" : "s"} in it?`)) return;
    }
    const edit = api.edits("Delete");
    const done = api.remove([id], { edit });
    edit.end();
    if (new Set(done?.ids ?? plan.ids).has(selectedId())) select(null);
  }

  /** New group: inside the selected group, if one is; opened and selected. */
  function newGroup() {
    const snap = api.scene();
    const sel = selectedId();
    const id = api.newId("g");
    const plan = write(api.ops.newGroup(snap, { into: isGroup(snap.objects[sel]) ? sel : null, id }), "New group");
    if (!plan || plan.ok === false) return null;
    setExpanded(plan.id, true);
    select(plan.id);
    return plan.id;
  }

  /**
   * Move a row to where a drop asked for (ops.moveRow keeps its world pose).
   * A row released on itself, or where it already sits, is a click.
   */
  function moveRow(id, place) {
    const plan = api.ops.moveRow(api.scene(), id, place);
    if (!plan) return select(id);
    if (plan.ok === false) return api.notify(plan.reason, "error");
    api.edit(plan, { label: "Move in the tree" });
    if (plan.parent) setExpanded(plan.parent, true);
    select(id);
    renderAll();
  }

  /**
   * A document dropped at a place in the tree: an extension that lays out
   * its datatype first (api.drop), else added as an object there.
   */
  async function addAt(item, place) {
    const snap = api.scene();
    const into = place.parent && snap.objects[place.parent] ? place.parent : null;
    const intoGroup = !!into && isGroup(snap.objects[into]);
    const group = intoGroup ? into : into ? (snap.groups.get(into) ?? null) : null;
    // one edit, whichever way it's added: undo takes it out again
    const edit = api.edits("Add");
    try {
      await addInto(item, place, { into, intoGroup, group, edit });
    } finally {
      edit.end();
    }
  }
  async function addInto(item, place, { into, intoGroup, group, edit }) {
    if (item.url !== api.url) {
      try {
        const handle = await api.repo.find(item.url);
        if (await api.drop({ url: item.url, doc: handle.doc(), handle, group, at: null }, { edit })) return;
      } catch {
        // can't open it here: addObject says why below
      }
    }
    if (api.signal.aborted) return;
    try {
      const where = intoGroup ? { group: into } : into ? { parent: into } : { group: null };
      const id = await api.addObject(item.url, { name: item.name, ...where, before: place.before ?? null, ...(item.heads?.length ? { heads: item.heads } : {}), edit });
      if (api.signal.aborted) return;
      pendingReveal = id;
      select(id);
      flushReveal();
    } catch (err) {
      api.notify(err?.message ?? String(err), "error");
    }
  }

  /**
   * Another scene's row dropped at a place in this tree: copied here (with
   * what's attached under it, or filed in it, ../transfer.js). The tree
   * says only where it goes in the tree; it's put down as the view would
   * (./landing.js): onto an object row, on that object, snapped to the
   * nearest of its connectors that takes it; at the top or in a group,
   * where the view is looking, under nothing. (Its old place in the world
   * means nothing here.)
   */
  async function copyRows(drag, place, free = false) {
    const snap = api.scene();
    const into = place.parent && snap.objects[place.parent] ? place.parent : null;
    const intoGroup = !!into && isGroup(snap.objects[into]);
    const land = landings(api);
    const where = (tags) => {
      if (into && !intoGroup) return land.on(into, tags, free);
      const l = land.ahead(tags);
      // the tree said at the top, or in that group: under nothing, whatever's in front
      return { ...l, parent: null, parentWorld: null, yaw: l.snapped ? l.yaw : null, snapped: false, group: intoGroup ? into : null };
    };
    const made = await copyObjects(api, drag, { land: where, before: place.before ?? null });
    if (!made || api.signal.aborted) return;
    pendingReveal = made[0];
    flushReveal();
  }

  function flushReveal() {
    if (pendingReveal != null && reveal(pendingReveal)) pendingReveal = null;
  }

  // ── the view: the mounted tree ─────────────────────────────────────────
  function mountView(host) {
    const rows = new Map(); // id → its row's elements
    let emptyRow = null;
    let noMatches = null;
    let last = null; // what the last full draw was of
    let hoverShown = null;

    const filter = el("input", {
      type: "search",
      class: "outline-filter",
      spellcheck: "false",
      autocomplete: "off",
      placeholder: "Filter by name or path…",
      "aria-label": "Filter objects by name or group path",
    });
    const matchCount = el("span", { class: "match-count", "aria-live": "polite" });
    const search = el("div", { class: "outline-search", hidden: true }, filter, matchCount);
    const newGroupButton = el("button", { type: "button", class: "button link new-group", title: "New group (inside the selected group, if one is selected)", onclick: () => newGroup() }, "New group");
    const list = el("ul", { class: "object-list", role: "tree", "aria-label": "Objects" });
    const root = el("div", { class: "scene-outline" }, el("div", { class: "outline-bar" }, search, newGroupButton), list);
    host.append(root);

    // the filter: view-only, never written to the doc
    filter.addEventListener("input", () => {
      query = filter.value.trim();
      renderAll();
    });
    filter.addEventListener("keydown", (e) => {
      // (Escape is the ladder's field rung: it clears the text, then leaves the field)
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        const first = derive().search?.first;
        if (first) {
          select(first);
          reveal(first);
          frameRow(first);
        }
      }
    });

    // keyboard: ↑/↓ move, → expands (or steps in), ← collapses (or steps out)
    list.addEventListener("keydown", (e) => {
      if (!ARROWS.has(e.key)) return;
      const li = e.target?.closest?.(".object-row");
      if (!li || e.target.tagName === "INPUT") return;
      const visible = [...list.children].filter((c) => c.classList.contains("object-row"));
      const i = visible.indexOf(li);
      const id = li.dataset.id;
      const focusRow = (r) => r?.querySelector(".row-main")?.focus();
      const hasKids = !li.hasAttribute("data-leaf");
      const open = li.getAttribute("aria-expanded") === "true";
      e.preventDefault();
      e.stopPropagation(); // the list's, not a scene shortcut
      if (e.key === "ArrowDown") focusRow(visible[i + 1]);
      else if (e.key === "ArrowUp") focusRow(visible[i - 1]);
      else if (e.key === "ArrowRight") {
        if (hasKids && !open) {
          toggleExpanded(id, true);
          focusRow(rows.get(id)?.li);
        } else if (hasKids) focusRow(visible[i + 1]);
      } else if (e.key === "ArrowLeft") {
        if (hasKids && open) {
          toggleExpanded(id, false);
          focusRow(rows.get(id)?.li);
        } else {
          const p = derive().outline.get(id);
          if (p) focusRow(rows.get(p)?.li);
        }
      }
    });

    // ── the tree as a drop target ──────────────────────────────────────
    // Two drags end here, told apart by mime: a row being moved inside the
    // tree carries ROW_MIME, a document from the sidebar carries the
    // patchwork payloads. Both ask tree-drop.js the same question — which
    // parent, and in front of which sibling. The scene's other own drag (a
    // section's head, dnd.js ownDrag) is a document too, but never one to add.
    let mark = null;
    const showMark = (next) => {
      if (mark?.li && mark.li !== next?.li) delete mark.li.dataset.drop;
      if (next?.li) next.li.dataset.drop = next.intent;
      mark = next;
    };
    const targetUnder = (e) => {
      const li = e.target instanceof Element ? e.target.closest(".object-row") : null;
      if (!li || !list.contains(li)) return null;
      const objects = api.scene().objects;
      const id = li.dataset.id;
      if (!objects[id]) return null;
      const box = li.getBoundingClientRect();
      const fraction = (e.clientY - box.top) / (box.height || 1);
      return { id, li, expanded: li.getAttribute("aria-expanded") === "true", intent: dropIntent(isGroup(objects[id]), fraction) };
    };
    const isRowDrag = (dt) => [...(dt?.types ?? [])].includes(ROW_MIME);
    const adds = (dt) => !ownDrag(dt) && hasPatchworkDrop(dt);

    list.addEventListener("dragover", (e) => {
      const dt = e.dataTransfer;
      const moving = isRowDrag(dt);
      if (!moving && !adds(dt)) return;
      const target = targetUnder(e);
      if (!target) return showMark(null);
      e.preventDefault();
      // Keep it off the add extension's whole-tool drop handling: this drag
      // already has a precise target.
      e.stopPropagation();
      if (dt) dt.dropEffect = moving ? "move" : "copy";
      showMark(target);
    });
    list.addEventListener("dragleave", (e) => {
      if (e.relatedTarget instanceof Node && list.contains(e.relatedTarget)) return;
      showMark(null);
    });
    list.addEventListener("drop", (e) => {
      const target = targetUnder(e);
      showMark(null);
      if (!target) return;
      const dt = e.dataTransfer;
      const snap = api.scene();
      const m = derive(snap);
      const place = placementFor(m.objects, m.ids, target.id, target.intent, m.outline, { expanded: target.expanded });
      if (isRowDrag(dt)) {
        e.preventDefault();
        e.stopPropagation();
        const drag = readRowDrag(dt);
        if (!drag) return;
        // another scene's row: a copy of it (and what's under it) goes here in the tree, put down as the view would
        if (drag.scene !== api.url) return void copyRows(drag, place, e.altKey);
        if (!m.objects[drag.id]) return api.notify("That object is no longer in this scene.", "error");
        // Released on its own row: a click that wobbled, whichever band it hit.
        if (drag.id === target.id) return select(drag.id);
        return moveRow(drag.id, place);
      }
      if (!adds(dt)) return;
      const items = parsePatchworkDrop(dt);
      if (!items.length) return;
      e.preventDefault();
      e.stopPropagation();
      (async () => {
        for (const item of items) {
          if (api.signal.aborted) return;
          await addAt(item, place);
        }
      })();
    });

    function rowFor(id, group) {
      let row = rows.get(id);
      if (row && row.group === group) return row;
      const twisty = el("button", { type: "button", class: "twisty", tabindex: "-1", "aria-label": "Expand", onclick: () => toggleExpanded(id) });
      const vis = el("input", { type: "checkbox", title: "Visible", "aria-label": "Visible", onchange: (e) => setField(id, "visible", e.target.checked) });
      const sw = group
        ? el("span", { class: "swatch-spacer", "aria-hidden": "true" })
        : el("input", { type: "color", class: "swatch", title: "Colour", "aria-label": "Colour", oninput: (e) => setField(id, "color", e.target.value) });
      const name = el("span", { class: "name" });
      const count = group ? el("span", { class: "count" }) : null;
      const pill = el("span", { class: "pill" });
      const fixedMark = group ? null : el("span", { class: "tag fixed-mark" }, "◷ fixed");
      // a link's: what it is here, and Enter where it can be entered
      const linkTag = group ? null : el("span", { class: "tag link-mark" });
      const enterBtn = group ? null : el("button", { type: "button", class: "icon-button enter-link", title: "Enter: select and edit what's inside", "aria-label": "Enter", onclick: () => api.view.enter(id) }, "→");
      const remove = el("button", { type: "button", class: "icon-button remove", title: group ? "Remove group and everything in it" : "Remove from scene", "aria-label": "Remove from scene", onclick: () => removeRow(id) }, "×");
      const main = el("button", { type: "button", class: "row-main", onclick: () => select(id), ondblclick: () => (enterable(id) ? api.view.enter(id) : (select(id), frameRow(id))) }, name, count);
      // The name is the grab handle. Making the whole row draggable would
      // fight the colour input and the visibility checkbox inside it.
      main.draggable = true;
      main.addEventListener("dragstart", (e) => {
        const dt = e.dataTransfer;
        if (!dt) return;
        const ids = [id];
        // In its type list, which scene it's from and how big it is: another
        // scene's view shows a ring that size while it's dragged over
        // (only types are readable then). STAGE.md, "Copying objects".
        const snap = api.scene();
        const order = api.doc()?.order ?? [];
        const solid = subtreeOf(snap.objects, ids, order).ids.filter((x) => !isGroup(snap.objects[x]));
        const measure = { box: (x) => api.box?.(x) ?? null, worldOf: (x) => api.worldOf?.(x) ?? snap.world?.(x) ?? null };
        const reach = solid.length ? reachOf(solid, measure) : null;
        // how far its origin is above its base, so it lands on its base (in the payload: read at the drop)
        const lift = solid.length ? liftOf(snap.objects, ids, order, measure) : null;
        dt.setData(ROW_MIME, rowPayload(api.url, ids, Number.isFinite(lift) ? { lift } : {}));
        for (const [t, v] of Object.entries(summaryTypes(api.url, reach))) dt.setData(t, v);
        startDrag({ scene: api.url, ids, radius: reach, lift, tags: Array.isArray(snap.objects[id]?.tags) ? [...snap.objects[id].tags] : [], name: api.nameOf(id) || "" });
        // Outside a scene the row is its geometry (rowDocument): a slicer
        // or a flow field's body slot can take it. Scenes ignore these
        // types on a row drag (scene.add refuses ROW_MIME; scene.transfer
        // copies the row itself).
        const item = rowDocument(snap.objects[id]);
        if (item) {
          dt.setData(DND_MIME, JSON.stringify({ source: "scene", items: [item] }));
          dt.setData(URLS_MIME, JSON.stringify([item.url]));
          dt.setData("text/plain", item.url);
        }
        // move inside this tree; copy into another scene
        dt.effectAllowed = "copyMove";
      });
      main.addEventListener("dragend", () => endDrag({ scene: api.url }));
      const li = el("li", { class: "object-row", role: "treeitem", dataset: { id, ...(group ? { kind: "group" } : {}) } }, twisty, vis, sw, main, remove);
      row = { li, twisty, vis, sw, name, count, pill, fixedMark, linkTag, enterBtn, remove, main, group, label: null };
      rows.set(id, row);
      return row;
    }

    function setHover(id) {
      if (hoverShown === id) return;
      if (hoverShown != null) rows.get(hoverShown)?.li.removeAttribute("data-hover");
      hoverShown = id;
      if (id != null) rows.get(id)?.li.setAttribute("data-hover", "");
    }

    function draw() {
      const snap = api.scene();
      const loc = api.view.get();
      const selected = loc.selected ?? null;
      const status = api.local.get().status ?? null;
      const theme = loc.theme ?? null;
      // Nothing it shows changed (only the hover, or something else's local key)?
      // (what each link is here comes from the view, not the doc)
      const links = linksKey(snap);
      if (last && last.snap === snap && last.selected === selected && last.status === status && last.theme === theme && last.query === query && last.expandSeq === expandSeq && last.presenceSeq === presenceSeq && last.links === links) {
        setHover(loc.hovered ?? null);
        refreshNames();
        return;
      }
      last = { snap, selected, status, theme, query, expandSeq, presenceSeq, links };
      const m = derive(snap);
      const { objects, ids, kids, outline } = m;
      search.hidden = ids.length < SEARCH_FROM && !query;
      let found = null;
      if (query) {
        if (m.search?.q !== query) m.search = { q: query, ...searchOutline(objects, query, outline, ids) };
        found = m.search;
      }
      const visible = visibleRows(m.tree, {
        isExpanded: (id, depth) => isExpanded(m, id, depth),
        hasChildren: (id) => (kids.get(id)?.length ?? 0) > 0,
        shown: found?.shown ?? null,
      });
      const peers = peerMarks(api.presence.get(), theme?.remote, objects);
      for (const id of [...rows.keys()]) if (!objects[id]) rows.delete(id);
      const mixed = mixedOf(m);
      hoverShown = loc.hovered ?? null;
      const els = visible.map(({ id, depth, expanded, hasChildren }) => {
        const o = objects[id];
        const group = isGroup(o);
        const row = rowFor(id, group);
        const { li, twisty, vis, sw, count, pill, fixedMark, linkTag, enterBtn, remove } = row;
        if (li.dataset.depth !== String(depth)) {
          li.dataset.depth = String(depth);
          li.style.setProperty("--depth", String(depth));
        }
        li.toggleAttribute("data-selected", id === selected);
        li.setAttribute("aria-selected", String(id === selected));
        li.toggleAttribute("data-hover", id === hoverShown);
        const peerSel = peers.selected.get(id) ?? null;
        const peerHover = peerSel ? null : (peers.hovered.get(id) ?? null);
        li.toggleAttribute("data-remote-selected", !!peerSel);
        li.toggleAttribute("data-remote-hover", !!peerHover);
        const peer = peerSel ?? peerHover;
        if (peer) li.style.setProperty("--peer-colour", peer);
        else li.style.removeProperty("--peer-colour");
        li.toggleAttribute("data-hidden", !shownIn(m, id));
        li.toggleAttribute("data-context", !!found && !found.matches.has(id));
        const p = outline.get(id);
        li.toggleAttribute("data-attached", p != null && !isGroup(objects[p]));
        li.toggleAttribute("data-leaf", !hasChildren);
        if (hasChildren) {
          li.setAttribute("aria-expanded", String(expanded));
          twisty.setAttribute("aria-expanded", String(expanded));
          twisty.setAttribute("aria-label", expanded ? "Collapse" : "Expand");
        } else {
          li.removeAttribute("aria-expanded");
          twisty.removeAttribute("aria-expanded");
        }
        vis.checked = o.visible !== false;
        vis.indeterminate = group && o.visible !== false && mixed.has(id);
        if (!group) {
          const colour = o.color || AUTO_COLOUR;
          if (sw.value !== colour) sw.value = colour;
          sw.toggleAttribute("data-auto", !o.color);
        }
        setName(row, id, group);
        if (count) {
          const n = String(kids.get(id)?.length ?? 0);
          if (count.textContent !== n) count.textContent = n;
        }
        const st = group ? null : (status?.[id] ?? null);
        if (st) {
          pill.dataset.state = st.state ?? "";
          pill.title = st.title ?? "";
          if (pill.textContent !== (st.text ?? "")) pill.textContent = st.text ?? "";
          if (pill.parentNode !== li) li.insertBefore(pill, remove);
        } else pill.remove();
        if (fixedMark) {
          // display only: the inspector's Version row changes it
          if (isFixed(o)) {
            const t = `Fixed at version ${shortHeads(o.at.heads)}; doesn't follow edits to its source`;
            if (fixedMark.title !== t) fixedMark.title = t;
            if (fixedMark.parentNode !== li) li.insertBefore(fixedMark, pill.parentNode === li ? pill : remove);
          } else fixedMark.remove();
        }
        if (linkTag) {
          const mark = linkMark(api.link(id));
          if (mark) {
            if (linkTag.textContent !== mark.text) linkTag.textContent = mark.text;
            linkTag.title = mark.title;
            if (linkTag.parentNode !== li) li.insertBefore(linkTag, remove);
          } else linkTag.remove();
          if (enterable(id)) {
            if (enterBtn.parentNode !== li) li.insertBefore(enterBtn, remove);
          } else enterBtn.remove();
        }
        return li;
      });
      if (!ids.length) els.push((emptyRow ??= el("li", { class: "empty-row" }, "Nothing here yet.")));
      else if (found && !found.matches.size) els.push((noMatches ??= el("li", { class: "empty-row" }, "No matches.")));
      const current = [...list.children];
      // Only touch the list's structure when the order or membership changed.
      if (current.length !== els.length || current.some((c, i) => c !== els[i])) list.replaceChildren(...els);
      const countText = found ? `${found.matches.size} of ${ids.length}` : "";
      if (matchCount.textContent !== countText) matchCount.textContent = countText;
    }

    function setName(row, id, group) {
      const label = api.nameOf(id) || (group ? "Group" : "Object");
      if (row.label !== label) {
        row.label = label;
        row.name.textContent = label;
      }
    }

    // A lens is applied after the extensions' updates in the same pass, so
    // a name it changes is looked at again just after.
    function refreshNames() {
      const objects = api.scene().objects;
      for (const [id, row] of rows) if (row.li.isConnected && objects[id]) setName(row, id, isGroup(objects[id]));
    }

    const v = {
      rows,
      draw,
      refreshNames,
      dispose() {
        if (view === v) view = null;
        root.remove();
      },
    };
    view = v;
    return v;
  }

  /** Draw the view, while it's shown (a shut pane is drawn when it opens). */
  function renderAll() {
    if (isShown()) view.draw();
  }

  let namesQueued = false;
  function queueNames() {
    if (namesQueued) return;
    namesQueued = true;
    queueMicrotask(() => {
      namesQueued = false;
      if (!api.signal.aborted && isShown()) view.refreshNames();
    });
  }

  api.presence.watch(() => {
    presenceSeq++;
    api.schedule(renderAll);
  });

  return {
    mount(host) {
      view?.dispose();
      return mountView(host);
    },

    note(prev, viewValue) {
      const was = prev?.view?.selected ?? null;
      const sel = viewValue?.selected ?? null;
      // A new selection is revealed: at once, or when it arrives (a row
      // just added), or when the pane opens; one that never arrives is let
      // go when it changes.
      if (sel !== was) pendingReveal = sel;
    },

    opened() {
      pendingReveal = selectedId();
    },

    draw() {
      renderAll();
      flushReveal();
      queueNames();
    },

    dispose() {
      view?.dispose();
    },
  };
}
