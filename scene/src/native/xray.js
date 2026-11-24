// scene.xray (native, a view plugin): the X-ray, a held tool that shows the
// gears of the focus stage as a view of the whole scene (PLANS.md section 4,
// "Visible gears"; NATIVE.md, "X-ray"). X (or its toolbar toggle) picks it up,
// X again or Escape (while it is the top hand) puts it down. It is an
// ordinary tool on the hand stack that passes every event (it acts on a click
// and returns false), and it doesn't ask for the pointer: the game, Edit and
// Measure go on working under it, a walk keeps its lock. While held:
//   - every object is ghosted and outlined in the colours of the extensions
//     that respond to it (one colour per extension, everywhere), those
//     nothing responds to faded; glyphs mark live state (a lock: claimed,
//     a hand: held, a gear: driven by a process, an eye: shown otherwise),
//     links are labelled boxes; all of it api.display's looks and labels;
//   - the legend (a drawer tab) lists the running extensions by package with
//     what each holds; a click on a row isolates it (its objects lit, the
//     rest faded), again clears it;
//   - the object under the pointer (or the eye) has a card beside it: its
//     traits, the responding chain in input order with verbs as keycaps, its
//     live state; a click pins it and opens its details in the panel;
//   - the last event's route runs along the bottom as boxes.
// All of it is the gears graph (gears.js) of the public reads, through the
// pure models (xray-model.js): rebuilt at most every REFRESH_MS on a flush,
// an event the hand hears or a channel message, never while it isn't held.

import css from "./xray.css?inline";
import { perFocus } from "../per-focus.js";
import { looksFromEye, parseKey, writers } from "../stage/public.js";
import { buildGears } from "./gears.js";
import { GLYPHS, card, colours, details, glyphs, legend, looks, strip } from "./xray-model.js";

/** At most one rebuild per this long (ms). */
export const REFRESH_MS = 200;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const swatch = (colour) => {
  const s = el("span", "xray-swatch");
  s.style.setProperty("--xc", colour);
  return s;
};
/** A verb as a keycap chip. */
const verbEl = (v) => {
  const e = el("span", "xray-verb", v.text);
  e.dataset.state = v.state;
  e.title = v.title;
  if (v.key) e.append(el("kbd", null, v.key));
  return e;
};
/** An extension as a coloured chip, with its verbs. */
const extChip = (x) => {
  const e = el("span", "xray-ext");
  e.dataset.ext = x.ext;
  e.append(swatch(x.colour), el("b", null, x.name), ...x.verbs.map(verbEl));
  return e;
};
const glyphEl = (g) => {
  const e = el("span", "xray-glyph", `${GLYPHS[g.kind].text} ${g.title}`);
  e.dataset.kind = g.kind;
  return e;
};

/** The hover card as DOM. */
function cardEl(c) {
  const d = el("div", "xray-card");
  d.append(el("h4", null, c.title));
  if (c.traits.length) {
    const t = el("div", "xray-traits");
    for (const x of c.traits) {
      const chip = el("span", "xray-trait", x.text);
      if (x.colour) chip.style.setProperty("--xc", x.colour);
      else chip.dataset.state = "none";
      t.append(chip);
    }
    d.append(t);
  }
  if (c.chain.length) {
    const chain = el("div", "xray-chain");
    c.chain.forEach((x, i) => {
      if (i) chain.append(el("span", "xray-arrow", "→"));
      chain.append(extChip(x));
    });
    d.append(chain);
  }
  if (c.plugins.length) {
    const also = el("div", "xray-chain xray-also");
    also.append(el("span", "xray-note", "also"));
    for (const x of c.plugins) also.append(extChip(x));
    d.append(also);
  }
  if (c.live.length) {
    const live = el("div", "xray-live");
    for (const g of c.live) live.append(glyphEl(g));
    d.append(live);
  }
  return d;
}

/** The route strip as DOM. */
function stripEl(s) {
  const wrap = el("div", "xray-strip");
  if (!s.last) return wrap;
  const one = (r, cls) => {
    const row = el("div", cls);
    row.append(el("span", "xray-route-on", `${r.type} on ${r.on}`));
    r.boxes.forEach((b, i) => {
      if (i) row.append(el("span", "xray-arrow", "→"));
      const box = el("span", "xray-box");
      box.dataset.kind = b.kind;
      if (b.took) {
        box.dataset.took = "";
        if (b.took.colour) box.style.setProperty("--xc", b.took.colour);
      }
      box.append(el("b", null, b.label), el("span", null, b.took ? b.took.name : b.names.length > 2 ? `${b.names.length} offered` : b.names.join(", ")));
      box.title = b.names.join(", ");
      row.append(box);
    });
    if (!r.took) row.append(el("span", "xray-note", "nobody took it"));
    return row;
  };
  wrap.append(one(s.last, "xray-route"));
  if (s.older.length) {
    const older = el("div", "xray-older");
    for (const r of s.older) older.append(one(r, "xray-route"));
    wrap.append(older);
  }
  return wrap;
}

