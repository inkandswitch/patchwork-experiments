// scene.inspector: the editor's one pane for what's in the scene, a drawer
// tab (TOOLS.md §6). It holds the object tree on top (./outline.js) and the
// selection's fields below; the selection is one value (view.selected), so a
// row click selects and the fields follow in the same flush, and a canvas,
// menu or Escape selection marks and reveals its row. Chrome follows
// attention: in Edit the pane opens on the first selection and then stays
// open, showing whatever is selected and the scene when nothing is
// (TOOLS.md Decisions 6, "The inspector stays open"), so the canvas doesn't
// change width at every select and deselect. Its × shuts it until the
// selection changes; leaving Edit shuts it; the toolbar's Inspector opens it
// with nothing selected, on the scene.
//
// For an object: name (read-only when a lens names it), Visible, Wireframe,
// Locked, Colour (+ Auto), Opacity, In group (the groups as a tree), Attached
// to (objects), Position (display units, the pref "units"), Rotation (°),
// Scale. For a group: name, Visible, Opacity, In group. Then its Behaviours
// (below). Then the commands that apply to it (every running extension's,
// shown on "inspector" or on every surface) as buttons: this extension's
// Frame, Group and Ungroup first. For a link (an object whose content is
// another scene: COMPOSITION.md §1), a Link row: what it is here
// (live, shown again, fixed at a version, closed and why) and what this
// scene sets of it: its place, name, display, lock and its own traits on it,
// never what's inside (Enter, scene.focus's command, goes in for that). The
// Version row (what version of its source it shows: Latest, or Fixed at…
// with Fix at this version / Follow latest, which are also this extension's
// commands for the menu), and the status line.
//
// Nothing selected: the Scene. Its Behaviours (the scene's own traits), and
// Starts in: the body everyone who opens the scene arrives in
// (doc.view.start.body, read once on arrival: TOOLS.md §2), Look (no body
// named), Edit or one of the bodies on offer here; each viewer can still
// change body for themselves.
//
// Last, for either, its documents (STAGE.md "A document"): every running
// extension's `documents` that go with it, this extension's own first (the
// object's Source, File or Linked scene, its Build controls, About:
// inspector-model.js inspectorDocuments). Each is a section: a head with its label, a fold
// (the viewer's pref), Dock and Open (patchwork:open-document, the main view),
// and the doc in a <patchwork-view> inside a documentBox (embed.js), so its
// keys and its look are its own; where the host has no <patchwork-view> (a local
// probe, a test), a placeholder names the doc (embed.js documentView). A
// section stays mounted while it's shown, however the sections around it
// come and go. Dock, or the head dragged (a Patchwork document) onto the
// drawer's tab strip, puts the doc in a drawer pane of its own, the view's
// (api.view.dock); while it's there the section says "In the drawer · Show"
// rather than show it twice. Nothing else here opens a document.
//
// Behaviours are traits, authored without a script: the ones the holder has
// (each with its described fields and a ×), and "Add behaviour…", offering
// every trait some scene:extension plugin describes for that place
// (`describes`, STAGE.md "Describing traits"; inspector-traits.js). That is
// metadata, so nothing is started to offer it: adding the trait is what
// starts its extension, through activation. Writes are field by field: a
// trait's key, a field in it, an entry in a map trait (a seat); never the
// whole traits map.
//
// Every write goes through api.ops (or, for traits and Starts in, a field-level
// write), each as an edit (api.edit), so undo takes it back; a refusal
// (plan.ok === false) is said with api.notify and the field shows the doc
// again. Fields being typed in are never overwritten.
//
// A selection that isn't a scene object (a ref such as a dimension: its owner
// shows it, in its own tab), or one that's gone: no fields (the tree stays,
// with no row marked), and a selection of one opens nothing.

import css from "./inspector.css?inline";
import { isGroup } from "../groups.js";
import { fromUnits, roundForDisplay, toUnits } from "../units.js";
import { normalizeTransform } from "../transform.js";
import { documentBox, documentView } from "../embed.js";
import { DND_MIME, SECTION_MIME, URLS_MIME, docKey } from "../dnd.js";
import { atKey, normalizeAt } from "../staleness.js";
import { createParamForm } from "../param-form.js";
import { drawerTab } from "./tab.js";
import { EDIT, LOOK, editing } from "../stage/bodies.js";
import { addableTraits, describedTraits, entriesOf, fieldWrite, formSpecs, layoutKey, newValue, shownValues, traitRows } from "./inspector-traits.js";
import { DEG, attachOptions, commandsFor, commandsKey, contentKind, documentsFor, groupOptions, inspectorDocuments, lensNamed, shownIn, statusParts } from "./inspector-model.js";
import { own } from "../stage/own.js";
import { createOutline } from "./outline.js";
import { layerChoices, layerStates } from "../layers.js";

const ID = "scene.inspector";
// each inspector's own radio group: two views of one scene on a page mustn't share one
let startsGroups = 0;
const OPEN_EVENT = "patchwork:open-document";
// local keys whose change can't change what the inspector shows
const IGNORED_LOCAL = new Set(["hovered", "notices", "pointer", "escape", "gesture"]);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "hidden") node.hidden = !!v;
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
  return node;
}

/**
 * Make `parent`'s children exactly `roots`, in order, without taking out a
 * root that stays: one leaving is removed and one arriving is inserted at its
 * place, so an embedded view beside them is never disconnected (which, for
 * a <patchwork-view>, unmounts its tool). Only roots that swap places move:
 * by moveBefore where the browser has it (Patchwork's view keeps its tool
 * through that), else by a plain insert.
 */
function place(parent, roots) {
  const want = new Set(roots);
  for (const c of [...parent.children]) if (!want.has(c)) c.remove();
  roots.forEach((r, i) => {
    const at = parent.children[i] ?? null;
    if (at === r) return;
    if (r.parentNode === parent && typeof parent.moveBefore === "function") parent.moveBefore(r, at);
    else parent.insertBefore(r, at);
  });
}

/** Heads, shortened for display: the first 8 characters of each. */
function shortHeads(heads) {
  return (heads ?? []).map((h) => String(h).slice(0, 8)).join(" + ");
}

/** The viewer's pref for whether a section is open; absent, the entry's own `folded` decides. */
export const sectionPref = (ext, id) => `inspector.open.${ext}/${id}`;

