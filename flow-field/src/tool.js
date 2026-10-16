// The flow-field editor: a top-down view of the flow at one height, with a
// speed / Cp heatmap, in-plane streamlines, draggable singularities and a
// freestream dial. Everything that matters lives in the doc, so two people
// editing the same flow see each other's drags live; view settings
// (colour-by, slice height, layers) are local to each viewer.

import css from "./styles.css?inline";
import { compileField, KINDS, KIND_LABELS, STRENGTH_UNITS } from "./field.js";
import { rakeSeeds, traceStreamline, bodyHugSeeds, traceThrough, widenAcross } from "./integrate.js";
import { autoColormap, sampleColormap, robustRange, symmetricRange, isDiverging, cssColor } from "./colormap.js";
import {
  fitView,
  toScreen,
  toWorld,
  hitElement,
  dialGeometry,
  hitDial,
  headingFromDial,
  sampleHeatmap,
  roundMm,
  defaultStrength,
  newElementId,
  unmaskedRuns,
  probeText,
} from "./view2d.js";
import { flowFingerprint, stableStringify } from "./fingerprint.js";
import { PRESETS, presetFlow } from "./presets.js";
import { compileFlow } from "./flow.js";
import {
  normalizeBodySpec,
  snapshotElements,
  BODY_MODELS,
  BODY_MODEL_LABELS,
  DEFAULT_PANELS,
  MIN_PANELS,
  MAX_PANELS,
} from "./body.js";
import { acquireSection, sectionPathLabel, renderTitle } from "./section.js";
import { isRenderDoc, renderKey } from "./render-read.js";
import { loadGetRegistry } from "./registry.js";
import { hasPatchworkDrop, parsePatchworkDrop, parseAutomergeUrl } from "./dnd.js";

/** How long a burst of hull edits settles before the section is cut again. */
export const HULL_DEBOUNCE_MS = 250;
/** A section that couldn't be had here (hull not synced, no provider yet) is tried again, backing off to this. */
export const SECTION_RETRY_MS = 1_000;
export const SECTION_RETRY_MAX_MS = 30_000;

async function titleOf(doc, datatype) {
  try {
    const get = await loadGetRegistry();
    const dt = datatype && get ? await get("patchwork:datatype").load(datatype) : null;
    const t = dt?.module?.getTitle?.(doc);
    if (t) return String(t);
  } catch {
    // fall back below
  }
  // a render doc's datatype (scene) appends this to its title; say the same without it
  if (isRenderDoc(doc)) return `${renderTitle(doc)} (3D render)`;
  return String(doc?.title || doc?.name || datatype || "linked document");
}

const GLYPH = { source: "+", sink: "−", doublet: "±", "vortex-line": "↺" };

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "–");
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const numberOr = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Set an input's value unless someone is typing in it. */
function setValue(input, v) {
  if (document.activeElement === input) return;
  const s = typeof v === "number" ? String(roundMm(v)) : String(v ?? "");
  if (input.value !== s) input.value = s;
}

function numberInput(onCommit, attrs = {}) {
  const input = el("input", { type: "number", step: "any", ...attrs });
  input.addEventListener("change", () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onCommit(v);
  });
  return input;
}

