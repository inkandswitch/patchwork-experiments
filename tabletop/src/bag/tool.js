// The bag's 2D panel (`patchwork:tool` "bag"): what is inside by kind, how
// many, the draw rule, and Draw / Empty. Plain DOM, re-read on every change.
//
// It is useful on its own, outside any scene: drawing there just takes the
// item out and says what came out, and "Out of the bag" can put it back. The
// same panel is what the scene extension docks beside a scene ("Look
// inside"), with a `host`: there it reads by the scene's rule (an item whose
// object is on the table isn't inside), Draw sets pieces down by the bag,
// and there is no "Out of the bag" (what is out is on the table).
//
// Everything about the contents goes through contents.js and moves.js.

import css from "./styles.css?inline";
import { count, forget, inside, kinds, outside, putIn } from "./contents.js";
import { DEFAULT_TITLE, lookOf } from "./datatype.js";
import { RULES, replaces, ruleOf } from "./draw.js";
import { drawOne } from "./moves.js";
import { kindOf } from "./object.js";

const OPEN_EVENT = "patchwork:open-document";
const MAX_SEVERAL = 10;

const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, String(v));
  }
  e.append(...children.filter((c) => c != null));
  return e;
};

/** A sentence for what came out: "Drew: Cube, Cube, Disc". */
export function drewText(names, { copies = false } = {}) {
  if (!names.length) return "The bag is empty.";
  return `Drew: ${names.join(", ")}${copies ? " (copies: they stay in the bag)" : ""}`;
}

/**
 * @param {object} handle  the bag doc's DocHandle
 * @param {HTMLElement} element  where to mount (element.repo optional)
 * @param {{ shadow?: () => ((key: string) => boolean) | null, draw?: (n: number) => void, empty?: () => void, subscribe?: (fn: () => void) => void } | null} [host]
 *   given by the scene extension when the panel is docked beside a scene
 */
