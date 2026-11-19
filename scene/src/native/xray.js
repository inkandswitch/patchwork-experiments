// scene.xray (native, a view plugin): the X-ray, a held tool that shows the
// gears of the focus stage (PLANS.md section 4, "Visible gears"; NATIVE.md,
// "X-ray"). X (or its toolbar toggle) picks it up, X again or Escape puts it
// down. It wants the pointer free and takes nothing: every event goes on
// down the chain, so you play or edit with it held. While held:
//   - the object hovered (or pinned by a click; a click on nothing unpins) is
//     outlined with the links it is held through, and its lens is in the
//     panel: holders in input order, verbs, events, drawing, services, what
//     holds it now, who last wrote its fields;
//   - a picked extension (a row of the running list, or anywhere a row names
//     one) outlines its objects by trait, and its lens is in the panel: trait
//     values, the objects × verbs grid, what it holds now, services, writes;
//   - the layers on (a pref, `xray.layers`) add their sections and badges on
//     objects: claims, poses, clock, display, input route, links, people,
//     visibility.
// The panel is one drawer tab (embed: false: the stage's own chrome). All of
// it is the gears graph (gears.js) of the public reads, through the pure
// models (xray-model.js): rebuilt at most every REFRESH_MS on a flush, an
// event the hand hears or a channel message, and never while it isn't held.

import css from "./xray.css?inline";
import { boxes } from "../parts/boxes.js";
import { perFocus } from "../parts/per-focus.js";
import { writers } from "../stage/provenance.js";
import { buildGears } from "./gears.js";
import { LAYERS, extensionOutline, extensionSections, layerSections, layersOn, objectOutline, objectSections, runningSections, toggleLayer } from "./xray-model.js";

/** The prefs key of the layers on. */
export const PREF = "xray.layers";
/** At most one rebuild per this long (ms). */
export const REFRESH_MS = 200;