/**
 * The bodies Starts in offers: the stage's Look and Edit, then each body on
 * offer here (by its label, once per id), then the doc's own choice if
 * nothing here offers it (so it still shows as chosen). Pure.
 * @param {{ id: string, value: any }[]} collected  api.collect("bodies")
 * @param {string} want  the doc's view.start.body, or "look"
 * @returns {[string, string][]}  [id, label]
 */
export function startBodies(collected, want = LOOK.id) {
  const out = [
    [LOOK.id, LOOK.label],
    [EDIT.id, EDIT.label],
  ];
  for (const { value } of collected ?? []) {
    for (const def of Array.isArray(value) ? value : []) {
      if (!def || typeof def.id !== "string" || out.some(([id]) => id === def.id)) continue;
      out.push([def.id, String(def.label ?? def.id)]);
    }
  }
  if (want && !out.some(([id]) => id === want)) out.push([want, want]);
  return out;
}

/** What the inspector's Link row says of a link as the view has it ({ role, open, reason? }). Pure. */
export function linkText(link) {
  if (!link) return "";
  const state = link.open ? "" : " · not open here yet";
  if (link.role === "acting") return `Live${state}`;
  if (link.role === "mirror") return `Live, shown again (Enter goes inside where it's linked first)${state}`;
  if (link.role === "pinned") return `Fixed at a version${state}`;
  const why = { unavailable: "it can't be opened here", cycle: "it would hold itself", unpinned: "inside a fixed version that doesn't hold it" }[link.reason] ?? link.reason ?? "closed";
  return `Closed: ${why}`;
}

/** Did anything the inspector reads in local change (hover and notices don't count)? */
function localChanged(a, b) {
  if (a === b) return false;
  if (!a || !b) return true;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!IGNORED_LOCAL.has(k) && a[k] !== b[k]) return true;
  return false;
}

