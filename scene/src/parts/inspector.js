// scene.inspector: the "inspector" panel for local.selected (old tool.js
// ~1288-1591: buildInspector, updateInspector, updateAbout, mountControls).
//
// For an object: name (read-only when a lens names it), Visible, Wireframe,
// Locked, Colour (+ Auto), Opacity, In group (the groups as a tree), Attached
// to (objects), Position (display units, the pref "units"), Rotation (°),
// Scale; "Open file" for a passthrough GLB. For a group: name, Visible,
// Opacity, In group. Then the commands that apply to it (every running
// extension's, shown on "inspector" or on every surface) as buttons: this
// extension's Frame, Group and Ungroup first. Then About (the object's
// infoUrl, else its nearest group's, in a <patchwork-view> inside
// .about-embed), the embedded build controls (scene-render-controls on the
// render doc) and the status line.
//
// Every write goes through api.ops; a refusal (plan.ok === false) is said
// with api.notify and the field shows the doc again. Fields being typed in
// are never overwritten.
//
// Nothing selected: the panel body is hidden (the sidebar then hides the
// section) and holds only the hint "Nothing selected".

import css from "./inspector.css?inline";
import { isGroup } from "../groups.js";
import { fromUnits, roundForDisplay, toUnits } from "../units.js";
import { normalizeTransform } from "../transform.js";
import { DEG, aboutFor, attachOptions, commandsFor, commandsKey, groupOptions, isPassthrough, lensNamed, shownIn, statusParts } from "./inspector-model.js";

const ID = "scene.inspector";
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
  const select = (id) => api.local.swap((m) => ((m.selected ?? null) === (id ?? null) ? m : { ...m, selected: id ?? null }));

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

    const commands = el("div", { class: "cluster commands" });
    const openFile = isPassthrough(o) ? el("button", { type: "button", class: "button link open-file", title: "Open the GLB file", onclick: (e) => openDocument(e.currentTarget, api.doc().objects?.[id]?.sourceUrl) }, "Open file") : null;
    const about = el("section", { class: "about", hidden: true });
    const controls = o.renderUrl ? el("div", { class: "controls-embed" }) : null;
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
      commands,
      openFile ? el("div", { class: "cluster" }, openFile) : null,
      about,
      controls ? el("div", { class: "panel-head build-head" }, el("h3", { class: "panel-title" }, "Build")) : null,
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
      commands,
      commandsKey: null,
      about,
      aboutKey: null,
      unmountAbout: null,
      status,
      statusKey: null,
      unmountControls: controls ? mountControls(controls, o.renderUrl) : null,
    };
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

    fillCommands(scene, local);
    fillAbout(scene);
    fillStatus(scene, local, o);
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
    const embed = el("div", { class: "about-embed" });
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
      if (api.signal.aborted || !view || !last) return;
      if (api.nameOf(view.id) !== last.name) refreshNow();
    });
  }

  // ─── commands ─────────────────────────────────────────────────────────────

  const objectOf = (target, scene) => (target != null ? scene?.objects?.[target] ?? null : null);

  const commands = [
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