const FOCUS = [0.2, 0.9, 0.75];
const CHAIN = [0.55, 0.6, 0.95];
const TRAITS = [[1, 0.6, 0.15], [0.9, 0.3, 0.75], [0.35, 0.8, 0.3], [0.95, 0.85, 0.2]];

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** A section of the panel (xray-model.js's shape) as DOM. */
function sectionEl(s) {
  const sec = el("section", "xray-section");
  sec.dataset.id = s.id;
  sec.append(el("h3", null, s.title));
  if (s.note) sec.append(el("p", "xray-note", s.note));
  if (s.rows?.length) {
    const ul = el("ul", "xray-rows");
    for (const r of s.rows) {
      const li = el("li", `xray-row${r.older ? " older" : ""}`);
      if (r.ext) li.dataset.ext = r.ext;
      if (r.object) li.dataset.object = r.object;
      if (r.state) li.dataset.state = r.state;
      li.append(el("span", "xray-text", r.text));
      if (r.sub) li.append(el("span", "xray-sub", r.sub));
      if (r.chips?.length) {
        const chips = el("span", "xray-chips");
        for (const c of r.chips) {
          const chip = el("span", "xray-chip", c.text);
          if (c.state) chip.dataset.state = c.state;
          if (c.title) chip.title = c.title;
          chips.append(chip);
        }
        li.append(chips);
      }
      for (const line of r.lines ?? []) li.append(el("span", "xray-line", line));
      ul.append(li);
    }
    sec.append(ul);
  }
  if (s.table) {
    const wrap = el("div", "xray-table");
    const t = el("table");
    const head = el("tr");
    for (const h of s.table.head) head.append(el("th", null, h));
    t.append(head);
    for (const row of s.table.rows) {
      const tr = el("tr");
      for (const c of row) {
        const td = el("td", null, c.text);
        if (c.state) td.dataset.state = c.state;
        if (c.title) td.title = c.title;
        if (c.object) td.dataset.object = c.object;
        tr.append(td);
      }
      t.append(tr);
    }
    wrap.append(t);
    sec.append(wrap);
  }
  const n = s.table?.more || s.more;
  if (n) sec.append(el("p", "xray-note", `and ${n} more`));
  return sec;
}

function create(api) {
  api.style(css);
  let holding = false;
  let pinned = null; // the object a click pinned, in the focus stage
  let hovered = null; // the last object hovered there
  let picked = null; // the extension picked
  let g = null; // the last gears value
  let facet = null; // the focus facet g is of
  let close = null; // the drawer tab's
  let offTap = null;
  let timer = null;
  let shown = ""; // what the panel shows, as one string
  let prov = { doc: null, key: "", list: [] };

  const panel = el("div", "xray");
  panel.dataset.panel = "xray";

  const names = new Map(); // viewer → name (contact docs, looked up once)
  function who(viewer, mine) {
    if (mine || (viewer && viewer === api.viewer)) return "you";
    if (!viewer) return "someone";
    if (!names.has(viewer)) {
      names.set(viewer, null);
      if (String(viewer).startsWith("automerge:"))
        Promise.resolve(api.repo?.find?.(viewer))
          .then((h) => {
            const n = h?.doc?.()?.name;
            if (n) names.set(viewer, String(n)), schedule();
          })
          .catch(() => {});
    }
    return names.get(viewer) ?? "someone";
  }
  const prefs = () => api.use("prefs");

  // what it draws in the focus stage: outlines and badges, made again wherever the focus goes
  const at = perFocus(api, (f) => {
    let outline = [];
    const rgb = (o, theme) => (o.role === "focus" ? (theme.accent ?? FOCUS) : o.role === "chain" ? CHAIN : TRAITS[o.index % TRAITS.length]);
    const drawn = boxes(f, (objects, theme) => outline.filter((o) => objects[o.id]).map((o) => ({ key: o.key, id: o.id, rgb: rgb(o, theme) })), { renderOrder: 4 });
    const labels = f.labels();
    return {
      set(next, badges) {
        outline = next;
        drawn.refresh();
        labels.set(badges.map((b) => ({ key: b.key, text: b.text, on: b.on, className: `xray-badge xray-${b.kind}`, rank: 2 })));
      },
      dispose: () => drawn.dispose(),
    };
  });

  /** Who last wrote each field of these objects (their traits one by one), read once per doc and set of objects. */
  function provenanceOf(f, scene, ids) {
    const doc = f.doc();
    const key = ids.join("\u0000");
    if (prov.doc === doc && prov.key === key) return prov.list;
    let w = null;
    try {
      w = writers(doc); // (null for a doc that isn't Automerge's)
    } catch {
      // (an Automerge without the reads provenance needs: a probe's stand-in)
    }
    const list = [];
    for (const id of w ? ids : []) {
      const o = scene.objects[id];
      for (const k of Object.keys(o ?? {})) {
        const paths = k === "traits" && o.traits && typeof o.traits === "object" ? Object.keys(o.traits).map((t) => ["objects", id, "traits", t]) : [["objects", id, k]];
        for (const path of paths) list.push({ path, by: w.lastWriter(path)?.by ?? null });
      }
    }
    prov = { doc, key, list };
    return list;
  }

  /** The gears of the focus stage, from the public reads. */
  function gather(f, focusId) {
    const n = api.path({ focus: true })[0]?.stage;
    const mine = (name) => api.collect(name).filter((x) => x.stage === n);
    const reg = (t) => {
      try {
        return api.registry(t)?.filter?.(() => true) ?? [];
      } catch {
        return [];
      }
    };
    const inspect = mine("inspect").flatMap(({ id, value }) => {
      try {
        return typeof value === "function" ? [{ id, value: value() }] : [];
      } catch {
        return [];
      }
    });
    const scene = f.scene();
    const held = picked && g ? g.holds.filter((h) => h.ext === picked).map((h) => h.object) : [];
    const ids = [...new Set([focusId, ...held])].filter((id) => id && scene.objects[id]);
    return buildGears({
      metas: [...reg("scene:extension"), ...reg("scene:view")],
      scene,
      running: f.local.get().running ?? [],
      views: reg("scene:view").map((m) => m.id),
      settled: f.settled(),
      commands: mine("commands"),
      inputs: mine("input"),
      inspect,
      context: f.context(),
      owners: f.owners(),
      provenance: provenanceOf(f, scene, ids),
      targets: [null, ...ids],
    });
  }

  function refresh() {
    timer = null;
    if (!holding) return;
    const f = api.focus();
    if (!f) return;
    if (f !== facet) {
      facet = f;
      pinned = hovered = picked = g = null;
    }
    const objects = f.scene().objects;
    if (pinned && !objects[pinned]) pinned = null;
    const focusId = pinned ?? (hovered && objects[hovered] ? hovered : null);
    g = gather(f, focusId);
    if (picked && !g.extensions.some((e) => e.id === picked)) picked = null;
    const view = api.view.get();
    const ctx = { who, viewer: api.viewer, routes: api.routes(), peers: f.channel?.peers?.() ?? {}, session: f.channel?.session ?? null, view, hands: view.hands ?? [] };
    const on = layersOn(prefs()?.get(PREF, null));
    const layers = layerSections(g, on, ctx);
    render({
      focusId,
      object: focusId ? objectSections(g, focusId, ctx) : null,
      ext: picked ? extensionSections(g, picked, ctx) : null,
      layers: layers.sections,
      running: runningSections(g, view),
      on,
    });
    at()?.set([...(picked ? extensionOutline(g, picked) : []), ...(focusId ? objectOutline(g, focusId) : [])], layers.badges);
  }

  function render(m) {
    const sig = JSON.stringify([m, pinned, picked]);
    if (sig === shown) return;
    shown = sig;
    const top = el("div", "xray-top");
    top.append(el("span", "xray-focus", m.focusId ? `${pinned ? "Pinned" : "Hovering"}: ${m.object?.[0]?.title ?? m.focusId}` : "Hover an object; click pins it"));
    if (pinned) top.append(Object.assign(el("button", "xray-unpin", "Unpin"), { type: "button" }));
    const toggles = el("div", "xray-layers");
    for (const l of LAYERS) {
      const label = el("label");
      const box = Object.assign(el("input"), { type: "checkbox", checked: m.on.includes(l.id) });
      box.dataset.layer = l.id;
      label.append(box, l.name);
      toggles.append(label);
    }
    // (an extension picked comes first: it was the last thing asked for)
    const parts = [top];
    if (m.ext) parts.push(group("Extension", m.ext, Object.assign(el("button", "xray-unpick", "Close"), { type: "button" })));
    if (m.object) parts.push(group("Object", m.object));
    parts.push(group("Layers", m.layers, toggles), group("Scene", m.running));
    panel.replaceChildren(...parts);
  }
  function group(title, sections, extra) {
    const d = el("div", "xray-group");
    d.dataset.group = title.toLowerCase();
    const h = el("h2", null, title);
    if (extra) h.append(extra);
    d.append(h, ...sections.map(sectionEl));
    return d;
  }

  panel.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest?.(".xray-unpin")) pinned = null;
    else if (t.closest?.(".xray-unpick")) picked = null;
    else if (t.closest?.("[data-ext]")) picked = t.closest("[data-ext]").dataset.ext;
    else if (t.closest?.("[data-object]")) pinned = t.closest("[data-object]").dataset.object;
    else return;
    refresh();
    if (picked && t.closest?.("[data-ext]")) panel.scrollTop = 0;
  });
  panel.addEventListener("change", (e) => {
    const id = e.target?.dataset?.layer;
    if (!id) return;
    prefs()?.set(PREF, toggleLayer(prefs()?.get(PREF, null), id, e.target.checked));
    refresh();
  });

  function schedule() {
    if (holding && !timer) timer = api.after(REFRESH_MS, refresh);
  }

  // the hand: it takes nothing (every event goes on), it only looks
  const input = {
    press() {
      schedule();
      return null;
    },
    click(ev) {
      // (the focus stage's own pick: an object of another doc is no id here)
      const id = api.focus()?.pick(ev.x, ev.y)?.id ?? null;
      pinned = id && api.focus().scene().objects[id] ? id : null;
      schedule();
      return false;
    },
    put() {
      if (!holding) return;
      holding = false;
      timer?.();
      timer = null;
      offTap?.();
      offTap = null;
      const c = close;
      close = null;
      c?.();
      at()?.set([], []);
      pinned = hovered = picked = g = facet = null;
      shown = "";
    },
  };

  function start() {
    holding = true;
    close = api.use("drawer")?.dock(panel, { title: "X-ray", embed: false, onClose: () => ((close = null), holding && api.putDown()) }) ?? null;
    offTap = api.tap(schedule);
    refresh();
    return input;
  }

  return {
    commands: [
      {
        id: "xray",
        name: "X-ray",
        key: "x",
        show: ["toolbar"],
        tool: { pointer: true },
        state: (target) => (target == null ? { checked: holding, title: "X-ray: what runs here and how it meets" } : null),
        run: () => start(),
      },
    ],
    update() {
      if (!holding) return;
      const h = api.focus()?.view.get().hovered ?? null;
      if (h != null) hovered = h;
      schedule();
    },
    dispose() {
      input.put();
    },
    // for tests and probes
    get state() {
      return { held: holding, pinned, hovered, picked, gears: g };
    },
    pick(ext) {
      picked = ext;
      refresh();
    },
    panel,
  };
}

export default { create };