function create(api) {
  api.style(css);

  const selectedOf = (local) => local?.selected ?? null;
  // What the inspector reads, as one value: the view's (the selection, the
  // body, prefs) with the stage's load status and edits; the same value
  // while neither changes, so its "did anything change" checks hold.
  let seenL = null;
  let seenV = null;
  let seenS = null;
  const seen = (local, view) => (local === seenL && view === seenV ? seenS : ((seenL = local), (seenV = view), (seenS = Object.freeze({ ...view, status: local?.status, edits: local?.edits, running: local?.running }))));
  const now = () => seen(api.local.get(), api.view.get());
  const units = () => api.pref("units", "m");

  // ─── doc writes, through the planners ──────────────────────────────────────

  /** Apply a plan, as an edit; a refusal is said, and the fields show the doc again. */
  function apply(plan, label = "Edit") {
    if (!plan) {
      refreshNow(true);
      return null;
    }
    if (plan.ok === false) {
      api.notify(plan.reason, "error");
      refreshNow(true);
      return null;
    }
    api.edit(plan, { label });
    return plan;
  }
  const FIELD_LABELS = { name: "Rename", visible: "Visible", wireframe: "Wireframe", locked: "Locked", color: "Colour", opacity: "Opacity", group: "In group", parent: "Attach", at: "Version" };
  const setField = (id, key, value) => apply(api.ops.setField(api.scene(), id, key, value), FIELD_LABELS[key] ?? key);
  const setPart = (id, kind, i, v) => apply(api.ops.setTransformPart(api.scene(), id, kind, i, v), kind === "rotation" ? "Rotate" : kind === "scale" ? "Scale" : "Move");
  // ─── fixed versions (`at`) ───────────────────────────────────────────────

  /** Where api.fixPoint would fix it (null: not built here yet, or no fixPoint in this stage). */
  const fixPointOf = (id) => (typeof api.fixPoint === "function" ? api.fixPoint(id) : null);

  /**
   * Can it be fixed at a version: content that follows a doc as it changes
   * (a render doc's build, or a link's scene doc), not a file.
   */
  const versioned = (id, o) => !!o && !isGroup(o) && (!!o.renderUrl || api.loadState?.(id)?.content === "scene");
  const notYet = (id) => (api.loadState?.(id)?.content === "scene" ? "Not open here yet: nothing to fix" : "Not built here yet: nothing to fix");

  /** Fix an object at exactly what it shows now: its render's build, or a link's doc and every doc reached through it. */
  function fixVersion(id) {
    const point = fixPointOf(id);
    if (!point) return void api.notify("There's no version of it here to fix yet.", "error");
    apply(api.ops.setField(api.scene(), id, "at", point), "Fix at this version");
  }

  const followLatest = (id) => apply(api.ops.setField(api.scene(), id, "at", undefined), "Follow latest");

  const select = (id) => api.view.select(id ?? null);

  const startsName = `starts-in-${++startsGroups}`;

  // ─── what's installed: described traits ─────────────────────────────────

  let described = new Map(); // trait key → its description (inspector-traits.js)

  /** Read a registry's metadata now and whenever it changes, and show it. */
  function watchRegistry(type, take) {
    Promise.resolve(api.registry(type))
      .then((reg) => {
        if (api.signal.aborted || !reg) return;
        const read = () => {
          let list = [];
          try {
            list = reg.filter?.(() => true) ?? [];
          } catch {
            list = [];
          }
          take(list.filter((p) => p && typeof p.id === "string"));
          if (api.signal.aborted) return;
          last = null; // what's offered changed, though neither doc nor local did
          refreshNow();
        };
        read();
        try {
          const off = reg.on?.("changed", read);
          if (typeof off === "function") api.signal.addEventListener("abort", off, { once: true });
        } catch {
          // what's installed now is what's offered
        }
      })
      .catch(() => {});
  }
  watchRegistry("scene:extension", (list) => (described = describedTraits(list)));

  // ─── traits, field by field, and where the scene starts ─────────────────

  const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const copy = (v) => JSON.parse(JSON.stringify(v));
  /** The object (or, for null, the doc) a trait lives on, in a draft. */
  const holderIn = (d, id) => (id == null ? d : d.objects?.[id] ?? null);

  function addTrait(id, desc) {
    api.edit((d) => {
      const h = holderIn(d, id);
      if (!h) return;
      // the scene's map is pre-created (STAGE.md, "Shared maps"); an object's
      // first trait makes its own
      if (!isMap(h.traits)) h.traits = {};
      if (!(desc.key in h.traits)) h.traits[desc.key] = newValue(desc);
    }, { label: `Add ${desc.name ?? desc.key}` });
  }

  function removeTrait(id, key) {
    api.edit((d) => {
      const t = holderIn(d, id)?.traits;
      if (isMap(t) && key in t) delete t[key];
    }, { label: `Remove ${described.get(key)?.name ?? key}` });
  }

  /** Write one field of a trait (or of one of its entries, a seat), as the form gave it. */
  function writeTraitField(id, key, entry, field, formValue) {
    const w = fieldWrite(field, formValue);
    if (w.error) {
      api.notify(w.error, "error");
      last = null;
      refreshNow(true);
      return;
    }
    api.edit((d) => {
      let at = holderIn(d, id)?.traits?.[key];
      if (entry != null) at = isMap(at) ? at[entry] : null;
      if (!isMap(at)) return; // gone meanwhile, or not a map of fields
      if (w.remove) {
        if (field.key in at) delete at[field.key];
      } else at[field.key] = copy(w.value);
    }, { label: String(field.label ?? field.key) });
  }

  function addEntry(id, key, entries) {
    const eid = api.newId(entries.prefix);
    api.edit((d) => {
      const t = holderIn(d, id)?.traits?.[key];
      if (isMap(t) && !(eid in t)) t[eid] = newValue(entries);
    }, { label: "Add" });
  }

  function removeEntry(id, key, eid) {
    api.edit((d) => {
      const t = holderIn(d, id)?.traits?.[key];
      if (isMap(t) && eid in t) delete t[eid];
    }, { label: "Remove" });
  }

  /**
   * Start everyone who opens the scene in this body: doc.view.start.body
   * (Look, the default, is no key). A new body drops the old one's place;
   * the home camera stays.
   */
  function startIn(body) {
    api.edit((d) => {
      if (!isMap(d.view)) d.view = {};
      const was = isMap(d.view.start) ? d.view.start : null;
      if ((was?.body ?? LOOK.id) === body) return;
      if (!was) d.view.start = {};
      const start = d.view.start;
      if ("place" in start) delete start.place;
      if (body === LOOK.id) {
        if ("body" in start) delete start.body;
      } else start.body = body;
    }, { label: "Starts in" });
  }

  /**
   * The Behaviours section for a holder (an object id, or null for the
   * scene): its traits with their fields and a ×, then "Add behaviour…". It
   * is laid out again only when what it shows changes shape (a trait, an
   * entry or a field's options come or go); otherwise only values are
   * filled, and the param form leaves a field being typed in alone.
   */
  function behavioursView(holder, place) {
    const list = el("div", { class: "behaviour-list" });
    const picker = el("select", { class: "behaviour-add", "aria-label": "Add behaviour" });
    picker.addEventListener("change", () => {
      const desc = described.get(picker.value);
      picker.value = "";
      if (desc) addTrait(holder, desc);
    });
    const section = el("div", { class: "field-group behaviours" }, el("span", { class: "group-label" }, "Behaviours"), list, picker);
    let key = null;
    let forms = []; // [{ form, fields, specs, read(traits) → value }]
    const dispose = () => {
      for (const f of forms) f.form.dispose();
      forms = [];
    };

    function formFor(container, fields, specs, read, write) {
      const byKey = new Map(fields.map((f) => [f.key, f]));
      const form = createParamForm(container, specs, (k, v) => write(byKey.get(k), v));
      forms.push({ form, fields, specs, read });
    }

    function lay(rows, addable) {
      dispose();
      const boxes = rows.map(({ key: tk, desc, value, specs, entries }) => {
        const name = desc?.name ?? tk;
        const box = el(
          "div",
          { class: "behaviour", dataset: { trait: tk } },
          el(
            "div",
            { class: "behaviour-head" },
            el("span", { class: "behaviour-name", title: desc ? desc.blurb || tk : `${tk} (nothing installed describes it)` }, name),
            el("button", { type: "button", class: "button link behaviour-remove", title: `Remove ${name}`, "aria-label": `Remove ${name}`, onclick: () => removeTrait(holder, tk) }, "×"),
          ),
        );
        if (specs) formFor(box, desc.fields, specs, (t) => t?.[tk], (f, v) => writeTraitField(holder, tk, null, f, v));
        if (entries) {
          const e = desc.entries;
          const wrap = el("div", { class: "behaviour-entries" }, el("span", { class: "entries-label" }, e.label));
          for (const { id: eid, specs: es } of entries) {
            const row = el("div", { class: "behaviour-entry", dataset: { entry: eid } });
            formFor(row, e.fields, es, (t) => t?.[tk]?.[eid], (f, v) => writeTraitField(holder, tk, eid, f, v));
            row.append(el("button", { type: "button", class: "button link entry-remove", title: `Remove this ${e.noun}`, "aria-label": `Remove this ${e.noun}`, onclick: () => removeEntry(holder, tk, eid) }, "×"));
            wrap.append(row);
          }
          wrap.append(el("button", { type: "button", class: "button link entry-add", onclick: () => addEntry(holder, tk, e) }, `Add ${e.noun}`));
          box.append(wrap);
        }
        return box;
      });
      list.replaceChildren(...boxes);
      picker.replaceChildren(el("option", { value: "" }, "Add behaviour…"), ...addable.map((d) => el("option", { value: d.key, title: d.blurb || null }, d.name)));
      picker.value = "";
      picker.hidden = !addable.length;
    }

    function update(scene) {
      const traits = holder == null ? scene.d?.traits : scene.objects?.[holder]?.traits;
      const ctx = { scene, self: holder, nameOf: api.nameOf };
      const rows = traitRows(traits, described).map((r) => {
        const fields = r.desc?.fields ?? [];
        // fields need a map to write into; a trait set to `true` just shows
        const specs = fields.length && (isMap(r.value) || r.value == null) ? formSpecs(fields, ctx) : null;
        const entries = r.desc?.entries && (isMap(r.value) || r.value == null) ? entriesOf(r.value).map(([id]) => ({ id, specs: formSpecs(r.desc.entries.fields, ctx) })) : null;
        return { ...r, specs, entries };
      });
      const addable = addableTraits(described, place, traits);
      const k = layoutKey([rows.map((r) => [r.key, r.desc?.name ?? null, r.desc?.blurb ?? null, r.specs, r.entries, r.desc?.entries?.label ?? null]), addable.map((d) => [d.key, d.name, d.blurb])]);
      if (k !== key) {
        key = k;
        lay(rows, addable);
      }
      for (const f of forms) f.form.update(shownValues(f.fields, f.specs, f.read(traits)));
      section.hidden = !rows.length && !addable.length;
    }

    return { section, update, dispose };
  }

  // ─── the panel ────────────────────────────────────────────────────────────

  let body = null; // the fields' element (below the tree), while mounted
  let view = null; // the DOM for the current selection: { id, group, renderUrl, …fields }
  let last = null; // { scene, local, name, content } at the last full update
  let namesQueued = false;

  function numberField(label, onCommit) {
    const input = el("input", { type: "number", step: "any", "aria-label": label });
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (input.value !== "" && Number.isFinite(v)) onCommit(v);
      else refreshNow(true);
    });
    return { input, row: el("label", { class: "num" }, el("span", {}, label), input) };
  }

  function teardown() {
    view?.behaviours?.dispose();
    view?.sections?.dispose();
    view = null;
  }

  function showEmpty() {
    if (!body) return;
    if (view || !body.querySelector(":scope > .inspector-empty")) {
      teardown();
      body.replaceChildren(el("p", { class: "hint inspector-empty" }, "Nothing selected"));
    }
    if (!body.hidden) body.hidden = true;
  }

  // ─── documents: a section each ────────────────────────────────────────────

  /**
   * One section: a head (its label, which folds it, Dock and Open) and, while
   * it's open, the document (embed.js documentView, in a documentBox). Open
   * asks the host to show the document as the main view, in the section's
   * tool; Dock, or dragging the head onto the drawer's tab strip, puts it in a
   * drawer pane of its own (api.view.dock), and while it's docked there the
   * section shows "In the drawer · Show" instead, so one doc never has two
   * live views in the stage. The head is dragged as a Patchwork document
   * (dnd.js), so anything that takes one (the tab strip, Patchwork's frame)
   * takes it, and as the scene's own (SECTION_MIME), so nothing in a scene
   * adds it: let go anywhere else in the stage, it's nothing. A pane is
   * titled after what the section is of (`title`: "Built · Source"), and
   * keeps its first title: one pane per docKey, not per object (TOOLS.md
   * Decision 18 says where that falls short).
   */
  function sectionView(doc) {
    const fold = el("button", { type: "button", class: "section-fold", "aria-expanded": "false" });
    const title = el("span", { class: "section-label" });
    fold.append(title);
    const dock = el("button", { type: "button", class: "button link section-dock", title: "Put this document in a pane of its own, in the drawer" }, "Dock");
    const open = el("button", { type: "button", class: "button link section-open", title: "Open this document on its own" }, "Open");
    const head = el("div", { class: "panel-head section-head", draggable: "true", title: "Drag to the drawer's tabs to dock it" }, fold, el("span", { class: "section-acts" }, dock, open));
    const show = el("button", { type: "button", class: "button link section-show", title: "Show its pane in the drawer" }, "Show");
    const away = el("p", { class: "hint section-docked", hidden: true }, "In the drawer · ", show);
    const embed = documentBox("section-embed");
    embed.hidden = true;
    const root = el("section", { class: "doc-section", dataset: { ext: doc.ext, section: doc.id } }, head, away, embed);
    let view = null;
    let shown = null;
    fold.addEventListener("click", () => api.setPref(sectionPref(doc.ext, doc.id), !shown.open));
    open.addEventListener("click", () => root.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url: doc.url, ...(doc.toolId ? { toolId: doc.toolId } : {}) }, bubbles: true, composed: true })));
    const toDrawer = () => api.view.dock({ url: doc.url, toolId: doc.toolId ?? null, title: shown?.title ?? doc.label });
    dock.addEventListener("click", toDrawer);
    show.addEventListener("click", toDrawer);
    head.addEventListener("dragstart", (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const item = { url: doc.url, name: shown?.title ?? doc.label, ...(doc.toolId ? { toolId: doc.toolId } : {}) };
      dt.setData(DND_MIME, JSON.stringify({ source: "scene", items: [item] }));
      dt.setData(URLS_MIME, JSON.stringify([doc.url]));
      dt.setData("text/plain", doc.url);
      dt.setData(SECTION_MIME, docKey(doc.url, doc.toolId));
      dt.effectAllowed = "copy";
    });
    const close = () => {
      view?.remove();
      view = null;
    };
    return {
      root,
      update(next) {
        shown = next;
        // shown inline exactly while it's open (the viewer's fold) and not in the drawer
        const live = next.open && !next.docked;
        if (title.textContent !== next.label) title.textContent = next.label;
        fold.title = next.open ? `Fold ${next.label}` : `Show ${next.label}`;
        fold.setAttribute("aria-expanded", String(next.open));
        root.toggleAttribute("data-folded", !next.open);
        root.toggleAttribute("data-docked", next.docked);
        away.hidden = !(next.open && next.docked);
        embed.hidden = !live;
        if (live && !view) embed.append((view = documentView(next)));
        else if (!live) close();
      },
      dispose: close,
    };
  }

  /**
   * The sections for one selection: exactly documentsFor's, in its order.
   * A section is kept while its extension, id, url and tool stay; anything
   * else about it (its label, whether it's open) is updated in place.
   */
  function sectionsView() {
    const section = el("div", { class: "doc-sections" });
    let live = new Map(); // `${ext}/${id}` → { identity, view }
    return {
      section,
      update(target) {
        const list = documentsFor(api.collect("documents"), target, api.context(null), ID);
        const docked = new Set(api.view.get().drawer?.docs ?? []);
        // a drawer pane is titled after the object as well as the section (the scene's: the label alone)
        const of = target == null ? null : api.nameOf(target) || "Untitled";
        const paneTitle = (label) => (of ? `${of} · ${label}` : label);
        const next = new Map();
        for (const d of list) {
          const k = `${d.ext}/${d.id}`;
          const identity = docKey(d.url, d.toolId);
          let rec = live.get(k);
          if (rec && rec.identity !== identity) {
            rec.view.dispose();
            rec = null;
          }
          rec ??= { identity, view: sectionView(d) };
          const pref = api.pref(sectionPref(d.ext, d.id), null);
          rec.view.update({ ...d, title: paneTitle(d.label), open: typeof pref === "boolean" ? pref : !d.folded, docked: docked.has(identity) });
          next.set(k, rec);
        }
        for (const [k, rec] of live) if (!next.has(k)) rec.view.dispose();
        live = next;
        place(section, [...next.values()].map((r) => r.view.root));
        section.hidden = !next.size;
      },
      dispose() {
        for (const rec of live.values()) rec.view.dispose();
        live = new Map();
      },
    };
  }

  /**
   * The object's layers (its GLB's table: layers.js), each with a checkbox
   * for whether it's shown here. Unticking a layer hides what's in it too
   * (those rows dim; their own ticks stay, to come back with it). A choice
   * that matches what the file says is dropped rather than kept, so the
   * object follows the file again; Reset drops them all.
   */
  function layersView(id) {
    const list = el("div", { class: "layer-list" });
    const reset = el("button", { type: "button", class: "button link layers-reset", title: "Show each layer as the file does", onclick: () => apply(api.ops.clearLayers(api.scene(), id), "Reset layers") }, "Reset");
    const section = el("div", { class: "field-group layers", hidden: true }, el("div", { class: "layers-head" }, el("span", { class: "group-label" }, "Layers"), reset), list);
    let key = null;
    const toggle = (layer, on) => {
      const v = on === layer.visible ? undefined : on;
      apply(api.ops.setLayerShown(api.scene(), id, layer.id, v), `${on ? "Show" : "Hide"} ${layer.name}`);
    };
    return {
      section,
      update(o) {
        const table = api.content(id)?.extras?.layers ?? [];
        const states = layerStates(table, o?.layers);
        const choices = Object.keys(layerChoices(o?.layers)).length;
        const k = JSON.stringify([choices, table.map((e) => [e.id, e.name, e.depth, states.get(e.id)])]);
        if (k === key) return;
        key = k;
        section.hidden = !table.length;
        reset.hidden = !choices;
        list.replaceChildren(
          ...table.map((e) => {
            const st = states.get(e.id);
            const box = el("input", { type: "checkbox" });
            box.checked = st.on;
            box.addEventListener("change", () => toggle(e, box.checked));
            return el(
              "label",
              { class: "toggle layer", style: `--depth: ${e.depth}`, dataset: { layer: e.id, shown: String(st.shown) }, title: st.on && !st.shown ? "Hidden with a layer it's in" : null },
              box,
              el("span", { class: "layer-name" }, e.name),
            );
          }),
        );
      },
    };
  }

  function build(id, o) {
    teardown();
    const group = isGroup(o);
    const name = el("input", { type: "text", class: "name-input", "aria-label": "Name" });
    name.addEventListener("change", () => {
      if (name.readOnly) return;
      setField(id, "name", name.value);
    });
    const visible = el("input", { type: "checkbox", class: "visible" });
    visible.addEventListener("change", () => setField(id, "visible", visible.checked));
    const wire = group ? null : el("input", { type: "checkbox", class: "wireframe" });
    wire?.addEventListener("change", () => setField(id, "wireframe", wire.checked));
    const locked = group ? null : el("input", { type: "checkbox", class: "locked" });
    locked?.addEventListener("change", () => setField(id, "locked", locked.checked));
    const colorIn = group ? null : el("input", { type: "color", class: "color", "aria-label": "Colour" });
    colorIn?.addEventListener("input", () => setField(id, "color", colorIn.value));
    const resetColor = group ? null : el("button", { type: "button", class: "button link auto-color", title: "Use the object's own colours", onclick: () => setField(id, "color", null) }, "Auto");
    const opacity = el("input", { type: "range", min: "0", max: "1", step: "0.01", class: "opacity", "aria-label": "Opacity" });
    opacity.addEventListener("input", () => setField(id, "opacity", Number(opacity.value)));
    const groupSel = el("select", { class: "in-group", "aria-label": "In group" });
    groupSel.addEventListener("change", () => apply(api.ops.fileIn(api.scene(), id, groupSel.value || null)));
    const attach = group ? null : el("select", { class: "attach", "aria-label": "Attached to" });
    attach?.addEventListener("change", () => apply(api.ops.attachTo(api.scene(), id, attach.value || null)));

    const pos = group ? null : ["X", "Y", "Z"].map((a, i) => numberField(a, (v) => setPart(id, "position", i, fromUnits(v, units()))));
    const rot = group ? null : ["X", "Y", "Z"].map((a, i) => numberField(a, (v) => setPart(id, "rotation", i, v / DEG)));
    const scale = group ? null : numberField("×", (v) => setPart(id, "scale", 0, v));
    const posUnit = group ? null : el("span", { class: "unit" });

    const behaviours = behavioursView(id, "object");
    const layers = group ? null : layersView(id);
    const commands = el("div", { class: "cluster commands" });
    const content = contentKind(api.loadState?.(id));
    const sections = sectionsView();
    // Which version of the source it shows (`at`): a render doc's, or a link's doc's.
    const version = versioned(id, o)
      ? {
          text: el("span", { class: "version-text" }),
          fix: el("button", { type: "button", class: "button fix-version", onclick: () => fixVersion(id) }, "Fix at this version"),
          follow: el("button", { type: "button", class: "button follow-latest", title: "Follow edits to the source again", onclick: () => followLatest(id) }, "Follow latest"),
          key: null,
        }
      : null;
    const status = el("div", { class: "status-line", hidden: true });
    // a link's: what it is here, and what this scene sets of it
    const linkRow = api.link(id) && !group
      ? {
          text: el("span", { class: "link-text" }),
          note: el("p", { class: "hint link-note" }, "Its place, name, display, lock and behaviours here are this scene's. What's in it is its own: Enter to change that."),
        }
      : null;

    const root = el(
      "div",
      { class: "inspector", dataset: { id, kind: group ? "group" : "object" } },
      el("div", { class: "inspector-kind" }, group ? "Group" : "Object"),
      name,
      el(
        "div",
        { class: "cluster" },
        el("label", { class: "toggle" }, visible, " Visible"),
        wire ? el("label", { class: "toggle" }, wire, " Wireframe") : null,
        locked ? el("label", { class: "toggle", title: "A locked object can't be carried or moved with the halo (a game board, say)" }, locked, " Locked") : null,
      ),
      group ? null : el("div", { class: "cluster" }, el("label", { class: "toggle" }, "Colour ", colorIn), resetColor),
      el("label", { class: "field" }, el("span", {}, "Opacity"), opacity),
      el("label", { class: "field", title: "Which group it's filed in: groups organise, and hide or fade what's in them; nothing moves" }, el("span", {}, "In group"), groupSel),
      group ? null : el("label", { class: "field", title: "Attached objects move with the object they're attached to; their position is relative to it" }, el("span", {}, "Attached to"), attach),
      group ? null : el("div", { class: "field-group" }, el("span", { class: "group-label" }, "Position ", posUnit), el("div", { class: "triple" }, ...pos.map((f) => f.row))),
      group ? null : el("div", { class: "field-group" }, el("span", { class: "group-label" }, "Rotation °"), el("div", { class: "triple" }, ...rot.map((f) => f.row))),
      group ? null : el("div", { class: "field-group" }, el("span", { class: "group-label" }, "Scale"), el("div", { class: "triple" }, scale.row)),
      layers?.section,
      behaviours.section,
      commands,
      linkRow ? el("div", { class: "field link-row" }, el("span", {}, "Link"), linkRow.text) : null,
      linkRow ? linkRow.note : null,
      version ? el("div", { class: "field version-row" }, el("span", {}, "Version"), version.text) : null,
      version ? el("div", { class: "cluster version-actions" }, version.fix, version.follow) : null,
      status,
      sections.section,
    );
    body.replaceChildren(root);
    view = {
      id,
      group,
      renderUrl: o.renderUrl ?? null,
      content,
      root,
      name,
      visible,
      wire,
      locked,
      colorIn,
      opacity,
      groupSel,
      groupKey: null,
      attach,
      attachKey: null,
      pos,
      rot,
      scale,
      posUnit,
      behaviours,
      layers,
      commands,
      commandsKey: null,
      sections,
      status,
      statusKey: null,
      version,
      linkRow,
    };
  }

  /** Nothing selected: the scene's own Behaviours, and the body it starts people in. */
  function buildScene() {
    teardown();
    const behaviours = behavioursView(null, "scene");
    const sections = sectionsView();
    const starts = el("div", { class: "starts-in", role: "radiogroup", "aria-label": "Starts in" });
    const note = el("p", { class: "hint starts-in-note" });
    const root = el(
      "div",
      { class: "inspector", dataset: { kind: "scene" } },
      el("div", { class: "inspector-kind" }, "Scene"),
      behaviours.section,
      el("div", { class: "field-group starts-in-group" }, el("span", { class: "group-label", title: "Where everyone who opens this scene starts out: looking at it, editing it, or in a body (walking, seated)" }, "Starts in"), starts, note),
      sections.section,
    );
    body.replaceChildren(root);
    view = { id: null, scene: true, root, behaviours, sections, starts, note, startsKey: null };
  }

  function fillScene(scene, local) {
    view.behaviours.update(scene);
    const want = typeof scene.d?.view?.start?.body === "string" ? scene.d.view.start.body : LOOK.id;
    const bodies = startBodies(api.collect("bodies"), want);
    const key = JSON.stringify(bodies);
    if (key !== view.startsKey) {
      view.startsKey = key;
      view.starts.replaceChildren(
        ...bodies.map(([id, label]) => {
          const radio = el("input", { type: "radio", name: startsName, value: id, dataset: { body: id } });
          radio.addEventListener("change", () => {
            if (radio.checked) startIn(id);
          });
          return el("label", { class: "toggle" }, radio, ` ${label}`);
        }),
      );
      view.note.textContent =
        bodies.length > 2
          ? "Everyone who opens this scene starts here, once. Each viewer can change body for themselves."
          : "Everyone who opens this scene starts here, once: Look shows it, Edit is the editor. A package that brings a body (walking, seats) adds a choice.";
    }
    for (const radio of view.starts.querySelectorAll("input[data-body]")) radio.checked = radio.dataset.body === want;
    view.sections.update(null);
  }

  // the field shows `v`, unless someone is typing in it (or `force`)
  const setVal = (input, v, force) => {
    if (input && (force || document.activeElement !== input) && input.value !== v) input.value = v;
  };

  function fill(scene, local, force) {
    const id = view.id;
    const objects = scene.objects;
    const o = objects[id];
    const seen = api.nameOf(id);
    setVal(view.name, seen ?? o.name ?? "", force);
    view.name.readOnly = lensNamed(seen, o);
    view.visible.checked = o.visible !== false;
    if (view.wire) view.wire.checked = !!o.wireframe;
    if (view.locked) view.locked.checked = !!o.locked;
    setVal(view.colorIn, o.color || "#9aa3b5", force);
    setVal(view.opacity, String(o.opacity ?? 1), force);

    const opt = ([v, label]) => el("option", { value: v }, label);
    const gOpts = groupOptions(scene, id);
    const gKey = JSON.stringify(gOpts);
    if (view.groupKey !== gKey && (force || document.activeElement !== view.groupSel)) {
      view.groupKey = gKey;
      view.groupSel.replaceChildren(el("option", { value: "" }, "None"), ...gOpts.map(opt));
    }
    setVal(view.groupSel, scene.groups.get(id) ?? "", force);

    if (!view.group) {
      const aOpts = attachOptions(scene, id, api.nameOf);
      const aKey = JSON.stringify(aOpts);
      if (view.attachKey !== aKey && (force || document.activeElement !== view.attach)) {
        view.attachKey = aKey;
        view.attach.replaceChildren(el("option", { value: "" }, "None"), ...aOpts.map(opt));
      }
      const parent = scene.parents.get(id) ?? null;
      setVal(view.attach, parent ?? "", force);
      const u = units();
      const unitText = parent ? `(${u}, relative to ${api.nameOf(parent) || "parent"})` : `(${u})`;
      if (view.posUnit.textContent !== unitText) view.posUnit.textContent = unitText;
      const t = normalizeTransform(o.transform);
      view.pos.forEach((f, i) => setVal(f.input, String(roundForDisplay(toUnits(t.position[i], u), 6)), force));
      view.rot.forEach((f, i) => setVal(f.input, String(roundForDisplay(t.rotation[i] * DEG, 6)), force));
      setVal(view.scale.input, String(t.scale), force);
    }

    view.layers?.update(o);
    view.behaviours.update(scene);
    fillCommands(scene, local);
    fillStatus(scene, local, o);
    fillVersion(o);
    fillLink();
    view.sections.update(id);
  }

  /** The Link row: what the link is here, as the view has it. */
  function fillLink() {
    const r = view.linkRow;
    if (!r) return;
    const text = linkText(api.link(view.id));
    if (r.text.textContent !== text) r.text.textContent = text;
  }

  /** The Version row: Latest or Fixed at…, and which button makes sense. */
  function fillVersion(o) {
    const v = view.version;
    if (!v) return;
    const s = api.loadState(view.id) ?? {};
    const at = normalizeAt(o.at);
    const key = atKey(at);
    let text = "Latest";
    let title = "Follows edits to its source";
    if (at) {
      const builtThere = s.builtAt != null && (s.builtHeads ?? []).join(",") === at.heads.join(",");
      text = `Fixed at ${shortHeads(at.heads)}`;
      if (builtThere) text += ` · built ${new Date(s.builtAt).toLocaleString()}`;
      if (s.versionMissing) text += " · waiting for that version to sync";
      const deps = Object.keys(at.deps).length;
      title = `Source heads ${at.heads.join(", ")}${deps ? `; ${deps} linked document${deps > 1 ? "s" : ""} fixed too` : ""}`;
    }
    if (v.text.textContent !== text) v.text.textContent = text;
    if (v.text.title !== title) v.text.title = title;
    const point = fixPointOf(view.id);
    v.fix.disabled = !point || atKey(point) === key;
    v.fix.title = !point ? notYet(view.id) : "Keep showing exactly what it shows now, whatever later edits to the source do";
    v.follow.disabled = !at;
  }

  // what's ticked of each command's options, for the selection shown (a new selection starts with none ticked)
  let ticks = new Map();
  let ticksFor = null;
  function fillCommands(scene, local) {
    const list = commandsFor(api.collect("commands"), view.id, api.context(null), ID);
    const key = commandsKey(list);
    if (key === view.commandsKey) return;
    view.commandsKey = key;
    const target = view.id;
    if (ticksFor !== target) {
      ticks = new Map();
      ticksFor = target;
    }
    // a disabled command's title is why it can't be used: written out after
    // the control, since a disabled button's tooltip is easy to never see
    const reasonOf = (state) => (state.disabled && state.title ? el("span", { class: "hint command-reason" }, String(state.title)) : null);
    const buttons = list.flatMap(({ ext, command, state }) => {
      const title = state.title ?? "";
      const reason = reasonOf(state);
      if (Array.isArray(state.choices)) {
        const sel = el("select", { class: "command-choice", "aria-label": command.name ?? command.id, title, disabled: !!state.disabled, dataset: { ext, command: command.id } });
        state.choices.forEach((c, i) => sel.append(el("option", { value: String(i) }, c?.label ?? String(c?.value ?? ""))));
        const at = state.choices.findIndex((c) => c?.value === state.value);
        if (at >= 0) sel.value = String(at);
        sel.addEventListener("change", () => api.run({ ext, command: command.id, target, value: state.choices[Number(sel.value)]?.value }));
        return [el("label", { class: "toggle" }, `${command.name ?? command.id} `, sel), reason];
      }
      // a command run with a set of its options (STAGE.md "A command"): a checkbox each, none ticked, then the button
      const options = Array.isArray(state.options) && state.options.length && !state.disabled ? state.options : null;
      const tickKey = `${ext}|${command.id}|${target}`;
      if (options && !ticks.has(tickKey)) ticks.set(tickKey, new Set());
      const ticked = options ? ticks.get(tickKey) : null;
      const boxes = options
        ? el(
            "span",
            { class: "command-options" },
            options.map((o) => {
              const box = el("input", { type: "checkbox", checked: ticked.has(o.value), dataset: { option: String(o.value) } });
              box.addEventListener("change", () => (box.checked ? ticked.add(o.value) : ticked.delete(o.value)));
              return el("label", { class: "toggle" }, box, ` ${o.label ?? String(o.value)}`);
            }),
          )
        : null;
      const toggle = state.checked != null;
      const button = el(
        "button",
        {
          type: "button",
          class: `button${command.id === "remove" ? " danger" : ""}`,
          title,
          disabled: !!state.disabled,
          "aria-pressed": toggle ? String(!!state.checked) : null,
          dataset: { ext, command: command.id },
          onclick: () => api.run(toggle ? { ext, command: command.id, target, value: !state.checked } : options ? { ext, command: command.id, target, value: options.map((o) => o.value).filter((v) => ticked.has(v)) } : { ext, command: command.id, target }),
        },
        // the verb's name for this target (STAGE.md "A command"), as the menu, toolbar and use prompt show it
        String(state.label ?? command.name ?? command.id),
      );
      return options ? [el("span", { class: "command-with-options" }, button, boxes), reason] : [button, reason];
    }).filter(Boolean);
    view.commands.replaceChildren(...buttons);
    view.commands.hidden = !buttons.length;
  }

  function fillStatus(scene, local, o) {
    const id = view.id;
    const status = local.status?.[id] ?? null;
    const load = typeof api.loadState === "function" ? api.loadState(id) : null;
    const content = api.content(id);
    const parts = statusParts(o, { status, load, content, shown: contentKind(load) === "file" ? shownIn(scene, id) : true });
    const key = JSON.stringify(parts);
    if (key === view.statusKey) return;
    view.statusKey = key;
    view.status.replaceChildren(...parts.map((p) => (p.kind === "notes" ? el("span", { class: "notes" }, p.text) : el("p", { class: p.kind }, p.text))));
    view.status.hidden = !parts.length;
  }

  const contentKey = (id) => {
    const c = id ? api.content(id) : null;
    return c ? `${c.loaded}|${c.stats?.triangles ?? ""}|${c.stats?.drawCalls ?? ""}` : "";
  };

  /** Bring the panel up to date; cheap when nothing it shows changed. */
  function refresh(scene, local, force = false) {
    if (!body) return;
    const id = selectedOf(local);
    if (id == null && scene) {
      if (body.hidden) body.hidden = false;
      const fresh = !view?.scene;
      if (!fresh && !force && last && last.scene === scene && !localChanged(last.local, local)) return;
      if (fresh) buildScene();
      last = { scene, local, name: null, content: "" };
      fillScene(scene, local);
      return;
    }
    const o = id ? scene?.objects?.[id] : null;
    if (!o) {
      last = null;
      showEmpty();
      return;
    }
    if (body.hidden) body.hidden = false;
    // (what a link is here is the view's, and changes with no change to the doc)
    const lk = api.link(id);
    const fresh = !view || view.id !== id || view.group !== isGroup(o) || view.renderUrl !== (o.renderUrl ?? null) || view.content !== contentKind(api.loadState?.(id)) || !!view.linkRow !== (!!lk && !isGroup(o));
    const name = api.nameOf(id);
    const ck = `${contentKey(id)}|${JSON.stringify(lk)}`;
    if (!fresh && !force && last && last.scene === scene && !localChanged(last.local, local) && last.name === name && last.content === ck) return;
    if (fresh) build(id, o);
    last = { scene, local, name, content: ck };
    fill(scene, local, force || fresh);
    queueNames();
  }

  const refreshNow = (force = false) => refresh(api.scene(), now(), force);

  // A lens is applied after the extensions' updates in the same flush, and
  // doesn't flush again: look at the names once it has.
  function queueNames() {
    if (namesQueued) return;
    namesQueued = true;
    queueMicrotask(() => {
      namesQueued = false;
      if (api.signal.aborted || !view || view.scene || !last) return;
      if (api.nameOf(view.id) !== last.name) refreshNow();
    });
  }

  // ─── commands ─────────────────────────────────────────────────────────────

  const objectOf = (target, scene) => (target != null ? scene?.objects?.[target] ?? null : null);

  const commands = [
    {
      id: "fix-version",
      edit: true,
      name: "Fix at this version",
      show: ["menu"],
      state: (target, { scene }) => {
        const o = objectOf(target, scene);
        if (!versioned(target, o) || normalizeAt(o.at)) return null;
        const point = fixPointOf(target);
        return point ? { title: "Keep showing exactly what it shows now, whatever later edits to the source do" } : { title: notYet(target), disabled: true };
      },
      run: (target) => fixVersion(target),
    },
    {
      id: "follow-latest",
      edit: true,
      name: "Follow latest",
      show: ["menu"],
      state: (target, { scene }) => {
        const o = objectOf(target, scene);
        return versioned(target, o) && normalizeAt(o.at) ? { title: "Follow edits to the source again" } : null;
      },
      run: (target) => followLatest(target),
    },
    {
      id: "frame",
      name: "Frame",
      show: ["inspector", "menu"],
      state: (target, { scene }) => (objectOf(target, scene) ? { title: "Fit the view to this" } : null),
      run: (target) => {
        const o = objectOf(target, api.scene());
        const box = !o ? null : isGroup(o) ? api.groupBox(target) : api.box(target);
        if (box) api.camera.frame(box);
      },
    },
    {
      id: "group",
      edit: true,
      name: "Group",
      show: ["inspector", "menu"],
      state: (target, { scene }) => {
        const o = objectOf(target, scene);
        return o && !isGroup(o) ? { title: "Put this object in a new group" } : null;
      },
      run: (target) => {
        const plan = apply(api.ops.newGroup(api.scene(), { around: target, id: api.newId("g") }), "Group");
        if (plan?.id) select(plan.id);
      },
    },
    {
      id: "ungroup",
      edit: true,
      name: "Ungroup",
      show: ["inspector", "menu"],
      state: (target, { scene }) => (isGroup(objectOf(target, scene)) ? { title: "Move what's in this group up a level, where it is, and remove the group" } : null),
      run: (target) => {
        const plan = apply(api.ops.ungroup(api.scene(), target), "Ungroup");
        if (plan && selectedOf(api.view.get()) === target) select(null);
      },
    },
  ];

  // ─── the tab: opened by a selection (or when asked), then open until shut ──
  let asked = false; // the toolbar's Inspector opened it (on the scene, or whatever is selected)
  let dismissed = false; // the viewer shut the tab (its ×, the toolbar): shut until the selection changes
  let lastSel = null;
  // the object tree, at the top of the pane (./outline.js): mounted with the
  // pane and drawn with its fields, only while it's docked; what to reveal is
  // noted on every flush, and revealed as it opens
  const tree = createOutline(api, { shown: () => tab.isOpen() });
  const tab = drawerTab(api, {
    id: "inspector",
    title: "Inspector",
    mount(host) {
      host.classList.add("inspector-pane");
      const treeHost = el("div", { class: "inspector-tree" });
      const fields = el("div", { class: "inspector-body" });
      host.replaceChildren(treeHost, fields);
      const treeView = tree.mount(treeHost);
      body = fields;
      view = null;
      last = null;
      showEmpty();
      return {
        opened: () => tree.opened(),
        update(scene, local) {
          refresh(scene, local); // (the value follow() passed: seen())
          tree.draw();
        },
        dispose() {
          teardown();
          treeView.dispose();
          if (body === fields) body = null;
          host.replaceChildren();
          last = null;
        },
      };
    },
    onClosed: () => {
      asked = false;
      dismissed = true;
    },
  });
  /** Is the selection something this inspector shows (a scene object or group)? */
  const shows = (scene, id) => id != null && !!scene?.objects?.[id];
  function follow(scene, local) {
    const sel = selectedOf(local);
    if (sel !== lastSel) {
      lastSel = sel;
      dismissed = false;
    }
    // the inspector is the editor's (../stage/bodies.js): only in Edit, where
    // a selection opens it and it stays open (on the scene when nothing is
    // selected) until its × or the toolbar shuts it, or Edit is left
    if (!editing(local)) asked = false;
    const want = editing(local) && (asked || (!dismissed && (shows(scene, sel) || tab.isOpen())));
    // following the selection, it comes in behind a tab the viewer is using (the parts bin)
    if (want) tab.open({ show: asked });
    else tab.close();
    tab.update(scene, local);
  }

  commands.push({
    id: "inspector",
    name: "Inspector",
    edit: true,
    show: ["toolbar"],
    state: (target) => (target == null ? { checked: tab.isOpen(), title: "Everything in the scene as a tree, and the selection's fields and behaviours (the scene's, with nothing selected)" } : null),
    run(_target, value) {
      const open = value === undefined ? !tab.isOpen() : !!value;
      asked = open;
      dismissed = !open;
      follow(api.scene(), now());
    },
  });

  return {
    commands,
    documents: inspectorDocuments((id) => contentKind(api.loadState?.(id))),
    update(scene, local, prev, view) {
      tree.note(prev, view);
      follow(scene, seen(local, view));
    },
    /** for tests and probes: the tab's element, and whether it's docked */
    tab,
    dispose() {
      tab.dispose();
      tree.dispose();
      teardown();
      body = null;
    },
  };
}

export default own({ create });