/** The panel's legend and details as DOM. */
function panelEls({ lg, det, isolated, pinnedName, keys, onScene, eyes }) {
  const out = [];
  const top = el("div", "xray-top");
  top.append(el("span", "xray-hint", pinnedName ? `Pinned: ${pinnedName}` : "Hover an object; a click pins it"));
  if (pinnedName) top.append(Object.assign(el("button", "xray-unpin", "Unpin"), { type: "button" }));
  out.push(top);
  if (lg.problems.length) {
    const p = el("ul", "xray-problems");
    for (const x of lg.problems) {
      const li = el("li");
      li.append(el("b", null, x.text), el("span", null, x.why));
      p.append(li);
    }
    out.push(p);
  }
  const row = (r) => {
    const li = el("li", "xray-row");
    li.dataset.ext = r.ext;
    if (r.on) li.dataset.on = "";
    li.append(swatch(r.colour), el("span", "xray-name", r.name), ...(r.count != null ? [el("span", "xray-count", String(r.count))] : []));
    li.title = r.on ? "Showing only this: click to clear" : "Click to show only what this holds";
    return li;
  };
  for (const grp of lg.groups) {
    const sec = el("section", "xray-pkg");
    sec.append(el("h3", null, grp.label));
    const ul = el("ul", "xray-rows");
    for (const r of grp.rows) ul.append(row(r));
    sec.append(ul);
    out.push(sec);
  }
  if (isolated) out.push(el("p", "xray-note", "Showing only one extension. Click its row again to clear."));
  if (lg.idle.length) {
    const d = el("details", "xray-idle");
    d.append(el("summary", null, `${lg.idle.length} more running, holding no objects`));
    const ul = el("ul", "xray-rows");
    for (const r of lg.idle) ul.append(row({ ...r, count: null }));
    d.append(ul);
    out.push(d);
  }
  if (onScene.length) {
    const sec = el("section", "xray-scene");
    sec.append(el("h3", null, "On the scene itself"));
    for (const x of onScene) sec.append(glyphEl(x));
    out.push(sec);
  }
  if (keys.length || eyes) {
    const k = el("div", "xray-key");
    for (const kind of keys) k.append(el("span", null, `${GLYPHS[kind].text} ${GLYPHS[kind].name}`));
    if (eyes) k.append(el("span", null, `${GLYPHS.eye.text} ${eyes} shown otherwise (hover one)`));
    out.push(k);
  }
  if (det) {
    const sec = el("section", "xray-details");
    sec.append(el("h3", null, `${det.title}, in input order`));
    for (const f of det.folds) {
      const d = el("details", "xray-fold");
      d.dataset.ext = f.ext;
      const s = el("summary");
      s.append(swatch(f.colour), el("b", null, f.name), el("span", "xray-sub", f.sub));
      d.append(s);
      if (f.verbs.length) {
        const v = el("div", "xray-chain");
        for (const x of f.verbs) v.append(verbEl(x));
        d.append(v);
      }
      for (const line of f.lines) d.append(el("div", "xray-line", line));
      sec.append(d);
    }
    if (det.now.length) {
      const d = el("details", "xray-fold");
      d.append(el("summary", null, `Holding it now (${det.now.length})`));
      for (const line of det.now) d.append(el("div", "xray-line", line));
      sec.append(d);
    }
    if (det.wrote.length) {
      const d = el("details", "xray-fold");
      d.append(el("summary", null, `Last written by (${det.wrote.length})`));
      for (const line of det.wrote) d.append(el("div", "xray-line", line));
      sec.append(d);
    }
    out.push(sec);
  }
  return out;
}