export default function FlowFieldTool(handle, element) {
  const style = el("style", { text: css });
  const root = el("div", { class: "flow-field" });
  element.append(style, root);

  // ── local view state ────────────────────────────────────────────────────
  const view = {
    colorBy: "cp",
    showHeat: true,
    showLines: true,
    mask: true,
    z: 0,
    selected: null,
    armed: null, // kind waiting to be placed
    hover: null, // element id
    probe: null, // [x, y] world
    linking: false, // the "Link hull…" URL box is open
    confirmUnlink: false,
    notice: null, // { text, tone } shown in the Body section
  };
  let drag = null; // { type: "element", id, dx, dy } | { type: "dial" } while a pointer is down
  let hoverDial = false;
  let dead = false;

  // ── toolbar ─────────────────────────────────────────────────────────────
  const addButtons = KINDS.map((kind) =>
    el(
      "button",
      {
        type: "button",
        "data-kind": kind,
        title: `Add a ${KIND_LABELS[kind].toLowerCase()} — then click where it goes`,
        onclick: () => {
          view.armed = view.armed === kind ? null : kind;
          syncToolbar();
          canvas.focus();
        },
      },
      el("span", { class: "glyph", text: GLYPH[kind] }),
      KIND_LABELS[kind],
    ),
  );
  const colorSelect = el(
    "select",
    { "aria-label": "Colour by", onchange: (e) => ((view.colorBy = e.target.value), draw()) },
    el("option", { value: "cp", text: "Pressure (Cp)" }),
    el("option", { value: "speed", text: "Speed" }),
  );
  const check = (label, key) => {
    const input = el("input", { type: "checkbox", onchange: (e) => ((view[key] = e.target.checked), draw()) });
    input.checked = view[key];
    return el("label", { class: "cluster" }, input, label);
  };
  const zRange = el("input", {
    type: "range",
    step: "0.05",
    "aria-label": "Slice height",
    oninput: (e) => {
      view.z = parseFloat(e.target.value);
      zLabel.textContent = `z = ${fmt(view.z)} m`;
      draw();
    },
  });
  const zLabel = el("span", { class: "label" });
  const presetSelect = el(
    "select",
    {
      "aria-label": "Load a preset",
      onchange: (e) => {
        const flow = presetFlow(e.target.value);
        e.target.value = "";
        if (!flow) return;
        handle.change((d) => {
          d.freestream = flow.freestream;
          d.elements = flow.elements;
        });
        view.selected = null;
      },
    },
    el("option", { value: "", text: "Load preset…" }),
    ...PRESETS.map((p) => el("option", { value: p.id, text: p.name })),
  );
  colorSelect.value = view.colorBy;

  const toolbar = el(
    "div",
    { class: "toolbar cluster" },
    el("div", { class: "cluster" }, ...addButtons),
    el("div", { class: "cluster" }, el("span", { class: "label", text: "Colour" }), colorSelect),
    el("div", { class: "cluster" }, check("Heatmap", "showHeat"), check("Streamlines", "showLines"), check("Mask bodies", "mask")),
    el("div", { class: "cluster" }, el("span", { class: "label", text: "Height" }), zRange, zLabel),
    el("div", { class: "cluster" }, presetSelect),
  );

  // ── stage ───────────────────────────────────────────────────────────────
  const canvas = el("canvas", { class: "main", tabindex: "0", "aria-label": "Flow field, top view" });
  const legendBar = el("canvas", { width: "144", height: "10" });
  const legendTitle = el("span", { class: "title" });
  const legendMin = el("span");
  const legendMax = el("span");
  const legend = el("div", { class: "legend" }, legendTitle, legendMin, legendBar, legendMax);
  const readout = el("div", { class: "readout" });
  const stage = el("div", { class: "stage" }, canvas, legend, readout);

  // ── panel ───────────────────────────────────────────────────────────────
  const write = (fn) => handle.change((d) => fn(d));
  const speedInput = numberInput((v) =>
    write((d) => {
      d.freestream ??= { speed: 0, headingDeg: 0 };
      d.freestream.speed = Math.max(0, v);
    }),
    { min: "0", "aria-label": "Freestream speed" },
  );
  const headingInput = numberInput((v) =>
    write((d) => {
      d.freestream ??= { speed: 0, headingDeg: 0 };
      d.freestream.headingDeg = ((v % 360) + 360) % 360;
    }),
    { "aria-label": "Freestream heading" },
  );
  const selectedBox = el("div");
  const elementList = el("ul", { class: "elements" });
  const domainInputs = ["min", "max"].map((which) =>
    [0, 1, 2].map((k) =>
      numberInput(
        (v) =>
          write((d) => {
            d.domain ??= { min: [-6, -6, -4], max: [16, 6, 4] };
            if (!Array.isArray(d.domain[which]) || d.domain[which].length !== 3) d.domain[which] = [0, 0, 0];
            d.domain[which][k] = v;
          }),
        { "aria-label": `Domain ${which} ${"xyz"[k]}` },
      ),
    ),
  );
  const seedInput = numberInput(
    (v) =>
      write((d) => {
        d.seeds ??= { count: 15 };
        d.seeds.count = Math.max(1, Math.min(40, Math.round(v)));
      }),
    { min: "1", max: "40", step: "1", "aria-label": "Seed count" },
  );

  // ── linked body ─────────────────────────────────────────────────────────
  const setBody = (fn) =>
    write((d) => {
      if (d.body && typeof d.body === "object") fn(d.body);
    });
  const linkInput = el("input", {
    type: "text",
    class: "link-url",
    placeholder: "automerge:… or a Patchwork link",
    "aria-label": "Linked document URL",
    onkeydown: (e) => {
      if (e.key === "Enter") linkTo(linkInput.value);
      if (e.key === "Escape") ((view.linking = false), syncBody(handle.doc()));
    },
  });
  const linkOpen = el("button", { type: "button", text: "Link hull…", onclick: () => ((view.linking = true), (view.notice = null), syncBody(handle.doc()), linkInput.focus()) });
  const linkGo = el("button", { type: "button", text: "Link", onclick: () => linkTo(linkInput.value) });
  const linkCancel = el("button", { type: "button", text: "Cancel", onclick: () => ((view.linking = false), syncBody(handle.doc())) });
  const linkBox = el("div", { class: "cluster link-box" }, linkInput, linkGo, linkCancel);
  const unlinkedBox = el(
    "div",
    { class: "flow" },
    el("div", { class: "cluster" }, linkOpen),
    linkBox,
    el("p", {
      class: "hint",
      text: "Link a hull and the flow goes round its waterline, derived live from it. Best is the hull's 3D render from a scene (drag its row from the scene's outline onto the view): the flow then uses exactly the geometry the scene shows. A hull document itself works too, built with its provider's defaults.",
    }),
  );
  const chipTitle = el("span", { class: "chip-title" });
  const chipPath = el("span", { class: "chip-path" });
  const chip = el("div", { class: "chip", title: "" }, el("span", { class: "chip-lock", text: "Linked", "aria-hidden": "true" }), chipTitle, chipPath);
  const planeSelect = el(
    "select",
    {
      "aria-label": "Section plane",
      onchange: (e) =>
        setBody((b) => {
          b.plane = e.target.value === "z" ? { kind: "z", z: roundMm(view.z) } : { kind: "waterline" };
        }),
    },
    el("option", { value: "waterline", text: "Waterline (z = 0)" }),
    el("option", { value: "z", text: "Height…" }),
  );
  const planeZInput = numberInput((v) => setBody((b) => (b.plane = { kind: "z", z: v })), { "aria-label": "Section height" });
  const modelSelect = el(
    "select",
    { "aria-label": "Body model", onchange: (e) => setBody((b) => (b.model = e.target.value)) },
    ...BODY_MODELS.map((m) => el("option", { value: m, text: BODY_MODEL_LABELS[m] })),
  );
  const panelsInput = numberInput((v) => setBody((b) => (b.panels = Math.max(MIN_PANELS, Math.min(MAX_PANELS, Math.round(v))))), {
    min: String(MIN_PANELS),
    max: String(MAX_PANELS),
    step: "1",
    "aria-label": "Body panels",
  });
  const panelsLabel = el("label", { text: "Panels" });
  const fitButton = el("button", { type: "button", text: "Fit domain", title: "Fit the domain around the linked body", onclick: () => fitDomain() });
  const unlinkButton = el("button", { type: "button", "data-variant": "danger", text: "Unlink", onclick: () => unlink() });
  const confirmBox = el(
    "div",
    { class: "confirm flow" },
    el("p", {
      class: "hint",
      text: "Unlinking drops the waterplane body: its panels are derived from the hull and don't become elements. Switch to Slender body first to keep it as elements.",
    }),
    el(
      "div",
      { class: "cluster" },
      el("button", { type: "button", "data-variant": "danger", text: "Drop body and unlink", onclick: () => unlink(true) }),
      el("button", { type: "button", text: "Cancel", onclick: () => ((view.confirmUnlink = false), syncBody(handle.doc())) }),
    ),
  );
  const bodyStatus = el("p", { class: "hint body-status" });
  const linkedBox = el(
    "div",
    { class: "flow" },
    chip,
    el(
      "div",
      { class: "fields" },
      el("label", { text: "Plane" }),
      el("span", { class: "cluster" }, planeSelect, planeZInput),
      el("label", { text: "Model" }),
      el("span", {}, modelSelect),
      panelsLabel,
      el("span", {}, panelsInput),
    ),
    bodyStatus,
    el("div", { class: "cluster" }, fitButton, unlinkButton),
    confirmBox,
  );
  const noticeBox = el("p", { class: "notice", role: "status" });
  const bodyChip = el("div", { class: "body-chip", hidden: true });
  stage.append(bodyChip);

  const row = (label, control, unit) => [
    el("label", { text: label }),
    el("span", {}, control, unit ? el("span", { class: "unit", text: unit }) : null),
  ];
  const panel = el(
    "aside",
    { class: "panel flow" },
    el(
      "section",
      {},
      el("h3", { text: "Freestream" }),
      el("div", { class: "fields" }, ...row("Speed", speedInput, "m/s"), ...row("Heading", headingInput, "°")),
      el("p", { class: "hint", text: "Heading is the direction the stream flows toward, counter-clockwise from east (+x). Drag the dial to turn it." }),
    ),
    el("section", {}, el("h3", { text: "Body" }), unlinkedBox, linkedBox, noticeBox),
    el("section", {}, el("h3", { text: "Selected" }), selectedBox),
    el("section", {}, el("h3", { text: "Elements" }), elementList),
    el(
      "section",
      {},
      el("h3", { text: "Domain & seeds" }),
      el(
        "div",
        { class: "fields" },
        ...row("Min (m)", el("span", { class: "triple" }, ...domainInputs[0])),
        ...row("Max (m)", el("span", { class: "triple" }, ...domainInputs[1])),
        ...row("Seeds", seedInput),
      ),
      el("p", { class: "hint", text: "x east, y north, z up, metres. Streamlines start on the upstream face of the domain." }),
    ),
  );

  root.append(toolbar, el("div", { class: "body" }, stage, panel));

  // ── selected-element editor ─────────────────────────────────────────────
  let selectedKey = null; // id|kind the box was built for
  let selInputs = null;
  function syncSelected(doc) {
    const e = view.selected ? doc?.elements?.[view.selected] : null;
    const key = e ? `${view.selected}|${e.kind}` : null;
    if (key !== selectedKey) {
      selectedKey = key;
      selectedBox.replaceChildren();
      selInputs = null;
      if (!e) {
        selectedBox.append(
          el("p", { class: "hint", text: "Click an element to select it, drag to move it. Add one from the toolbar, then click where it goes." }),
        );
      } else {
        const id = view.selected;
        const kind = el(
          "select",
          {
            "aria-label": "Kind",
            onchange: (ev) =>
              write((d) => {
                if (d.elements?.[id]) d.elements[id].kind = ev.target.value;
              }),
          },
          ...KINDS.map((k) => el("option", { value: k, text: KIND_LABELS[k] })),
        );
        kind.value = e.kind;
        const strength = numberInput(
          (v) =>
            write((d) => {
              if (d.elements?.[id]) d.elements[id].strength = v;
            }),
          { "aria-label": "Strength" },
        );
        const pos = [0, 1, 2].map((k) =>
          numberInput(
            (v) =>
              write((d) => {
                const t = d.elements?.[id];
                if (!t) return;
                if (!Array.isArray(t.position) || t.position.length !== 3) t.position = [0, 0, 0];
                t.position[k] = v;
              }),
            { "aria-label": `Position ${"xyz"[k]}` },
          ),
        );
        const del = el("button", { type: "button", "data-variant": "danger", text: "Delete", onclick: () => removeSelected() });
        selectedBox.append(
          el(
            "div",
            { class: "fields" },
            ...row("Kind", kind),
            ...row("Strength", strength, STRENGTH_UNITS[e.kind]),
            ...row("At (m)", el("span", { class: "triple" }, ...pos)),
          ),
          el("div", { class: "cluster" }, del, el("span", { class: "hint", text: e.kind === "vortex-line" ? "Vertical line; Γ > 0 turns counter-clockwise." : "" })),
        );
        selInputs = { kind, strength, pos };
      }
    }
    if (selInputs && e) {
      setValue(selInputs.kind, e.kind);
      setValue(selInputs.strength, numberOr(e.strength, 0));
      const p = Array.isArray(e.position) ? e.position : [0, 0, 0];
      selInputs.pos.forEach((input, k) => setValue(input, numberOr(p[k], 0)));
    }
  }

  function syncList(doc) {
    const ids = Object.keys(doc?.elements ?? {}).sort();
    elementList.replaceChildren(
      ...ids.map((id) => {
        const e = doc.elements[id];
        return el(
          "li",
          {
            "data-selected": id === view.selected,
            onclick: () => {
              view.selected = id;
              render();
            },
          },
          el("span", { class: "glyph", text: GLYPH[e?.kind] ?? "?" }),
          el("span", { text: `${KIND_LABELS[e?.kind] ?? e?.kind ?? "?"}` }),
          el("span", { class: "value", text: fmt(numberOr(e?.strength, NaN), 1) }),
        );
      }),
    );
    if (!ids.length) elementList.append(el("li", { class: "hint", text: "Just the stream. Add something to put in its way." }));
  }

  function syncToolbar() {
    for (const b of addButtons) b.toggleAttribute("data-armed", b.dataset.kind === view.armed);
    stage.dataset.cursor = view.armed ? "crosshair" : drag ? "grabbing" : view.hover || hoverDial ? "grab" : "";
  }

  function syncPanel(doc) {
    setValue(speedInput, numberOr(doc?.freestream?.speed, 0));
    setValue(headingInput, numberOr(doc?.freestream?.headingDeg, 0));
    const f = compileField(doc);
    domainInputs.forEach((inputs, w) => inputs.forEach((input, k) => setValue(input, f.domain[w ? "max" : "min"][k])));
    setValue(seedInput, numberOr(doc?.seeds?.count, 15));
    zRange.min = String(f.domain.min[2]);
    zRange.max = String(f.domain.max[2]);
    view.z = Math.min(f.domain.max[2], Math.max(f.domain.min[2], view.z));
    setValue(zRange, view.z);
    zLabel.textContent = `z = ${fmt(view.z)} m`;
    syncSelected(doc);
    syncList(doc);
    syncLink(doc);
    syncBody(doc);
  }

  // ── the linked body's section ───────────────────────────────────────────
  // Fetched (and re-cut on every settled edit of the linked doc) here, never
  // stored: the doc holds only the link.
  const linked = {
    url: null,
    planeKey: null,
    handle: null,
    off: null,
    timer: 0,
    retry: 0,
    failures: 0,
    seq: 0,
    status: "none", // "loading" | "ready" | "error"
    result: null,
    section: null,
    error: null,
    title: null,
    renderKey: null, // for a linked scene render: the key of the GLB the section was cut from
    version: 0,
  };
  const findRepo = () => globalThis.repo ?? handle.repo ?? null;

  function disconnect() {
    linked.off?.();
    clearTimeout(linked.timer);
    clearTimeout(linked.retry);
    Object.assign(linked, {
      url: null,
      planeKey: null,
      handle: null,
      off: null,
      timer: 0,
      retry: 0,
      failures: 0,
      seq: linked.seq + 1,
      status: "none",
      result: null,
      section: null,
      error: null,
      title: null,
      renderKey: null,
      version: linked.version + 1,
    });
  }

  function syncLink(doc) {
    const spec = normalizeBodySpec(doc?.body);
    if (!spec) {
      if (linked.url) disconnect();
      return;
    }
    const planeKey = stableStringify(spec.plane);
    if (spec.url !== linked.url) {
      disconnect();
      linked.url = spec.url;
      linked.planeKey = planeKey;
      fetchSection();
    } else if (planeKey !== linked.planeKey) {
      linked.planeKey = planeKey;
      fetchSection();
    }
  }

  async function fetchSection() {
    const spec = normalizeBodySpec(handle.doc()?.body);
    if (!spec || spec.url !== linked.url) return;
    const seq = ++linked.seq;
    clearTimeout(linked.retry);
    linked.retry = 0;
    if (linked.status !== "ready") linked.status = "loading";
    syncBody(handle.doc());
    let r;
    try {
      r = await acquireSection({ url: spec.url, plane: spec.plane, repo: findRepo(), handle: linked.handle, selfUrl: handle.url });
    } catch (err) {
      r = { ok: false, error: String(err?.message ?? err) };
    }
    if (dead || seq !== linked.seq) return; // superseded, or unmounted
    if (r.handle && !linked.handle) {
      linked.handle = r.handle;
      const onHull = () => {
        // a scene render changes all the time (status, "building"); only a
        // new GLB changes the body
        const d = r.handle.doc?.();
        if (isRenderDoc(d) && linked.renderKey != null && renderKey(d) === linked.renderKey) return;
        clearTimeout(linked.timer);
        linked.timer = setTimeout(fetchSection, HULL_DEBOUNCE_MS);
      };
      r.handle.on?.("change", onHull);
      linked.off = () => r.handle.off?.("change", onHull);
    }
    if (r.ok || r.transient === false) linked.failures = 0;
    else {
      // not available here yet (the hull hasn't synced, its provider hasn't
      // registered): try again, backing off, the way the scene host does
      const wait = Math.min(SECTION_RETRY_MAX_MS, SECTION_RETRY_MS * 2 ** linked.failures++);
      linked.retry = setTimeout(() => {
        linked.retry = 0;
        if (!dead) fetchSection();
      }, wait);
    }
    linked.result = r;
    // "pending": a scene render that hasn't been built yet; it is followed, not retried
    linked.status = r.ok ? "ready" : r.pending ? "pending" : "error";
    linked.section = r.ok ? r.section : null;
    linked.error = r.ok ? null : r.error;
    linked.renderKey = r.renderKey ?? null;
    linked.version++;
    if (r.doc && (!linked.title || r.renderKey != null)) {
      const title = await titleOf(r.doc, r.datatype);
      if (dead || seq !== linked.seq) return;
      linked.title = title;
    }
    syncBody(handle.doc());
    draw();
  }

  /** The section that applies to this doc right now, or null. */
  function currentSection(doc) {
    const spec = normalizeBodySpec(doc?.body);
    return spec && spec.url === linked.url && linked.status === "ready" ? linked.section : null;
  }

  function syncBody(doc) {
    const spec = normalizeBodySpec(doc?.body);
    unlinkedBox.hidden = !!spec;
    linkedBox.hidden = !spec;
    linkBox.hidden = !view.linking;
    linkOpen.hidden = view.linking;
    if (!spec) view.confirmUnlink = false;
    confirmBox.hidden = !view.confirmUnlink;
    unlinkButton.hidden = view.confirmUnlink;
    if (view.notice?.elementsNote) {
      // "the doc's N elements are still there": keep N current, and drop it once they're gone
      const own = Object.keys(doc?.elements ?? {}).length;
      const note = own
        ? `The doc's ${own} element${own === 1 ? " is" : "s are"} still there, superposed on the body. Delete ${own === 1 ? "it" : "them"} if the hull should stand alone.`
        : "";
      const text = [note, view.notice.text].filter(Boolean).join(" ");
      if (!text) view.notice = null;
      else noticeBox.textContent = text;
    }
    noticeBox.hidden = !view.notice;
    if (!view.notice?.elementsNote) noticeBox.textContent = view.notice?.text ?? "";
    noticeBox.dataset.tone = view.notice?.tone ?? "";
    if (!spec) {
      bodyChip.hidden = true;
      return;
    }
    const path =
      linked.status === "ready"
        ? linked.result?.path === "render"
          ? "scene render"
          : linked.result?.path === "exact"
            ? "exact section"
            : "mesh fallback"
        : linked.status === "pending"
          ? "not built yet"
          : linked.status === "error"
            ? "no section"
            : "finding section…";
    chipTitle.textContent = linked.title ?? "linked document";
    chipPath.textContent = path;
    chip.dataset.status = linked.status;
    chip.title = `${spec.url}${linked.status === "ready" ? `\n${sectionPathLabel(linked.result)}` : ""}`;
    const loops = linked.section?.loops?.length ?? 0;
    bodyStatus.textContent =
      linked.status === "pending"
        ? `${capitalize(linked.error)}. The flow is just the stream and the elements until the scene builds it.`
        : linked.status === "error"
          ? `No body: ${linked.error}. The flow is just the stream and the elements.`
          : linked.status === "ready"
            ? loops
              ? `${capitalize(sectionPathLabel(linked.result))}: ${loops} loop${loops === 1 ? "" : "s"} at z = ${fmt(linked.section.plane?.z ?? 0)} m. Edits to it show up here.`
              : `The ${sectionPathLabel(linked.result)} has nothing at this plane.`
            : "Cutting the section…";
    bodyStatus.dataset.tone = linked.status === "error" ? "error" : "";
    setValue(planeSelect, spec.plane.kind);
    planeZInput.hidden = spec.plane.kind !== "z";
    if (spec.plane.kind === "z") setValue(planeZInput, spec.plane.z);
    setValue(modelSelect, spec.model);
    setValue(panelsInput, spec.panels);
    panelsLabel.textContent = spec.model === "slender-body-3d" ? "Segments" : "Panels";
    fitButton.disabled = !loops;
    bodyChip.hidden = false;
    bodyChip.textContent = `${linked.title ?? "Linked body"} · ${path}`;
    bodyChip.dataset.status = linked.status;
  }

  function linkTo(input) {
    const url = parseAutomergeUrl(input);
    if (!url) {
      view.notice = { text: "That doesn't look like a Patchwork document link.", tone: "error" };
      return syncBody(handle.doc());
    }
    if (url === handle.url) {
      view.notice = { text: "A flow can't be its own body.", tone: "error" };
      return syncBody(handle.doc());
    }
    let turned = false;
    write((d) => {
      const prev = normalizeBodySpec(d.body);
      const plane = prev?.plane.kind === "z" ? { kind: "z", z: prev.plane.z } : { kind: "waterline" };
      d.body = { url, plane, model: prev?.model ?? "waterplane-2d", panels: prev?.panels ?? DEFAULT_PANELS };
      // The bow is +x, so a boat going ahead sees the stream heading 180°. A
      // fresh link on the default heading (0°, toward the bow) would model it
      // going astern: turn it round, once.
      if (!prev && d.freestream && !numberOr(d.freestream.headingDeg, 0)) {
        d.freestream.headingDeg = 180;
        turned = true;
      }
    });
    view.linking = false;
    linkInput.value = "";
    const doc = handle.doc();
    const own = Object.keys(doc?.elements ?? {}).length;
    const heading = numberOr(doc?.freestream?.headingDeg, 0);
    const astern = Math.cos((heading * Math.PI) / 180) > 1e-9; // the stream runs toward the bow
    const parts = [];
    if (turned) parts.push("The stream now heads 180° (toward −x), so the body moves toward +x: forward in the floating frame, where a hull's bow points.");
    else if (astern) parts.push("Forward is +x in the floating frame (where a hull's bow points), so a body moving ahead sees the stream heading 180°; at this heading it moves backward.");
    // the element count goes stale as soon as they're deleted: syncBody words it from the doc each time
    view.notice = own || parts.length ? { text: parts.join(" "), tone: "", elementsNote: own > 0 } : null;
    render();
  }

  function unlink(confirmed = false) {
    const doc = handle.doc();
    const spec = normalizeBodySpec(doc?.body);
    if (!spec) return;
    if (spec.model === "waterplane-2d" && !confirmed) {
      view.confirmUnlink = true;
      return syncBody(doc);
    }
    let added = {};
    if (spec.model === "slender-body-3d") {
      const field = compileFlow(doc, currentSection(doc));
      added = field.body ? snapshotElements(field.body, { taken: doc?.elements ?? {} }) : {};
    }
    const n = Object.keys(added).length;
    write((d) => {
      if (n) {
        d.elements ??= {};
        for (const [id, e] of Object.entries(added)) d.elements[id] = e;
      }
      d.body = null;
    });
    view.confirmUnlink = false;
    view.notice =
      spec.model === "slender-body-3d"
        ? n
          ? { text: `Unlinked. The slender body is now ${n} sources and sinks you can edit.`, tone: "" }
          : { text: "Unlinked. The section wasn't available, so there was no body to keep.", tone: "error" }
        : { text: "Unlinked, and the waterplane body is dropped.", tone: "" };
    render();
  }

  function fitDomain() {
    const loops = linked.section?.loops ?? [];
    if (!loops.length) return;
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const l of loops)
      for (const [x, y] of l.points) {
        minx = Math.min(minx, x);
        maxx = Math.max(maxx, x);
        miny = Math.min(miny, y);
        maxy = Math.max(maxy, y);
      }
    const L = Math.max(maxx - minx, 1e-3);
    const B = Math.max(maxy - miny, 1e-3);
    const mx = 0.5 * L;
    const my = Math.max(1.5 * B, 0.25 * L);
    const cur = compileField(handle.doc()).domain;
    write((d) => {
      d.domain = {
        min: [roundMm(minx - mx), roundMm(miny - my), roundMm(cur.min[2])],
        max: [roundMm(maxx + mx), roundMm(maxy + my), roundMm(cur.max[2])],
      };
    });
  }

  // ── drawing ─────────────────────────────────────────────────────────────
  const colorProbe = document.createElement("canvas").getContext?.("2d", { willReadFrequently: true }) ?? null;
  const colorCache = new Map();
  function resolveColor(css) {
    if (colorCache.has(css)) return colorCache.get(css);
    let rgb = [128, 128, 128];
    if (colorProbe) {
      colorProbe.clearRect(0, 0, 1, 1);
      colorProbe.fillStyle = "#808080";
      colorProbe.fillStyle = css;
      colorProbe.fillRect(0, 0, 1, 1);
      const d = colorProbe.getImageData?.(0, 0, 1, 1)?.data;
      if (d) rgb = [d[0], d[1], d[2]];
    }
    colorCache.set(css, rgb);
    return rgb;
  }
  function themeColors() {
    const cs = getComputedStyle(root);
    const get = (n, d) => cs.getPropertyValue(n).trim() || d;
    return {
      line: get("--flow-field-canvas-line", "black"),
      fill: get("--flow-field-canvas-fill", "white"),
      accent: get("--flow-field-canvas-accent", "#35f7ca"),
      source: get("--flow-field-canvas-source", "#d94f3d"),
      sink: get("--flow-field-canvas-sink", "#3d6fd9"),
      other: get("--flow-field-canvas-other", "#8a5cd9"),
    };
  }

  let heatCache = { key: null };
  let lineCache = { key: null, lines: [] };
  const heatCanvas = document.createElement("canvas");

  function currentView(field) {
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 400;
    return fitView(field.domain, w, h);
  }

  let raf = 0;
  function draw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  }

  function paint() {
    const doc = handle.doc();
    const ctx = canvas.getContext?.("2d");
    if (!ctx || !doc) return;
    const section = currentSection(doc);
    let field;
    try {
      field = compileFlow(doc, section);
    } catch (err) {
      console.warn("[flow-field] body failed; drawing the flow without it", err);
      field = compileField(doc);
    }
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 400;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const v = fitView(field.domain, w, h);
    const colors = themeColors();
    // the linked doc's contents aren't in the fingerprint; the section version stands in for them
    const fp = `${flowFingerprint(doc)}|s${section ? linked.version : 0}`;
    const { min, max } = field.domain;
    const [x0, y0] = toScreen(v, min[0], max[1]);
    const [x1, y1] = toScreen(v, max[0], min[1]);

    // heatmap
    const cmap = autoColormap(view.colorBy);
    let range = null;
    // A linked body's cut at this height is a polygon (the waterline for a
    // waterplane body, the body of revolution's cut for a slender one): the
    // heatmap runs up to it and the polygon is filled on top, exactly, instead
    // of masking whole cells, which draws a staircase.
    const exactBody = !!(field.body && !field.body.empty && typeof field.body.outlineAt === "function");
    if (view.showHeat) {
      const cols = Math.max(8, Math.min(240, Math.round((x1 - x0) / 4)));
      const rows = Math.max(4, Math.min(160, Math.round((y1 - y0) / 4)));
      const refine = !drag; // sharpen the body's edge once the pointer lets go
      const key = `${fp}|${view.z}|${cols}x${rows}|${view.mask}|${refine}|${exactBody}`;
      if (heatCache.key !== key) {
        // the mask traces upstream from every sample, so it runs on a coarser grid
        const maskEvery = Math.max(1, Math.ceil(Math.sqrt((cols * rows) / 2500)));
        const s = sampleHeatmap(field, view.z, cols, rows, { mask: view.mask, maskEvery, refine, exactBody: exactBody && view.mask });
        heatCache = { key, s, ranges: {} };
      }
      const s = heatCache.s;
      const values = view.colorBy === "cp" ? s.cp : s.speed;
      if (!heatCache.ranges[view.colorBy]) {
        const shown = [];
        for (let i = 0; i < values.length; i++) if (!s.inside[i] && !s.bodyCells?.[i]) shown.push(values[i]);
        const r = robustRange(shown.length ? shown : values);
        heatCache.ranges[view.colorBy] = view.colorBy === "cp" && isDiverging(cmap) ? symmetricRange(r) : r;
      }
      range = heatCache.ranges[view.colorBy];
      const imgKey = `${heatCache.key}|${view.colorBy}|${colors.fill}`;
      if (heatCache.imgKey !== imgKey) {
        heatCache.imgKey = imgKey;
        heatCanvas.width = s.cols;
        heatCanvas.height = s.rows;
        const hctx = heatCanvas.getContext?.("2d");
        const img = hctx?.createImageData?.(s.cols, s.rows);
        if (img) {
          const fill = resolveColor(colors.fill);
          const span = range[1] - range[0] || 1;
          for (let j = 0; j < s.rows; j++) {
            const r = s.rows - 1 - j; // j = 0 is the south edge
            for (let i = 0; i < s.cols; i++) {
              const k = j * s.cols + i;
              const o = (r * s.cols + i) * 4;
              const c = s.inside[k] ? fill.map((x) => x / 255) : sampleColormap(cmap, (values[k] - range[0]) / span);
              img.data[o] = c[0] * 255;
              img.data[o + 1] = c[1] * 255;
              img.data[o + 2] = c[2] * 255;
              img.data[o + 3] = 255;
            }
          }
          hctx.putImageData(img, 0, 0);
        }
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(heatCanvas, x0, y0, x1 - x0, y1 - y0);
    } else {
      ctx.fillStyle = colors.fill;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    // domain outline
    ctx.strokeStyle = colors.line;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    ctx.globalAlpha = 1;

    // the linked body: locked, drawn as its section outline (dashed where the
    // slender body's cut at this height is narrower than the section)
    if (field.body && !field.body.empty) {
      const off = field.body.model === "slender-body-3d" && Math.abs(view.z - field.body.z0) > 1e-6;
      ctx.save();
      ctx.beginPath();
      for (const loop of field.body.loops) {
        loop.forEach((p, i) => {
          const [sx, sy] = toScreen(v, p[0], p[1]);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.closePath();
      }
      if (!view.showHeat || !view.mask) {
        ctx.fillStyle = colors.fill;
        ctx.globalAlpha = 0.85;
        ctx.fill("evenodd");
        ctx.globalAlpha = 1;
      } else if (exactBody) {
        // the heatmap was sampled up to the outline (sampleHeatmap exactBody): cover the inside exactly
        // (inside the domain: a slender body's dead-water closure can run past it)
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
        ctx.clip();
        ctx.beginPath();
        for (const loop of field.body.outlineAt(view.z)) {
          loop.forEach((p, i) => {
            const [sx, sy] = toScreen(v, p[0], p[1]);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
          ctx.closePath();
        }
        ctx.fillStyle = colors.fill;
        ctx.fill("evenodd");
        ctx.restore();
        // and the section's outline again, to stroke
        ctx.beginPath();
        for (const loop of field.body.loops) {
          loop.forEach((p, i) => {
            const [sx, sy] = toScreen(v, p[0], p[1]);
            if (i === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          });
          ctx.closePath();
        }
      }
      ctx.setLineDash?.(off ? [5, 4] : []);
      ctx.strokeStyle = colors.line;
      ctx.lineWidth = 1.75;
      ctx.stroke();
      ctx.restore();
    }

    // streamlines (in the plane z = view.z)
    if (view.showLines) {
      const count = Math.max(1, Math.round(numberOr(doc.seeds?.count, 15)));
      const key = `${fp}|${view.z}`;
      if (lineCache.key !== key) {
        const step = Math.max(max[0] - min[0], max[1] - min[1]) / 400;
        const seeds = rakeSeeds(field, { count, height: view.z, rows: 1 });
        // widened across the stream (and clipped when drawn), so a line pushed
        // out sideways runs off the edge instead of stopping at it
        const opts = { step, maxSteps: 2000, planar: true, domain: widenAcross(field) };
        const lines = seeds.map((sd) => traceStreamline(field, sd, opts));
        // plus three a side that pass right by a linked body
        for (const h of bodyHugSeeds(field, { count: 3, height: view.z })) lines.push(traceThrough(field, h.seed, { ...opts, maxSteps: 4000 }));
        lineCache = { key, lines };
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.strokeStyle = colors.line;
      ctx.fillStyle = colors.line;
      ctx.lineWidth = 1.25;
      ctx.globalAlpha = 0.8;
      // only where the heatmap's mask is showing, and it is for this height
      const masked = view.showHeat && view.mask && heatCache.s && heatCache.key?.startsWith(`${fp}|${view.z}|`) ? heatCache.s : null;
      for (const P of lineCache.lines.flatMap((tr) => unmaskedRuns(tr.points, masked, field.domain))) {
        ctx.beginPath();
        P.forEach((p, i) => {
          const [sx, sy] = toScreen(v, p[0], p[1]);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.stroke();
        // arrowheads every ~120 px
        let run = 0;
        for (let i = 1; i < P.length; i++) {
          const [ax, ay] = toScreen(v, P[i - 1][0], P[i - 1][1]);
          const [bx, by] = toScreen(v, P[i][0], P[i][1]);
          run += Math.hypot(bx - ax, by - ay);
          if (run < 120) continue;
          run = 0;
          const ang = Math.atan2(by - ay, bx - ax);
          ctx.beginPath();
          ctx.moveTo(bx + 4 * Math.cos(ang), by + 4 * Math.sin(ang));
          ctx.lineTo(bx + 4 * Math.cos(ang + 2.5), by + 4 * Math.sin(ang + 2.5));
          ctx.lineTo(bx + 4 * Math.cos(ang - 2.5), by + 4 * Math.sin(ang - 2.5));
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // elements
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const e of field.elements) {
      const [sx, sy] = toScreen(v, e.x, e.y);
      const fill = e.kind === "source" ? colors.source : e.kind === "sink" ? colors.sink : colors.other;
      if (e.id === view.selected) {
        ctx.beginPath();
        ctx.arc(sx, sy, 14, 0, 2 * Math.PI);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, 2 * Math.PI);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = colors.fill;
      ctx.lineWidth = e.id === view.hover ? 2.5 : 1.5;
      ctx.stroke();
      ctx.fillStyle = colors.fill;
      const glyph = e.kind === "vortex-line" ? (e.s >= 0 ? "↺" : "↻") : GLYPH[e.kind];
      ctx.fillText(glyph, sx, sy + 0.5);
      if (Math.abs(e.z - view.z) > 1e-6) {
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillStyle = colors.line;
        ctx.fillText(`z ${fmt(e.z, 1)}`, sx, sy + 18);
        ctx.font = "bold 13px system-ui, sans-serif";
      }
    }

    // freestream dial
    const dial = dialGeometry(v);
    ctx.beginPath();
    ctx.arc(dial.cx, dial.cy, dial.r, 0, 2 * Math.PI);
    ctx.fillStyle = colors.fill;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = hoverDial || drag?.type === "dial" ? 2 : 1;
    ctx.stroke();
    ctx.font = "9px system-ui, sans-serif";
    ctx.fillStyle = colors.line;
    for (const [t, a] of [["E", 0], ["N", 90], ["W", 180], ["S", 270]]) {
      const r = (a * Math.PI) / 180;
      ctx.fillText(t, dial.cx + (dial.r - 7) * Math.cos(r), dial.cy - (dial.r - 7) * Math.sin(r));
    }
    const hd = (numberOr(doc.freestream?.headingDeg, 0) * Math.PI) / 180;
    const ax = Math.cos(hd);
    const ay = -Math.sin(hd);
    const L = dial.r - 13;
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(dial.cx - ax * L, dial.cy - ay * L);
    ctx.lineTo(dial.cx + ax * L, dial.cy + ay * L);
    ctx.stroke();
    ctx.beginPath();
    const tipx = dial.cx + ax * (L + 3);
    const tipy = dial.cy + ay * (L + 3);
    const ang = Math.atan2(ay, ax);
    ctx.moveTo(tipx, tipy);
    ctx.lineTo(tipx + 8 * Math.cos(ang + 2.6), tipy + 8 * Math.sin(ang + 2.6));
    ctx.lineTo(tipx + 8 * Math.cos(ang - 2.6), tipy + 8 * Math.sin(ang - 2.6));
    ctx.closePath();
    ctx.fillStyle = colors.line;
    ctx.fill();
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      `${fmt(field.U, 1)} m/s  ${Math.round(numberOr(doc.freestream?.headingDeg, 0))}°`,
      dial.cx + dial.r + 8,
      dial.cy,
    );

    // scale bar, top right
    const target = 90 / v.scale;
    const nice = [0.5, 1, 2, 5, 10, 20, 50, 100].find((n) => n >= target * 0.6) ?? 100;
    const barPx = nice * v.scale;
    ctx.textAlign = "center";
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w - 16 - barPx, 22);
    ctx.lineTo(w - 16, 22);
    ctx.moveTo(w - 16 - barPx, 17);
    ctx.lineTo(w - 16 - barPx, 27);
    ctx.moveTo(w - 16, 17);
    ctx.lineTo(w - 16, 27);
    ctx.stroke();
    ctx.fillText(`${nice} m`, w - 16 - barPx / 2, 36);

    // legend
    legend.style.display = view.showHeat && range ? "" : "none";
    if (range) {
      legendTitle.textContent = view.colorBy === "cp" ? "Pressure coefficient Cp" : "Speed (m/s)";
      legendMin.textContent = fmt(range[0]);
      legendMax.textContent = fmt(range[1]);
      const lctx = legendBar.getContext?.("2d");
      if (lctx) {
        for (let i = 0; i < legendBar.width; i++) {
          lctx.fillStyle = cssColor(sampleColormap(cmap, i / (legendBar.width - 1)));
          lctx.fillRect(i, 0, 1, legendBar.height);
        }
      }
    }

    // probe readout
    if (view.probe) {
      const [px, py] = view.probe;
      readout.textContent = probeText(field, px, py, view.z, fmt);
    } else readout.textContent = "";
  }

  function render() {
    const doc = handle.doc();
    if (view.selected && !doc?.elements?.[view.selected]) view.selected = null;
    syncPanel(doc);
    syncToolbar();
    draw();
  }

  // ── interaction ─────────────────────────────────────────────────────────
  let pending = null;
  let writeRaf = 0;
  function flushPending() {
    writeRaf = 0;
    const p = pending;
    pending = null;
    if (!p) return;
    handle.change((d) => {
      if (p.type === "element") {
        const t = d.elements?.[p.id];
        if (!t) return;
        if (!Array.isArray(t.position) || t.position.length !== 3) t.position = [p.x, p.y, 0];
        else {
          t.position[0] = p.x;
          t.position[1] = p.y;
        }
      } else if (p.type === "dial") {
        d.freestream ??= { speed: 0, headingDeg: 0 };
        d.freestream.headingDeg = p.heading;
      }
    });
  }
  function queue(p) {
    pending = p;
    if (!writeRaf) writeRaf = requestAnimationFrame(flushPending);
  }

  const local = (ev) => {
    const r = canvas.getBoundingClientRect();
    return [ev.clientX - r.left, ev.clientY - r.top];
  };

  function onPointerDown(ev) {
    if (ev.button !== 0) return;
    const doc = handle.doc();
    const field = compileField(doc);
    const v = currentView(field);
    const [sx, sy] = local(ev);
    canvas.focus();
    if (view.armed) {
      const kind = view.armed;
      const [x, y] = toWorld(v, sx, sy);
      const id = newElementId(kind, doc?.elements);
      handle.change((d) => {
        d.elements ??= {};
        d.elements[id] = { kind, position: [roundMm(x), roundMm(y), roundMm(view.z)], strength: defaultStrength(kind, field.U) };
      });
      view.armed = null;
      view.selected = id;
      render();
      return;
    }
    const dial = dialGeometry(v);
    if (hitDial(dial, sx, sy)) {
      drag = { type: "dial" };
      canvas.setPointerCapture?.(ev.pointerId);
      queue({ type: "dial", heading: headingFromDial(dial, sx, sy, ev.shiftKey ? 15 : 1) });
      syncToolbar();
      return;
    }
    const hit = hitElement(v, field.elements, sx, sy);
    if (hit) {
      const [wx, wy] = toWorld(v, sx, sy);
      drag = { type: "element", id: hit.id, dx: hit.x - wx, dy: hit.y - wy };
      view.selected = hit.id;
      canvas.setPointerCapture?.(ev.pointerId);
      render();
      return;
    }
    view.selected = null;
    render();
  }

  function onPointerMove(ev) {
    const doc = handle.doc();
    const field = compileField(doc);
    const v = currentView(field);
    const [sx, sy] = local(ev);
    const [wx, wy] = toWorld(v, sx, sy);
    view.probe = [wx, wy];
    if (drag?.type === "element") {
      queue({ type: "element", id: drag.id, x: roundMm(wx + drag.dx), y: roundMm(wy + drag.dy) });
    } else if (drag?.type === "dial") {
      queue({ type: "dial", heading: headingFromDial(dialGeometry(v), sx, sy, ev.shiftKey ? 15 : 1) });
    } else {
      const hit = hitElement(v, field.elements, sx, sy);
      view.hover = hit?.id ?? null;
      hoverDial = hitDial(dialGeometry(v), sx, sy);
      syncToolbar();
    }
    draw();
  }

  function onPointerUp(ev) {
    if (!drag) return;
    canvas.releasePointerCapture?.(ev.pointerId);
    drag = null;
    if (pending) flushPending();
    syncToolbar();
    draw();
  }

  function onPointerLeave() {
    view.probe = null;
    view.hover = null;
    hoverDial = false;
    draw();
  }

  function removeSelected() {
    const id = view.selected;
    if (!id) return;
    handle.change((d) => {
      if (d.elements && id in d.elements) delete d.elements[id];
    });
    view.selected = null;
    render();
  }

  function onKeyDown(ev) {
    if (ev.key === "Escape") {
      view.armed = null;
      view.selected = null;
      render();
      return;
    }
    if (!view.selected) return;
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      removeSelected();
      return;
    }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[ev.key];
    if (nudge) {
      ev.preventDefault();
      const s = ev.shiftKey ? 1 : 0.1;
      const id = view.selected;
      handle.change((d) => {
        const t = d.elements?.[id];
        if (!t || !Array.isArray(t.position)) return;
        t.position[0] = roundMm(numberOr(t.position[0], 0) + nudge[0] * s);
        t.position[1] = roundMm(numberOr(t.position[1], 0) + nudge[1] * s);
      });
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("keydown", onKeyDown);

  // drop a Patchwork document onto the view to link it as the body
  function onDragOver(ev) {
    if (!hasPatchworkDrop(ev.dataTransfer)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "link";
    stage.dataset.drop = "";
  }
  function onDragLeave() {
    delete stage.dataset.drop;
  }
  function onDrop(ev) {
    delete stage.dataset.drop;
    const [item] = parsePatchworkDrop(ev.dataTransfer);
    if (!item) return;
    ev.preventDefault();
    linkTo(item.url);
  }
  stage.addEventListener("dragover", onDragOver);
  stage.addEventListener("dragleave", onDragLeave);
  stage.addEventListener("drop", onDrop);

  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => draw()) : null;
  ro?.observe(stage);

  const onChange = () => render();
  handle.on("change", onChange);
  render();

  // a section or scene provider arriving (or going) can change the body: re-cut
  const regOff = [];
  const onRegistry = () => {
    if (dead || !linked.url) return;
    clearTimeout(linked.timer);
    linked.timer = setTimeout(fetchSection, HULL_DEBOUNCE_MS);
  };
  loadGetRegistry().then((get) => {
    if (dead || !get) return;
    for (const type of ["geometry:section", "scene:source"]) {
      try {
        const off = get(type)?.on?.("changed", onRegistry);
        if (typeof off === "function") regOff.push(off);
      } catch {
        // no such registry here: nothing to follow
      }
    }
  });

  return () => {
    dead = true;
    disconnect();
    for (const off of regOff.splice(0)) off();
    stage.removeEventListener("dragover", onDragOver);
    stage.removeEventListener("dragleave", onDragLeave);
    stage.removeEventListener("drop", onDrop);
    handle.off("change", onChange);
    ro?.disconnect();
    if (raf) cancelAnimationFrame(raf);
    if (writeRaf) cancelAnimationFrame(writeRaf);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("keydown", onKeyDown);
    root.remove();
    style.remove();
  };
}
