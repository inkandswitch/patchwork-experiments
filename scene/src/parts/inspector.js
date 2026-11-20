// scene.inspector: the editor's one pane for what's in the scene, a drawer
// tab (EDITOR.md, "The interface"). It holds the object tree on top (./outline.js) and the
// selection's fields below; the selection is one value (view.selected), so a
// row click selects and the fields follow in the same flush, and a canvas,
// menu or Escape selection marks and reveals its row. Chrome follows
// attention: while editing the pane opens on the first selection and then stays
// open, showing whatever is selected and the scene when nothing is
// (HISTORY.md, TOOLS Decisions 6, "The inspector stays open"), so the canvas doesn't
// change width at every select and deselect. Its × shuts it until the
// selection changes; putting the editor down shuts it; the toolbar's Inspector opens it
// with nothing selected, on the scene.
//
// An object (PLANS.md §5) is a header, then what's the scene's, then what it's
// built from. The header: what it is (its source's provider, a Linked scene,
// a Group), its name (read-only when a displayed name stands in) and its
// Open (./open.js), the one way into what's inside. "In this scene", the
// scene's representation of it: Visible, Wireframe, Locked, Colour (+ Auto),
// Opacity, In group (the groups as a tree), Attached to (objects), Position
// (display units, the pref "units"), Rotation (°), Scale, its Layers and its
// Behaviours (below). Its other verbs (Frame, Group, Ungroup, Extract, Remove,
// a package's) are the context menu's, each with its key or shortcut, not
// buttons here (PLANS.md §5); its Open is the header's.
// "Built from": its source as a row (Source, File or Linked scene: Open
// Editor and Dock); for a link, a Link row: what it is here (live, shown
// again, fixed at a version, closed and why); the Version row (Latest, or
// Fixed at… with Fix at this version / Follow latest, which are also this
// extension's commands for the menu); the status line; and its build's
// controls on its render doc: Rebuild, Pinned and the provider's params as
// fields. Last, its notes (About) and any package's documents, as rows.
//
// Nothing selected: the Scene. Its Behaviours (the scene's own traits), and
// Starts in: the body everyone who opens the scene arrives in
// (doc.view.start.body, read once on arrival: STAGE.md, "Arriving"), Look (no body
// named) or one of the bodies on offer here, and whether they arrive holding
// the editor (doc.view.start.edit); each viewer can still change both for
// themselves; then its documents' rows.
//
// No document is mounted here. A document's row has Open Editor (the host
// shows it on its own: patchwork:open-document) and Dock, or the row dragged
// (a Patchwork document) onto the drawer's tab strip, which puts the doc in a
// drawer pane of its own, the view's (the drawer's dockDocument); while it's
// there the row says "In the drawer", and a click shows it.
//
// Behaviours are traits, authored without a script: the ones the holder has
// (each with its described fields and a ×), and "Add behaviour…", offering
// every trait some scene:extension plugin describes for that place
// (`describes`, EDITOR.md "Describing traits"; inspector-traits.js). That is
// metadata, so nothing is started to offer it: adding the trait is what
// starts its extension, through activation. Writes are field by field: a
// trait's key, a field in it, an entry in a map trait (a seat); never the
// whole traits map.
//
// Every write goes through the focus doc's ops (or, for traits and Starts in, a field-level
// write), each as an edit (its edit()), so undo takes it back; a refusal
// (plan.ok === false) is said through "notices" and the field shows the doc
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
import { REBUILD_EVENT } from "../controls-tool.js";
import { providerOf } from "./handles.js";
import { openFor, runOpen } from "./open.js";
import { drawerTab } from "./tab.js";
import { LOOK, editing } from "../stage/bodies.js";
import { addableTraits, describedTraits, entriesOf, fieldWrite, formSpecs, layoutKey, newValue, shownValues, traitRows } from "./inspector-traits.js";
import { DEG, attachOptions, buildSummary, contentKind, documentsFor, groupOptions, inspectorDocuments, lensNamed, shownIn, statusParts } from "./inspector-model.js";
import { editor } from "./editor.js";
import { createOutline } from "./outline.js";
import { atFocus } from "./per-focus.js";
import { layerChoices, layerStates } from "../layers.js";