export default function BagTool(handle, element, host = null) {
  const repo = element?.repo ?? globalThis.repo ?? null;
  // who a draw made here is by (contents.js `out.by`): this mount, nobody else
  const by = `tool:${Math.random().toString(36).slice(2, 12)}`;
  let dead = false;
  let status = "";
  const doc = () => handle.doc() ?? {};
  const shadow = () => host?.shadow?.() ?? null;
  const change = (fn) => handle.change(fn);

  const style = el("style");
  style.textContent = css;

  // ── doing things ──
  function drawSome(n) {
    if (host?.draw) {
      host.draw(n);
      status = n === 1 ? "Set down beside the bag." : `${n} set down beside the bag.`;
      return render();
    }
    const rule = ruleOf(doc());
    const names = [];
    for (let i = 0; i < n; i++) {
      const drawn = drawOne({ bag: handle, rule, by, shadow: shadow() });
      if (!drawn) break;
      names.push(kindOf(drawn.entry.object).name);
    }
    status = drewText(names, { copies: replaces(rule) });
    render();
  }
  function emptyOut() {
    if (host?.empty) {
      host.empty();
      status = "Emptied out round the bag.";
      return render();
    }
    const n = count(doc(), shadow());
    for (let i = 0; i < n; i++) if (!drawOne({ bag: handle, rule: "top", by, shadow: shadow() })) break;
    status = n ? `Emptied: ${n} out.` : "The bag is empty.";
    render();
  }
  /** Put back what was taken out: one kind's, or everything (`kind` null). */
  function putBack(kind = null) {
    const back = outside(doc()).filter(({ entry }) => kind == null || kindOf(entry.object).key === kind);
    if (!back.length) return;
    // oldest first, so they go back in the order they were in
    change((d) => putIn(d, back.reverse().map(({ entry }) => ({ id: entry.id, from: entry.from, object: entry.object, scale: entry.scale }))));
    status = `Put back: ${back.length}.`;
  }
  async function newScene() {
    if (!repo?.create2) return;
    try {
      const { sackFile, sceneWithBag } = await import("./new-scene.js");
      const { sceneImportUrl } = await import("./scene-package.js");
      const file = sackFile(doc());
      const fileUrl = (await repo.create2(file.doc)).url;
      const scene = await repo.create2(sceneWithBag({ bagUrl: handle.url, bagDoc: doc(), fileUrl, hint: file.hint, sceneImportUrl: await sceneImportUrl() }));
      root.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { url: scene.url, toolId: "scene" }, bubbles: true, composed: true }));
    } catch (err) {
      status = `Couldn't make a scene: ${err?.message ?? err}`;
      render();
    }
  }

  // ── the view (built once; render() fills it in) ──
  const title = el("input", { class: "title", "aria-label": "Name", onchange: () => change((d) => (d.title = title.value.trim() || DEFAULT_TITLE)) });
  const total = el("span", { class: "total", title: "How many are inside. Everyone can see this number" });
  const rule = el("select", { "aria-label": "Draw rule", onchange: () => change((d) => (d.rule = rule.value)) }, ...RULES.map((r) => el("option", { value: r.value }, r.label)));
  const drawOneBtn = el("button", { type: "button", "data-primary": true, onclick: () => drawSome(1) }, "Draw");
  const several = el("input", { type: "number", min: 2, max: MAX_SEVERAL, value: 2, "aria-label": "How many to draw" });
  const drawSeveralBtn = el("button", { type: "button", onclick: () => drawSome(Math.min(MAX_SEVERAL, Math.max(1, Math.floor(Number(several.value)) || 1))) }, "Draw several");
  const emptyBtn = el("button", { type: "button", onclick: emptyOut }, "Empty");
  const statusLine = el("p", { class: "status", role: "status" });
  const kindList = el("ul", { class: "kinds" });
  const outHead = el("h3", {}, "Out of the bag");
  const outList = el("ul", { class: "out" });
  const outRow = el(
    "div",
    { class: "row" },
    el("button", { type: "button", onclick: () => putBack(null) }, "Put all back"),
    el("button", { type: "button", title: "Forget what was taken out: it can't be put back from here afterwards", onclick: () => change((d) => forget(d)) }, "Forget"),
  );
  const color = el("input", { type: "color", "aria-label": "Colour", onchange: () => change((d) => (d.look.color = color.value)) });
  const size = el("input", {
    type: "number",
    min: 2,
    max: 200,
    step: 1,
    "aria-label": "Width in centimetres",
    onchange: () => {
      const cm = Number(size.value);
      if (Number.isFinite(cm) && cm > 0) change((d) => (d.look.size = Math.min(2, Math.max(0.02, cm / 100))));
    },
  });
  const sceneBtn = el("button", { type: "button", title: "Make a scene with this bag on it", onclick: newScene }, "Put it in a new scene");
  const root = el(
    "div",
    { class: "bag-tool" },
    el("div", { class: "head" }, title, total),
    el(
      "p",
      { class: "note" },
      "Not a secret: anyone who opens this bag can read what is inside it here. Everyone can see how many there are; in a scene, what is inside is out of sight, and looking in here is how you peek.",
    ),
    el("div", { class: "row" }, el("label", {}, "Draw", rule)),
    el("div", { class: "row" }, drawOneBtn, several, drawSeveralBtn, emptyBtn),
    statusLine,
    el("h3", {}, "Inside"),
    kindList,
    outHead,
    outList,
    outRow,
    el("h3", {}, "Look"),
    el("div", { class: "row" }, el("label", {}, "Colour", color), el("label", {}, "Width (cm)", size)),
    host ? null : el("div", { class: "row" }, sceneBtn),
  );
  element.append(style, root);

  const rows = (list, more) => {
    const ks = kinds(list, kindOf);
    return ks.length ? ks.map((k) => el("li", { "data-kind": k.name }, el("span", { class: "name" }, k.name), el("span", { class: "n" }, `× ${k.n}`), more?.(k))) : null;
  };
  function render() {
    if (dead) return;
    const d = doc();
    const active = element.ownerDocument?.activeElement;
    const listed = inside(d, shadow());
    const n = listed.length;
    const copies = replaces(ruleOf(d));
    if (active !== title) title.value = d.title || DEFAULT_TITLE;
    total.replaceChildren(String(n), el("small", {}, " inside"));
    total.dataset.count = String(n);
    if (active !== rule) rule.value = ruleOf(d);
    drawOneBtn.disabled = n === 0;
    drawSeveralBtn.disabled = copies ? n === 0 : n < 2;
    emptyBtn.disabled = n === 0;
    statusLine.textContent = status;
    statusLine.hidden = !status;
    kindList.replaceChildren(...(rows(listed) ?? [el("li", { class: "empty" }, "Nothing inside. In a scene, drop things on the bag to put them in.")]));
    const out = outside(d);
    const outRows = rows(out, (k) => el("button", { type: "button", onclick: () => putBack(k.key) }, "Put back"));
    // (beside a scene, what is out is on the table, and goes back by being dropped on the bag)
    outHead.hidden = outList.hidden = outRow.hidden = !outRows || !!host;
    outList.replaceChildren(...(outRows ?? []));
    const look = lookOf(d);
    if (active !== color) color.value = look.color;
    if (active !== size) size.value = String(+(look.size * 100).toFixed(1));
    sceneBtn.disabled = !repo?.create2;
  }

  render();
  handle.on?.("change", render);
  host?.subscribe?.(render);

  return () => {
    dead = true;
    handle.off?.("change", render);
    host?.subscribe?.(() => {});
    root.remove();
    style.remove();
  };
}
