// scene.inspector: the "inspector" panel for local.selected (old tool.js
// ~1288-1591: buildInspector, updateInspector, updateAbout, mountControls).
//
// For an object: name (read-only when a lens names it), Visible, Wireframe,
// Locked, Colour (+ Auto), Opacity, In group (the groups as a tree), Attached
// to (objects), Position (display units, the pref "units"), Rotation (°),
// Scale; "Open file" for a passthrough GLB. For a group: name, Visible,
// Opacity, In group. Then its Behaviours (below). Then the commands that
// apply to it (every running extension's, shown on "inspector" or on every
// surface) as buttons: this extension's Frame, Group and Ungroup first. Then
// About (the object's infoUrl, else its nearest group's, in a
// <patchwork-view> inside .about-embed), the embedded build controls
// (scene-render-controls on the render doc), the Version row (what version of
// its source a render-doc object shows: Latest, or Fixed at… with Fix at this
// version / Follow latest, which are also this extension's commands for the
// menu) and the status line.
//
// Nothing selected: the Scene. Its Behaviours (the scene's own traits), and
// Starts in: the activity everyone who opens the scene starts in
// (doc.view.activity), a choice of those the scene offers
// (local.activities.available); each viewer can still switch for themselves.
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
// api.change); a refusal (plan.ok === false) is said with api.notify and the
// field shows the doc again. Fields being typed in are never overwritten.
//
// A selection that isn't a scene object (a ref such as a dimension: its owner
// shows it, in its own panel), or one that's gone: the panel body is hidden
// (the sidebar then hides the section) and holds only the hint "Nothing
// selected".

import css from "./inspector.css?inline";
import { isGroup } from "../groups.js";
import { fromUnits, roundForDisplay, toUnits } from "../units.js";
import { normalizeTransform } from "../transform.js";
import { EMBED_ATTR } from "../embed.js";
import { atKey, normalizeAt } from "../staleness.js";
import { createParamForm } from "../param-form.js";
import { activityLabel } from "../activities.js";
import { addableTraits, describedTraits, entriesOf, fieldWrite, formSpecs, layoutKey, newValue, shownValues, traitRows } from "./inspector-traits.js";
import { DEG, aboutFor, attachOptions, commandsFor, commandsKey, groupOptions, isPassthrough, lensNamed, shownIn, statusParts } from "./inspector-model.js";

const ID = "scene.inspector";
// each inspector's own radio group: two views of one scene on a page mustn't share one
let startsGroups = 0;
const OPEN_EVENT = "patchwork:open-document";
const CONTROLS_TOOL = "scene-render-controls";
// local keys whose change can't change what the inspector shows
const IGNORED_LOCAL = new Set(["hovered", "notices", "armed"]);

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

const canEmbed = () => !!globalThis.customElements?.get?.("patchwork-view");

/** Heads, shortened for display: the first 8 characters of each. */
function shortHeads(heads) {
  return (heads ?? []).map((h) => String(h).slice(0, 8)).join(" + ");
}