function create(api) {
  api.style(css);
  let holding = false;
  let pinned = null; // the object a click pinned, in the focus stage
  let hovered = null; // the object under the pointer (or the eye) there
  let isolated = null; // the extension the legend isolates
  let g = null; // the last gears value
  let model = null; // what was last drawn: { looks, glyphs, card, colour }
  let facet = null; // the focus facet g is of
  let close = null; // the drawer tab's
  let offTap = null;
  let timer = null;
  let shown = ""; // what the panel shows, as one string
  let prov = { doc: null, key: "", list: [] };

  const panel = el("div", "xray");
  panel.dataset.panel = "xray";
  const overlay = api.overlay();
  overlay.classList.add("xray-layer");
  const cardHost = el("div", "xray-card-host");
  cardHost.hidden = true;
  const stripHost = el("div", "xray-strip-host");
  stripHost.hidden = true;
  overlay.append(cardHost, stripHost);

  const names = new Map(); // viewer → name (contact docs, looked up once)
  function who(viewer, mine) {
    if (mine || (viewer && viewer === api.focus()?.channel.viewer)) return "you";
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

  // what it draws in the focus stage: every object's look, glyph labels; made again wherever the focus goes
  const at = perFocus(api, (f) => {
    const drawn = new Map(); // id → { sig, release }
    const labels = f.labels();
    const clear = () => {
      for (const d of drawn.values()) d.release();
      drawn.clear();
    };
    return {
      set(looksOf, items) {
        for (const [id, look] of Object.entries(looksOf)) {
          const sig = JSON.stringify(look);
          if (drawn.get(id)?.sig === sig) continue;
          drawn.get(id)?.release();
          drawn.set(id, { sig, release: f.display(id, look) });
        }
        for (const id of [...drawn.keys()]) {
          if (looksOf[id]) continue;
          drawn.get(id).release();
          drawn.delete(id);
        }
        labels.set(items);
      },
      dispose: clear,
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

  /** The gears of the focus stage, from the public reads; verbs for the objects the card and the details are of. */
  function gather(f, ids) {
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
    const these = [...new Set(ids)].filter((id) => id && scene.objects[id]);
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
      provenance: provenanceOf(f, scene, pinned && scene.objects[pinned] ? [pinned] : []),
      targets: [null, ...these],
    });
  }

  // The look, under lock (or a lock body under touch): the eye's, which moves
  // with no event of the stage's (a walk's keys held down), so it is looked
  // at again every REFRESH_MS while that lasts.
  const fromEye = () => looksFromEye(api.view.get().pointer);

  const self = () => api.id;
  const isSelf = (ext) => ext === self() || parseKey(ext)?.id === self();

  function refresh() {
    timer = null;
    if (!holding) return;
    const f = api.focus();
    if (!f) return;
    if (f !== facet) {
      facet = f;
      pinned = hovered = isolated = g = null;
    }
    const objects = f.scene().objects;
    if (fromEye()) {
      hovered = f.look()?.id ?? null;
      schedule();
    }
    if (pinned && !objects[pinned]) pinned = null;
    if (hovered && !objects[hovered]) hovered = null;
    g = gather(f, [pinned, hovered]);
    if (isolated && !g.extensions.some((e) => e.id === isolated)) isolated = null;
    // (a colour only for the extensions holding objects: the rest are neutral)
    const colour = colours(g.holds.filter((h) => h.via != null).map((h) => h.ext));
    // (what an extension overrides on its own: never the X-ray's own looks)
    const seen = { ...g, overrides: g.overrides.filter((o) => !isSelf(o.ext)) };
    const links = g.extensions.find((e) => e.id === "scene.links")?.inspect?.stages ?? [];
    const ctx = { who, self: self(), links };
    const lit = [pinned, hovered].filter(Boolean);
    const looksOf = looks(g, colour, { isolated, focus: lit, banded: hovered });
    const glyphsOf = glyphs(seen, ctx);
    const cardId = hovered ?? pinned;
    const c = cardId ? card(seen, cardId, colour, ctx) : null;
    const objectName = (id) => g.objects.find((o) => o.id === id)?.name ?? id;
    model = { looks: looksOf, glyphs: glyphsOf, card: c, colour };
    const items = [];
    for (const [id, list] of glyphsOf) {
      if (id == null) continue;
      const link = list.find((x) => x.kind === "link");
      // (an eye only on the one hovered: the legend counts them)
      const live = list.filter((x) => x.kind !== "link" && (x.kind !== "eye" || id === hovered)).map((x) => GLYPHS[x.kind].text);
      const text = [link ? `${GLYPHS.link.text} ${objectName(id)} · ${link.title}` : "", live.join(" ")].filter(Boolean).join("  ");
      if (!link && !live.length) continue;
      items.push({ key: `xray:${id}`, text, on: id, className: `xray-badge${link ? " xray-link" : ""}`, rank: 2 });
    }
    at()?.set(looksOf, items);
    renderPanel(legend(g, colour, { isolated }), pinned ? details(seen, pinned, colour, ctx) : null, [...new Set([...glyphsOf].flatMap(([id, l]) => (id == null ? [] : l.filter((x) => x.kind !== "eye" || id === hovered)).map((x) => x.kind)))].filter((k) => k !== "link" && k !== "eye"), glyphsOf.get(null) ?? [], [...glyphsOf].filter(([id, l]) => id != null && l.some((x) => x.kind === "eye")).length);
    renderCard(f, c);
    renderStrip(api.routes(), colour);
  }

  function renderPanel(lg, det, keys, onScene, eyes) {
    const sig = JSON.stringify([lg, det, isolated, pinned, keys, onScene, eyes]);
    if (sig === shown) return;
    shown = sig;
    const open = new Set([...panel.querySelectorAll("details[open]")].map((d) => `${d.className}|${d.dataset.ext ?? d.querySelector("summary")?.textContent}`));
    panel.replaceChildren(...panelEls({ lg, det, isolated, pinnedName: pinned ? det?.title : null, keys, onScene, eyes }));
    for (const d of panel.querySelectorAll("details")) if (open.has(`${d.className}|${d.dataset.ext ?? d.querySelector("summary")?.textContent}`)) d.open = true;
  }

  let cardSig = "";
  /** The card, beside the object: right of its box on screen, else left. */
  function renderCard(f, c) {
    if (!c) {
      cardHost.hidden = true;
      cardSig = "";
      return;
    }
    const sig = JSON.stringify(c);
    if (sig !== cardSig) {
      cardSig = sig;
      cardHost.replaceChildren(cardEl(c));
    }
    cardHost.hidden = false;
    const b = f.box(c.id);
    const pts = b ? [0, 1, 2, 3, 4, 5, 6, 7].map((i) => f.project([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]])).filter((p) => p?.visible) : [];
    if (!pts.length) {
      cardHost.hidden = true;
      return;
    }
    const left = Math.min(...pts.map((p) => p.x));
    const right = Math.max(...pts.map((p) => p.x));
    const top = Math.min(...pts.map((p) => p.y));
    const bottom = Math.max(...pts.map((p) => p.y));
    const w = overlay.clientWidth || 800;
    const h = overlay.clientHeight || 500;
    const cw = cardHost.offsetWidth || 260;
    const ch = cardHost.offsetHeight || 120;
    const x = right + 12 + cw <= w ? right + 12 : Math.max(4, left - 12 - cw);
    const y = Math.max(4, Math.min(top, h - ch - 100, bottom));
    cardHost.style.setProperty("--xx", `${Math.round(x)}px`);
    cardHost.style.setProperty("--xy", `${Math.round(y)}px`);
  }

  let stripSig = "";
  function renderStrip(routes, colour) {
    const s = routes.length ? strip(routes, { g, colour }) : { last: null, older: [] };
    const sig = JSON.stringify(s);
    if (sig === stripSig) return;
    stripSig = sig;
    stripHost.hidden = !s.last;
    stripHost.replaceChildren(stripEl(s));
  }

  panel.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest?.(".xray-unpin")) pinned = null;
    else if (t.closest?.(".xray-row[data-ext]")) {
      const ext = t.closest(".xray-row[data-ext]").dataset.ext;
      isolated = isolated === ext ? null : ext;
    } else return;
    refresh();
  });

  function schedule() {
    if (holding && !timer) timer = api.after(REFRESH_MS, refresh);
  }

  // the hand: it passes every event on (it only looks)
  const input = {
    press() {
      schedule();
      return null;
    },
    // (under lock the eye turns with the mouse: what it looks at is the look's)
    move(ev) {
      if (ev.locked) schedule();
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
      at()?.set({}, []);
      cardHost.hidden = stripHost.hidden = true;
      cardSig = stripSig = "";
      pinned = hovered = isolated = g = facet = model = null;
      shown = "";
    },
  };

  /** Put this X-ray down, from wherever it is in the stack (its drawer tab closed). */
  const putDown = () => {
    const mine = (api.view.get().held ?? []).find((t) => t.command === "xray" && parseKey(t.ext)?.id === api.id);
    if (mine) api.putDown(mine);
  };

  function start() {
    holding = true;
    close = api.use("drawer")?.dock(panel, { title: "X-ray", embed: false, pointer: false, onClose: () => ((close = null), holding && putDown()) }) ?? null;
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
        // a tool that doesn't ask for the pointer: a walk under it keeps its lock
        tool: {},
        state: (target) => (target == null ? { checked: holding, title: "X-ray: what runs here and how it meets" } : null),
        // (held from a stage the focus has since gone into: X there puts that one down)
        run: () => (holding ? (putDown(), null) : start()),
      },
    ],
    update() {
      if (!holding) return;
      if (!fromEye()) hovered = api.focus()?.view.get().hovered ?? null;
      schedule();
    },
    dispose() {
      input.put();
    },
    // for tests and probes
    get state() {
      return { held: holding, pinned, hovered, isolated, gears: g, looks: model?.looks ?? null, glyphs: model?.glyphs ?? null, card: model?.card ?? null };
    },
    isolate(ext) {
      isolated = ext;
      refresh();
    },
    panel,
    card: cardHost,
    strip: stripHost,
  };
}

export default { create };