const ID = "scene.inspector";
// each inspector's own radio group: two views of one scene on a page mustn't share one
let startsGroups = 0;
const OPEN_EVENT = "patchwork:open-document";
// local keys whose change can't change what the inspector shows
const IGNORED_LOCAL = new Set(["hovered", "pointer", "escape", "gesture"]);

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

/**
 * The bodies Starts in offers: the stage's Look, then each body on
 * offer here (by its label, once per id), then the doc's own choice if
 * nothing here offers it (so it still shows as chosen). Pure.
 * @param {{ id: string, value: any }[]} collected  api.collect("bodies")
 * @param {string} want  the doc's view.start.body, or "look"
 * @returns {[string, string][]}  [id, label]
 */
export function startBodies(collected, want = LOOK.id) {
  const out = [[LOOK.id, LOOK.label]];
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
  if (link.role === "pinned") return `Fixed at a version${state}`;
  const why = { unavailable: "it can't be opened here", cycle: "it would hold itself", repeat: "it's linked here already, and open there", unpinned: "inside a fixed version that doesn't hold it" }[link.reason] ?? link.reason ?? "closed";
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
  // the focus doc's: what the inspector shows and edits is the focus stage's, whichever it is now
  const here = atFocus(api);

  const selectedOf = (local) => local?.selected ?? null;
  // What the inspector reads, as one value: the view's (the selection, the
  // body, prefs) with the stage's load status; the same value
  // while neither changes, so its "did anything change" checks hold.
  let seenL = null;
  let seenV = null;
  let seenS = null;
  const seen = (local, view) => (local === seenL && view === seenV ? seenS : ((seenL = local), (seenV = view), (seenS = Object.freeze({ ...view, status: local?.status, running: local?.running }))));
  const now = () => seen(here.local.get(), here.view.get());
  const units = () => api.use("prefs")?.get("units", "m") ?? "m";
  // the sections that go with a selection (or the scene): its Source, File or Linked scene, Build, About
  const documents = inspectorDocuments((id) => contentKind(here.loadState?.(id)));

  // ─── doc writes, through the planners ──────────────────────────────────────

  /** Apply a plan, as an edit; a refusal is said, and the fields show the doc again. */
  function apply(plan, label = "Edit") {
    if (!plan) {
      refreshNow(true);
      return null;
    }
    if (plan.ok === false) {
      api.use("notices")?.notify(plan.reason, "error");
      refreshNow(true);
      return null;
    }
    editor(here).edit(plan, { label });
    return plan;
  }
  const FIELD_LABELS = { name: "Rename", visible: "Visible", wireframe: "Wireframe", locked: "Locked", color: "Colour", opacity: "Opacity", group: "In group", parent: "Attach", at: "Version" };
  const setField = (id, key, value) => apply(here.ops.setField(here.scene(), id, key, value), FIELD_LABELS[key] ?? key);
  const setPart = (id, kind, i, v) => apply(here.ops.setTransformPart(here.scene(), id, kind, i, v), kind === "rotation" ? "Rotate" : kind === "scale" ? "Scale" : "Move");
  // ─── fixed versions (`at`) ───────────────────────────────────────────────

  /** Where it would be fixed: a link's by use("links"), else here.fixPoint (null: not built or open here yet). */
  const fixPointOf = (id) => api.use("links")?.fixPoint(id) ?? here.fixPoint?.(id) ?? null;
  const linkOf = (id) => api.use("links")?.role(id) ?? null;

  /**
   * Can it be fixed at a version: content that follows a doc as it changes
   * (a render doc's build, or a link's scene doc), not a file.
   */
  const versioned = (id, o) => !!o && !isGroup(o) && (!!o.renderUrl || here.loadState?.(id)?.content === "scene");
  const notYet = (id) => (here.loadState?.(id)?.content === "scene" ? "Not open here yet: nothing to fix" : "Not built here yet: nothing to fix");

  /** Fix an object at exactly what it shows now: its render's build, or a link's doc and every doc reached through it. */
  function fixVersion(id) {
    const point = fixPointOf(id);
    if (!point) return void api.use("notices")?.notify("There's no version of it here to fix yet.", "error");
    apply(here.ops.setField(here.scene(), id, "at", point), "Fix at this version");
  }

  const followLatest = (id) => apply(here.ops.setField(here.scene(), id, "at", undefined), "Follow latest");

  const select = (id) => here.view.select(id ?? null);

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
    editor(here).edit((d) => {
      const h = holderIn(d, id);
      if (!h) return;
      // the scene's map is pre-created (CONVENTIONS.md, "Shared maps"); an object's
      // first trait makes its own
      if (!isMap(h.traits)) h.traits = {};
      if (!(desc.key in h.traits)) h.traits[desc.key] = newValue(desc);
    }, { label: `Add ${desc.name ?? desc.key}` });
  }

  function removeTrait(id, key) {
    editor(here).edit((d) => {
      const t = holderIn(d, id)?.traits;
      if (isMap(t) && key in t) delete t[key];
    }, { label: `Remove ${described.get(key)?.name ?? key}` });
  }

  /** Write one field of a trait (or of one of its entries, a seat), as the form gave it. */
  function writeTraitField(id, key, entry, field, formValue) {
    const w = fieldWrite(field, formValue);
    if (w.error) {
      api.use("notices")?.notify(w.error, "error");
      last = null;
      refreshNow(true);
      return;
    }
    editor(here).edit((d) => {
      let at = holderIn(d, id)?.traits?.[key];
      if (entry != null) at = isMap(at) ? at[entry] : null;
      if (!isMap(at)) return; // gone meanwhile, or not a map of fields
      if (w.remove) {
        if (field.key in at) delete at[field.key];
      } else at[field.key] = copy(w.value);
    }, { label: String(field.label ?? field.key) });
  }

  function addEntry(id, key, entries) {
    const eid = here.newId(entries.prefix);
    editor(here).edit((d) => {
      const t = holderIn(d, id)?.traits?.[key];
      if (isMap(t) && !(eid in t)) t[eid] = newValue(entries);
    }, { label: "Add" });
  }

  function removeEntry(id, key, eid) {
    editor(here).edit((d) => {
      const t = holderIn(d, id)?.traits?.[key];
      if (isMap(t) && eid in t) delete t[eid];
    }, { label: "Remove" });
  }

  /**
   * Start everyone who opens the scene in this body: doc.view.start.body
   * (Look, the default, is no key). A new body drops the old one's place;
   * the home camera and the editor stay.
   */
  function startIn(body) {
    editor(here).edit((d) => {
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
  /** Start everyone who opens the scene holding the editor, or not: doc.view.start.edit (not, the default, is no key). */
  function startEditing(on) {
    editor(here).edit((d) => {
      if (!isMap(d.view)) d.view = {};
      const was = isMap(d.view.start) ? d.view.start : null;
      if ((was?.edit === true) === on) return;
      if (!was) d.view.start = {};
      if (on) d.view.start.edit = true;
      else delete d.view.start.edit;
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
      const ctx = { scene, self: holder, nameOf: here.nameOf };
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
    view?.builtFrom?.dispose();
    view?.notes?.dispose();
    view?.build?.dispose();
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

  // ─── documents: a row each ────────────────────────────────────────────────

  /**
   * One document row (PLANS.md §5: no document is mounted here): its label,
   * Open Editor (the host shows the document on its own, in the row's tool:
   * patchwork:open-document) and Dock (a drawer pane of its own: the
   * drawer's dockDocument; "In the drawer" while it's there, a click shows
   * it). The row is dragged as a Patchwork document (dnd.js), so anything
   * that takes one (the drawer's tab strip, Patchwork's frame) takes it, and
   * as the scene's own (SECTION_MIME), so nothing in a scene adds it. A pane
   * is titled after what the row is of (`title`: "Built · Source").
   */
  function docRowView(doc) {
    const label = el("span", { class: "doc-row-label" });
    const openEditor = el("button", { type: "button", class: "button primary doc-open", title: "Open this document in its own editor" }, "Open Editor");
    const dock = el("button", { type: "button", class: "button link doc-dock", title: "Put this document in a pane of its own, in the drawer" }, "Dock");
    const root = el("div", { class: "doc-row", draggable: "true", title: "Drag to the drawer's tabs to dock it", dataset: { ext: doc.ext, section: doc.id } }, label, el("span", { class: "doc-row-acts" }, openEditor, dock));
    let shown = null;
    openEditor.addEventListener("click", () => root.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url: doc.url, ...(doc.toolId ? { toolId: doc.toolId } : {}) }, bubbles: true, composed: true })));
    dock.addEventListener("click", () => api.use("drawer")?.dockDocument({ url: doc.url, toolId: doc.toolId ?? null, title: shown?.title ?? doc.label }));
    root.addEventListener("dragstart", (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const item = { url: doc.url, name: shown?.title ?? doc.label, ...(doc.toolId ? { toolId: doc.toolId } : {}) };
      dt.setData(DND_MIME, JSON.stringify({ source: "scene", items: [item] }));
      dt.setData(URLS_MIME, JSON.stringify([doc.url]));
      dt.setData("text/plain", doc.url);
      dt.setData(SECTION_MIME, docKey(doc.url, doc.toolId));
      dt.effectAllowed = "copy";
    });
    return {
      root,
      update(next) {
        shown = next;
        if (label.textContent !== next.label) label.textContent = next.label;
        const docked = next.docked ? "In the drawer" : "Dock";
        if (dock.textContent !== docked) dock.textContent = docked;
        dock.title = next.docked ? "Show its pane in the drawer" : "Put this document in a pane of its own, in the drawer";
        root.toggleAttribute("data-docked", next.docked);
      },
      dispose() {},
    };
  }

  /**
   * The document rows for one selection that `pick` keeps (by documentsFor's
   * id): exactly documentsFor's, in its order. A row is kept while its
   * extension, id, url and tool stay; its label is updated in place.
   */
  function docRowsView(pick) {
    const section = el("div", { class: "doc-rows" });
    let live = new Map(); // `${ext}/${id}` → { identity, view }
    return {
      section,
      update(target) {
        const list = documentsFor(documents, target, here.context(null), ID).filter(pick);
        const docked = new Set(api.use("drawer")?.state().docs ?? []);
        // a drawer pane is titled after the object as well as the row (the scene's: the label alone)
        const of = target == null ? null : here.nameOf(target) || "Untitled";
        const paneTitle = (label) => (of ? `${of} · ${label}` : label);
        const next = new Map();
        for (const d of list) {
          const k = `${d.ext}/${d.id}`;
          const identity = docKey(d.url, d.toolId);
          let rec = live.get(k);
          if (rec && rec.identity !== identity) rec = null;
          rec ??= { identity, view: docRowView(d) };
          rec.view.update({ ...d, title: paneTitle(d.label), docked: docked.has(identity) });
          next.set(k, rec);
        }
        live = next;
        place(section, [...next.values()].map((r) => r.view.root));
        section.hidden = !next.size;
        return next.size;
      },
      dispose() {
        live = new Map();
      },
    };
  }

  /** What the "Built from" rows are: the object's source in its forms (inspector-model.js inspectorDocuments). */
  const BUILT_FROM = new Set(["source", "file", "link"]);
  /** The render doc's own document: its controls are "Built from"'s fields, not a row. */
  const BUILD_DOC = "build";

  /**
   * The build's controls, on its render doc: Rebuild (the stage's own build
   * loop, through a bubbling scene:rebuild event), Pinned (no rebuild on its
   * own), and its provider's params as fields. Writes are edits on the
   * render doc, so the scene's undo takes them back.
   */
  function buildControlsView(id, o) {
    const provider = providerOf(api.registry?.("scene:source"), o.providerId);
    const specs = Array.isArray(provider?.params) ? provider.params : [];
    const rebuild = el("button", { type: "button", class: "button rebuild", title: "Build it again from its source now" }, "Rebuild");
    const summary = el("span", { class: "build-summary" });
    const pinBox = el("input", { type: "checkbox", class: "pinned" });
    const params = el("div", { class: "build-params" });
    const section = el(
      "div",
      { class: "build-controls" },
      el("div", { class: "cluster" }, summary, rebuild, el("label", { class: "toggle", title: "Don't rebuild on its own when its source changes" }, pinBox, " Pinned")),
      specs.length ? el("div", { class: "field-group" }, el("span", { class: "group-label", title: "How this placement is built: its own settings, not its source's" }, "Settings"), params) : null,
    );
    let handle = null;
    let off = null;
    let dead = false;
    const edit = (fn, label) => handle && editor(here).edit(fn, { handle, label });
    const form = specs.length
      ? createParamForm(params, specs, (k, v) =>
          edit((d) => {
            if (!d.params) d.params = {};
            d.params[k] = v;
          }, String(specs.find((sp) => sp.key === k)?.label ?? k)),
        )
      : null;
    const sync = () => {
      const d = handle?.doc();
      if (!d) return;
      pinBox.checked = !!d.pinned;
      form?.update(d.params ?? {});
    };
    pinBox.addEventListener("change", () => edit((d) => void (d.pinned = pinBox.checked), pinBox.checked ? "Pin" : "Unpin"));
    rebuild.addEventListener("click", () => section.dispatchEvent(new CustomEvent(REBUILD_EVENT, { detail: { renderUrl: o.renderUrl }, bubbles: true, composed: true, cancelable: true })));
    Promise.resolve(o.renderUrl ? here.repo?.find(o.renderUrl) : null)
      .then((h) => {
        if (dead || !h) return;
        handle = h;
        h.on("change", sync);
        off = () => h.off("change", sync);
        sync();
      })
      .catch(() => {});
    return {
      section,
      /** The build in a line (inspector-model.js buildSummary), from the stage's load state. */
      summarize(load) {
        const text = buildSummary(load, here.now()) ?? "";
        if (summary.textContent !== text) summary.textContent = text;
      },
      dispose() {
        dead = true;
        off?.();
        form?.dispose();
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
    const reset = el("button", { type: "button", class: "button link layers-reset", title: "Show each layer as the file does", onclick: () => apply(here.ops.clearLayers(here.scene(), id), "Reset layers") }, "Reset");
    const section = el("div", { class: "field-group layers", hidden: true }, el("div", { class: "layers-head" }, el("span", { class: "group-label" }, "Layers"), reset), list);
    let key = null;
    const toggle = (layer, on) => {
      const v = on === layer.visible ? undefined : on;
      apply(here.ops.setLayerShown(here.scene(), id, layer.id, v), `${on ? "Show" : "Hide"} ${layer.name}`);
    };
    return {
      section,
      update(o) {
        const table = here.content(id)?.extras?.layers ?? [];
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
    groupSel.addEventListener("change", () => apply(here.ops.fileIn(here.scene(), id, groupSel.value || null)));
    const attach = group ? null : el("select", { class: "attach", "aria-label": "Attached to" });
    attach?.addEventListener("change", () => apply(here.ops.attachTo(here.scene(), id, attach.value || null)));

    const pos = group ? null : ["X", "Y", "Z"].map((a, i) => numberField(a, (v) => setPart(id, "position", i, fromUnits(v, units()))));
    const rot = group ? null : ["X", "Y", "Z"].map((a, i) => numberField(a, (v) => setPart(id, "rotation", i, v / DEG)));
    const scale = group ? null : numberField("×", (v) => setPart(id, "scale", 0, v));
    const posUnit = group ? null : el("span", { class: "unit" });

    const behaviours = behavioursView(id, "object");
    const layers = group ? null : layersView(id);
    const content = contentKind(here.loadState?.(id));
    const builtFrom = docRowsView((d) => BUILT_FROM.has(d.id));
    const notes = docRowsView((d) => !BUILT_FROM.has(d.id) && d.id !== BUILD_DOC);
    const build = !group && o.renderUrl ? buildControlsView(id, o) : null;
    // the header: what it is, and its Open (./open.js), the one way into what's inside
    const provider = group ? null : providerOf(api.registry?.("scene:source"), o.providerId);
    const kindText = group ? "Group" : linkOf(id) ? "Linked scene" : (provider?.name ?? "Object");
    const openBtn = el("button", { type: "button", class: "button primary open-thing", hidden: true, onclick: () => runOpen(api, id) }, "Open");
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
    const linkRow = linkOf(id) && !group
      ? {
          text: el("span", { class: "link-text" }),
          note: el("p", { class: "hint link-note" }, "What's in it is its own: Open it to change that."),
        }
      : null;

    const heading = (text, hint) => el("div", { class: "inspector-heading" }, el("h3", {}, text), hint ? el("span", { class: "hint" }, hint) : null);
    const root = el(
      "div",
      { class: "inspector", dataset: { id, kind: group ? "group" : "object" } },
      el("div", { class: "inspector-head" }, el("div", { class: "inspector-kind" }, kindText), el("div", { class: "inspector-title" }, name, openBtn)),
      heading("In this scene", "How this scene places and shows it"),
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
      group ? null : heading("Built from", "What it shows, and how it's made"),
      builtFrom.section,
      linkRow ? el("div", { class: "field link-row" }, el("span", {}, "Link"), linkRow.text) : null,
      linkRow ? linkRow.note : null,
      version ? el("div", { class: "field version-row" }, el("span", {}, "Version"), version.text) : null,
      version ? el("div", { class: "cluster version-actions" }, version.fix, version.follow) : null,
      status,
      build?.section,
      notes.section,
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
      openBtn,
      builtFrom,
      notes,
      build,
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
    const notes = docRowsView(() => true);
    const starts = el("div", { class: "starts-in", role: "radiogroup", "aria-label": "Starts in" });
    const editBox = el("input", { type: "checkbox", dataset: { start: "edit" } });
    editBox.addEventListener("change", () => startEditing(editBox.checked));
    const note = el("p", { class: "hint starts-in-note" });
    const root = el(
      "div",
      { class: "inspector", dataset: { kind: "scene" } },
      el("div", { class: "inspector-head" }, el("div", { class: "inspector-kind" }, "Scene")),
      behaviours.section,
      el("div", { class: "field-group starts-in-group" }, el("span", { class: "group-label", title: "Where everyone who opens this scene starts out: looking at it or in a body (walking, seated), and whether editing it" }, "Starts in"), starts, el("label", { class: "toggle" }, editBox, " editing"), note),
      notes.section,
    );
    body.replaceChildren(root);
    view = { id: null, scene: true, root, behaviours, notes, starts, editBox, note, startsKey: null };
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
        bodies.length > 1
          ? "Everyone who opens this scene starts here, once. Each viewer can change body, and pick up or put down the editor, for themselves."
          : "Everyone who opens this scene starts here, once: Look shows it; editing, they hold the editor. A package that brings a body (walking, seats) adds a choice.";
    }
    for (const radio of view.starts.querySelectorAll("input[data-body]")) radio.checked = radio.dataset.body === want;
    view.editBox.checked = scene.d?.view?.start?.edit === true;
    view.notes.update(null);
  }

  // the field shows `v`, unless someone is typing in it (or `force`)
  const setVal = (input, v, force) => {
    if (input && (force || document.activeElement !== input) && input.value !== v) input.value = v;
  };

  function fill(scene, local, force) {
    const id = view.id;
    const objects = scene.objects;
    const o = objects[id];
    const seen = here.nameOf(id);
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
      const aOpts = attachOptions(scene, id, here.nameOf);
      const aKey = JSON.stringify(aOpts);
      if (view.attachKey !== aKey && (force || document.activeElement !== view.attach)) {
        view.attachKey = aKey;
        view.attach.replaceChildren(el("option", { value: "" }, "None"), ...aOpts.map(opt));
      }
      const parent = scene.parents.get(id) ?? null;
      setVal(view.attach, parent ?? "", force);
      const u = units();
      const unitText = parent ? `(${u}, relative to ${here.nameOf(parent) || "parent"})` : `(${u})`;
      if (view.posUnit.textContent !== unitText) view.posUnit.textContent = unitText;
      const t = normalizeTransform(o.transform);
      view.pos.forEach((f, i) => setVal(f.input, String(roundForDisplay(toUnits(t.position[i], u), 6)), force));
      view.rot.forEach((f, i) => setVal(f.input, String(roundForDisplay(t.rotation[i] * DEG, 6)), force));
      setVal(view.scale.input, String(t.scale), force);
    }

    view.layers?.update(o);
    view.behaviours.update(scene);
    fillStatus(scene, local, o);
    fillVersion(o);
    fillLink();
    fillOpen();
    view.build?.summarize(here.loadState?.(id));
    view.builtFrom.update(id);
    view.notes.update(id);
  }

  /** The header's Open: the selection's (./open.js), labelled as it says; none, no button. */
  function fillOpen() {
    const o = openFor(api.collect("commands"), view.id, here.context(null));
    const b = view.openBtn;
    b.hidden = !o;
    if (!o) return;
    const label = String(o.state.label ?? o.command.name ?? "Open");
    if (b.textContent !== label) b.textContent = label;
    b.title = o.state.title ? `${o.state.title} (double-click, Enter)` : "Edit what's inside, in place (double-click, Enter)";
    b.dataset.ext = o.ext;
    b.dataset.command = o.command.id;
  }

  /** The Link row: what the link is here, as the view has it. */
  function fillLink() {
    const r = view.linkRow;
    if (!r) return;
    const text = linkText(linkOf(view.id));
    if (r.text.textContent !== text) r.text.textContent = text;
  }

  /** The Version row: Latest or Fixed at…, and which button makes sense. */
  function fillVersion(o) {
    const v = view.version;
    if (!v) return;
    const s = here.loadState(view.id) ?? {};
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

  function fillStatus(scene, local, o) {
    const id = view.id;
    const status = local.status?.[id] ?? null;
    const load = here.loadState?.(id) ?? null;
    const content = here.content(id);
    const parts = statusParts(o, { status, load, content, shown: contentKind(load) === "file" ? shownIn(scene, id) : true });
    const key = JSON.stringify(parts);
    if (key === view.statusKey) return;
    view.statusKey = key;
    view.status.replaceChildren(...parts.map((p) => (p.kind === "notes" ? el("span", { class: "notes" }, p.text) : el("p", { class: p.kind }, p.text))));
    view.status.hidden = !parts.length;
  }

  const contentKey = (id) => {
    const c = id ? here.content(id) : null;
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
    const lk = linkOf(id);
    const fresh = !view || view.id !== id || view.group !== isGroup(o) || view.renderUrl !== (o.renderUrl ?? null) || view.content !== contentKind(here.loadState?.(id)) || !!view.linkRow !== (!!lk && !isGroup(o));
    const name = here.nameOf(id);
    const ck = `${contentKey(id)}|${JSON.stringify(lk)}`;
    if (!fresh && !force && last && last.scene === scene && !localChanged(last.local, local) && last.name === name && last.content === ck) return;
    if (fresh) build(id, o);
    last = { scene, local, name, content: ck };
    fill(scene, local, force || fresh);
  }

  const refreshNow = (force = false) => refresh(here.scene(), now(), force);

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
      show: ["menu"],
      state: (target, { scene }) => (objectOf(target, scene) ? { title: "Fit the view to this" } : null),
      run: (target) => {
        const o = objectOf(target, here.scene());
        const box = !o ? null : isGroup(o) ? here.groupBox(target) : here.box(target);
        if (box) here.camera.frame(box);
      },
    },
    {
      id: "group",
      edit: true,
      name: "Group",
      shortcut: "Mod+G",
      show: ["menu"],
      state: (target, { scene }) => {
        const o = objectOf(target, scene);
        return o && !isGroup(o) ? { title: "Put this object in a new group" } : null;
      },
      run: (target) => {
        const plan = apply(here.ops.newGroup(here.scene(), { around: target, id: here.newId("g") }), "Group");
        if (plan?.id) select(plan.id);
      },
    },
    {
      id: "ungroup",
      edit: true,
      name: "Ungroup",
      shortcut: "Shift+Mod+G",
      show: ["menu"],
      state: (target, { scene }) => (isGroup(objectOf(target, scene)) ? { title: "Move what's in this group up a level, where it is, and remove the group" } : null),
      run: (target) => {
        const plan = apply(here.ops.ungroup(here.scene(), target), "Ungroup");
        if (plan && selectedOf(here.view.get()) === target) select(null);
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
    // the inspector is the editor's (../stage/bodies.js): only while editing, where
    // a selection opens it and it stays open (on the scene when nothing is
    // selected) until its × or the toolbar shuts it, or the editor is put down
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
    group: "panels",
    edit: true,
    show: ["toolbar"],
    state: (target) => (target == null ? { checked: tab.isOpen(), title: "Everything in the scene as a tree, and the selection's fields and behaviours (the scene's, with nothing selected)" } : null),
    run(_target, value) {
      const open = value === undefined ? !tab.isOpen() : !!value;
      asked = open;
      dismissed = !open;
      follow(here.scene(), now());
    },
  });

  return {
    commands,
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

export default { create };