function openDocument(from, url, toolId = null) {
  from.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url, ...(toolId ? { toolId } : {}) }, bubbles: true, composed: true }));
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
  const units = () => api.pref("units", "m");

  // ─── doc writes, through the planners ──────────────────────────────────────

  /** Apply a plan; a refusal is said, and the fields show the doc again. */
  function apply(plan) {
    if (!plan) {
      refreshNow(true);
      return null;
    }
    if (plan.ok === false) {
      api.notify(plan.reason, "error");
      refreshNow(true);
      return null;
    }
    api.change(plan);
    return plan;
  }
  const setField = (id, key, value) => apply(api.ops.setField(api.scene(), id, key, value));
  const setPart = (id, kind, i, v) => apply(api.ops.setTransformPart(api.scene(), id, kind, i, v));
  // ─── fixed versions (`at`) ───────────────────────────────────────────────

  /** Where api.fixPoint would fix it (null: not built here yet, or no fixPoint in this stage). */
  const fixPointOf = (id) => (typeof api.fixPoint === "function" ? api.fixPoint(id) : null);

  /** Fix an object at exactly what its render was last built from. */
  function fixVersion(id) {
    const point = fixPointOf(id);
    if (!point) return void api.notify("It hasn't been built here yet, so there's no version to fix.", "error");
    apply(api.ops.setField(api.scene(), id, "at", point));
  }

  const followLatest = (id) => apply(api.ops.setField(api.scene(), id, "at", undefined));

  const select = (id) => api.local.swap((m) => ((m.selected ?? null) === (id ?? null) ? m : { ...m, selected: id ?? null }));

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
    api.change((d) => {
      const h = holderIn(d, id);
      if (!h) return;
      // the scene's map is pre-created (STAGE.md, Migrations); an object's
      // first trait makes its own
      if (!isMap(h.traits)) h.traits = {};
      if (!(desc.key in h.traits)) h.traits[desc.key] = newValue(desc);
    });
  }

  function removeTrait(id, key) {
    api.change((d) => {
      const t = holderIn(d, id)?.traits;
      if (isMap(t) && key in t) delete t[key];
    });
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
    api.change((d) => {
      let at = holderIn(d, id)?.traits?.[key];
      if (entry != null) at = isMap(at) ? at[entry] : null;
      if (!isMap(at)) return; // gone meanwhile, or not a map of fields
      if (w.remove) {
        if (field.key in at) delete at[field.key];
      } else at[field.key] = copy(w.value);
    });
  }

  function addEntry(id, key, entries) {
    const eid = api.newId(entries.prefix);
    api.change((d) => {
      const t = holderIn(d, id)?.traits?.[key];
      if (isMap(t) && !(eid in t)) t[eid] = newValue(entries);
    });
  }

  function removeEntry(id, key, eid) {
    api.change((d) => {
      const t = holderIn(d, id)?.traits?.[key];
      if (isMap(t) && eid in t) delete t[eid];
    });
  }

  /** Start everyone who opens the scene in this activity: doc.view.activity ("edit", the default, is no key). */
  function startIn(activity) {
    api.change((d) => {
      if (!d.view) d.view = {};
      if (activity === "edit") {
        if ("activity" in d.view) delete d.view.activity;
      } else if (d.view.activity !== activity) d.view.activity = activity;
    });
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

  let body = null; // the panel body, while mounted
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
    view?.unmountControls?.();
    view?.unmountAbout?.();
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

  function mountControls(container, renderUrl) {
    // Prefer the real embed, so the controls tool resolves through the registry.
    if (canEmbed()) {
      const v = document.createElement("patchwork-view");
      v.setAttribute("doc-url", renderUrl);
      v.setAttribute("tool-id", CONTROLS_TOOL);
      container.append(v);
      return () => v.remove();
    }
    let cleanup = null;
    let gone = false;
    Promise.all([api.repo.find(renderUrl), import("../controls-tool.js")])
      .then(([h, m]) => {
        if (!gone) cleanup = m.default(h, container);
      })
      .catch((err) => {
        if (!gone) container.append(el("p", { class: "error" }, `Controls unavailable: ${err?.message ?? err}`));
      });
    return () => {
      gone = true;
      try {
        cleanup?.();
      } catch (err) {
        console.warn("[scene] build controls failed to unmount", err);
      }
      container.replaceChildren();
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
    const commands = el("div", { class: "cluster commands" });
    const openFile = isPassthrough(o) ? el("button", { type: "button", class: "button link open-file", title: "Open the GLB file", onclick: (e) => openDocument(e.currentTarget, api.doc().objects?.[id]?.sourceUrl) }, "Open file") : null;
    const about = el("section", { class: "about", hidden: true });
    const controls = o.renderUrl ? el("div", { class: "controls-embed" }) : null;
    // Which version of the source it shows (`at`); only a render doc can be fixed.
    const version = o.renderUrl
      ? {
          text: el("span", { class: "version-text" }),
          fix: el("button", { type: "button", class: "button fix-version", onclick: () => fixVersion(id) }, "Fix at this version"),
          follow: el("button", { type: "button", class: "button follow-latest", title: "Follow edits to the source again", onclick: () => followLatest(id) }, "Follow latest"),
          key: null,
        }
      : null;
    const status = el("div", { class: "status-line", hidden: true });

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
        locked ? el("label", { class: "toggle", title: "A locked object can't be moved with the hand or the gizmo (a game board, say)" }, locked, " Locked") : null,
      ),
      group ? null : el("div", { class: "cluster" }, el("label", { class: "toggle" }, "Colour ", colorIn), resetColor),
      el("label", { class: "field" }, el("span", {}, "Opacity"), opacity),
      el("label", { class: "field", title: "Which group it's filed in: groups organise, and hide or fade what's in them; nothing moves" }, el("span", {}, "In group"), groupSel),
      group ? null : el("label", { class: "field", title: "Attached objects move with the object they're attached to; their position is relative to it" }, el("span", {}, "Attached to"), attach),
      group ? null : el("div", { class: "field-group" }, el("span", { class: "group-label" }, "Position ", posUnit), el("div", { class: "triple" }, ...pos.map((f) => f.row))),
      group ? null : el("div", { class: "field-group" }, el("span", { class: "group-label" }, "Rotation °"), el("div", { class: "triple" }, ...rot.map((f) => f.row))),
      group ? null : el("div", { class: "field-group" }, el("span", { class: "group-label" }, "Scale"), el("div", { class: "triple" }, scale.row)),
      behaviours.section,
      commands,
      openFile ? el("div", { class: "cluster" }, openFile) : null,
      about,
      controls ? el("div", { class: "panel-head build-head" }, el("h3", { class: "panel-title" }, "Build")) : null,
      version ? el("div", { class: "field version-row" }, el("span", {}, "Version"), version.text) : null,
      version ? el("div", { class: "cluster version-actions" }, version.fix, version.follow) : null,
      controls,
      status,
    );
    body.replaceChildren(root);
    view = {
      id,
      group,
      renderUrl: o.renderUrl ?? null,
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
      commands,
      commandsKey: null,
      about,
      aboutKey: null,
      unmountAbout: null,
      status,
      statusKey: null,
      version,
      unmountControls: controls ? mountControls(controls, o.renderUrl) : null,
    };
  }

  /** Nothing selected: the scene's own Behaviours, and the activity it starts people in. */
  function buildScene() {
    teardown();
    const behaviours = behavioursView(null, "scene");
    const starts = el("div", { class: "starts-in", role: "radiogroup", "aria-label": "Starts in" });
    const note = el("p", { class: "hint starts-in-note" });
    const root = el(
      "div",
      { class: "inspector", dataset: { kind: "scene" } },
      el("div", { class: "inspector-kind" }, "Scene"),
      behaviours.section,
      el("div", { class: "field-group starts-in-group" }, el("span", { class: "group-label", title: "What everyone who opens this scene starts out doing" }, "Starts in"), starts, note),
    );
    body.replaceChildren(root);
    view = { id: null, scene: true, root, behaviours, starts, note, startsKey: null };
  }

  function fillScene(scene, local) {
    view.behaviours.update(scene);
    const available = Array.isArray(local?.activities?.available) && local.activities.available.length ? local.activities.available : ["edit"];
    const key = available.join("\n");
    if (key !== view.startsKey) {
      view.startsKey = key;
      view.starts.replaceChildren(
        ...available.map((a) => {
          const radio = el("input", { type: "radio", name: startsName, value: a, dataset: { activity: a } });
          radio.addEventListener("change", () => {
            if (radio.checked) startIn(a);
          });
          return el("label", { class: "toggle" }, radio, ` ${activityLabel(a)}`);
        }),
      );
      view.note.textContent =
        available.length > 1
          ? "Everyone who opens this scene starts here. Each viewer can switch for themselves."
          : "Editing is all this scene offers. A behaviour that's played (a game's) adds a choice.";
    }
    const want = scene.d?.view?.activity;
    const start = available.includes(want) ? want : "edit";
    for (const radio of view.starts.querySelectorAll("input[data-activity]")) radio.checked = radio.dataset.activity === start;
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

    view.behaviours.update(scene);
    fillCommands(scene, local);
    fillAbout(scene);
    fillStatus(scene, local, o);
    fillVersion(o);
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
    v.fix.title = !point ? "Not built here yet: nothing to fix" : "Keep showing exactly what is built now, whatever later edits to the source do";
    v.follow.disabled = !at;
  }

  function fillCommands(scene, local) {
    const list = commandsFor(api.collect("commands"), view.id, { scene, local }, ID);
    const key = commandsKey(list);
    if (key === view.commandsKey) return;
    view.commandsKey = key;
    const target = view.id;
    const buttons = list.map(({ ext, command, state }) => {
      const title = state.title ?? "";
      if (Array.isArray(state.choices)) {
        const sel = el("select", { class: "command-choice", "aria-label": command.name ?? command.id, title, disabled: !!state.disabled, dataset: { ext, command: command.id } });
        state.choices.forEach((c, i) => sel.append(el("option", { value: String(i) }, c?.label ?? String(c?.value ?? ""))));
        const at = state.choices.findIndex((c) => c?.value === state.value);
        if (at >= 0) sel.value = String(at);
        sel.addEventListener("change", () => api.run({ ext, command: command.id, target, value: state.choices[Number(sel.value)]?.value }));
        return el("label", { class: "toggle" }, `${command.name ?? command.id} `, sel);
      }
      const toggle = state.checked != null;
      return el(
        "button",
        {
          type: "button",
          class: `button${command.id === "remove" ? " danger" : ""}`,
          title,
          disabled: !!state.disabled,
          "aria-pressed": toggle ? String(!!state.checked) : null,
          dataset: { ext, command: command.id },
          onclick: () => api.run(toggle ? { ext, command: command.id, target, value: !state.checked } : { ext, command: command.id, target }),
        },
        command.name ?? command.id,
      );
    });
    view.commands.replaceChildren(...buttons);
    view.commands.hidden = !buttons.length;
  }

  function fillAbout(scene) {
    const about = aboutFor(scene, view.id);
    const key = about && canEmbed() ? `${about.url}|${about.toolId ?? ""}|${about.label}` : "";
    if (key === view.aboutKey) return;
    view.aboutKey = key;
    view.unmountAbout?.();
    view.unmountAbout = null;
    const section = view.about;
    if (!key) {
      section.hidden = true;
      section.replaceChildren();
      return;
    }
    // the stage's embed marker: keys, pastes and drops in there are that tool's
    const embed = el("div", { class: "about-embed", [EMBED_ATTR]: "" });
    const v = document.createElement("patchwork-view");
    v.setAttribute("doc-url", about.url);
    if (about.toolId) v.setAttribute("tool-id", about.toolId);
    embed.append(v);
    const open = el("button", { type: "button", class: "button link open-about", title: "Open this document", onclick: () => openDocument(section, about.url, about.toolId) }, "Open");
    section.replaceChildren(el("div", { class: "panel-head" }, el("h3", { class: "panel-title about-title" }, about.label), open), embed);
    section.hidden = false;
    view.unmountAbout = () => v.remove();
  }

  function fillStatus(scene, local, o) {
    const id = view.id;
    const status = local.status?.[id] ?? null;
    const load = typeof api.loadState === "function" ? api.loadState(id) : null;
    const content = api.content(id);
    const passthrough = isPassthrough(o);
    const parts = statusParts(o, { status, load, content, shown: passthrough ? shownIn(scene, id) : true });
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
    const fresh = !view || view.id !== id || view.group !== isGroup(o) || view.renderUrl !== (o.renderUrl ?? null);
    const name = api.nameOf(id);
    const ck = contentKey(id);
    if (!fresh && !force && last && last.scene === scene && !localChanged(last.local, local) && last.name === name && last.content === ck) return;
    if (fresh) build(id, o);
    last = { scene, local, name, content: ck };
    fill(scene, local, force || fresh);
    queueNames();
  }

  const refreshNow = (force = false) => refresh(api.scene(), api.local.get(), force);

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
      name: "Fix at this version",
      show: ["menu"],
      state: (target, { scene }) => {
        const o = objectOf(target, scene);
        if (!o || isGroup(o) || !o.renderUrl || normalizeAt(o.at)) return null;
        const point = fixPointOf(target);
        return point ? { title: "Keep showing exactly what is built now, whatever later edits to the source do" } : { title: "Not built here yet: nothing to fix", disabled: true };
      },
      run: (target) => fixVersion(target),
    },
    {
      id: "follow-latest",
      name: "Follow latest",
      show: ["menu"],
      state: (target, { scene }) => {
        const o = objectOf(target, scene);
        return o && !isGroup(o) && o.renderUrl && normalizeAt(o.at) ? { title: "Follow edits to the source again" } : null;
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
      name: "Group",
      show: ["inspector", "menu"],
      state: (target, { scene }) => {
        const o = objectOf(target, scene);
        return o && !isGroup(o) ? { title: "Put this object in a new group" } : null;
      },
      run: (target) => {
        const plan = apply(api.ops.newGroup(api.scene(), { around: target, id: api.newId("g") }));
        if (plan?.id) select(plan.id);
      },
    },
    {
      id: "ungroup",
      name: "Ungroup",
      show: ["inspector", "menu"],
      state: (target, { scene }) => (isGroup(objectOf(target, scene)) ? { title: "Move what's in this group up a level, where it is, and remove the group" } : null),
      run: (target) => {
        const plan = apply(api.ops.ungroup(api.scene(), target));
        if (plan && selectedOf(api.local.get()) === target) select(null);
      },
    },
  ];

  return {
    commands,
    panels: [
      {
        id: "inspector",
        title: "Inspector",
        pinned: true, // never folds
        mount(host) {
          body = host;
          body.classList.add("inspector-body");
          view = null;
          last = null;
          showEmpty();
          refreshNow();
          return {
            update: (scene, local) => refresh(scene, local),
            dispose() {
              teardown();
              if (body === host) {
                body.replaceChildren();
                body = null;
              }
              last = null;
            },
          };
        },
      },
    ],
    dispose() {
      teardown();
      body = null;
    },
  };
}

export default { create };
