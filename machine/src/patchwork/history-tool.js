// The Machine's history view: what one peer's engine went through, for any
// engine. The strip shows, tick by tick, every port's input on the branch the
// peer is on (confirmed up to the frontier, predicted past it), who held each
// port, and the checkpoints; under it, every conflict as a branch peeling off
// where a prediction proved wrong, running as far as the peer got on it
// before the real input came. Pick a tick to see that state; pick a conflict
// to see both sides of it, step through them, and where they differ: the
// inputs, the picture, the memory.
//
// It knows engines only by their contract: rows of bytes, a state to rebuild
// (history/rebuild.js) and a frame(view) to draw. The peer is this tab's
// player if one is playing this machine (patchwork/traced.js), else a
// watcher of its own, which predicts every port and so meets every late
// input. Never a watcher beside a player in one tab: they share the tab's
// repo, and a repo's own ephemeral messages don't come back to it, so the
// watcher would hear that player only from its durable inputs, a second late.
import { compile } from "../engine.js";
import { Host } from "../host/host.js";
import { seating } from "../host/session.js";
import { History, ancestorAt } from "../history/history.js";
import { Rebuilder } from "../history/rebuild.js";
import { diffStates, diffPictures } from "../history/diff.js";
import { load } from "./load.js";
import { traced } from "./traced.js";
import css from "./history.css?inline";

const PORT = ["#e4572e", "#2e86ab", "#3bb273", "#a23b72", "#f0a202", "#7768ae", "#1b998b", "#c3423f"];
const AXIS = 18, LANE = 16, BRANCHES = 64;

const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...kids.flat().filter((k) => k != null));
  return e;
};
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");
const hueOf = (b) => {
  let h = 2166136261;
  for (const x of b) h = Math.imul(h ^ x, 16777619);
  return (h >>> 0) % 360;
};
const zero = (b) => b.every((x) => x === 0);

export default function MachineHistory(handle, element) {
  const repo = window.repo;
  const style = el("style");
  style.textContent = css;
  const root = el("div", { class: "machine-history", tabindex: "0" });
  element.append(style, root);
  let stop = () => {};
  let disposed = false;

  const show = async () => {
    stop();
    stop = () => {};
    const doc = handle.doc();
    root.replaceChildren(el("p", { class: "note" }, doc?.session ? "Loading…" : "This machine hasn't been started yet: open it in the Machine view first."));
    if (!doc?.session) return;
    try {
      const s = await view(doc);
      if (disposed) s();
      else stop = s;
    } catch (e) {
      root.replaceChildren(el("p", { class: "note", "data-error": true }, String(e.message ?? e)));
    }
  };

  async function view(doc) {
    const note = root.querySelector(".note");
    const { session, content, wasm } = await load(repo, doc, (t) => (note.textContent = t));
    const engine = session.doc().engine;
    const [num, den] = engine.hz;
    const hz = num / den;
    const W = engine.inputBytes;
    const ports = engine.players;
    const machine = await compile(wasm);
    const rebuilder = new Rebuilder(machine, content);

    // ---- the peer whose history this is
    let watcher = null; // { host, history }, while there is no player here
    let src = null; // { kind, host, history, by? }
    let choosing = false;
    const choose = async () => {
      if (choosing) return;
      choosing = true;
      try {
        const p = traced.get(doc.session);
        if (p) {
          watcher?.host.close();
          watcher = null;
          src = { kind: "player", ...p };
        } else {
          if (!watcher) {
            const history = new History({ inputBytes: W, keep: Math.round(600 * hz) });
            const host = await Host.open(repo, doc.session, { wasm, content, trace: history.record });
            watcher = { host, history };
          }
          src = { kind: "watcher", ...watcher };
        }
        reset();
        source.textContent = src.kind === "player" ? `this tab's player (${src.by ?? "you"})` : "a watcher (no one plays in this tab)";
      } finally {
        choosing = false;
      }
    };

    // ---- what is looked at
    let cursor = null; // a tick, or null to follow the head
    let sel = null; // a conflict
    let span = Math.round(10 * hz); // ticks across the strip
    let end = null; // the strip's last tick; null follows the head
    let pictureView = 0;
    let path = { root: null, at: [] }; // the head's path by tick - root.tick, kept in step
    let shownKey = "", listed = -1, stripVersion = -1, uiDirty = true;

    function reset() {
      cursor = null;
      sel = null;
      end = null;
      path = { root: null, at: [] };
      shownKey = "";
      listed = -1;
      uiDirty = true;
    }

    // The head's path, by tick, updated from the head up to where it meets
    // what it was (a rollback rewrites only the ticks it re-stepped).
    function syncPath() {
      const h = src.history;
      const r = h.root;
      if (!r || !h.head) return;
      if (path.root !== r) path = { root: r, at: [] };
      const fresh = [];
      for (let n = h.head; n && path.at[n.tick - r.tick] !== n; n = n.parent) fresh.push(n);
      for (const n of fresh) path.at[n.tick - r.tick] = n;
      path.at.length = h.head.tick - r.tick + 1;
    }
    const onPath = (t) => (path.root ? path.at[t - path.root.tick] ?? null : null);

    // The two sides of a conflict at tick t.
    const keptAt = (c, t) => {
      if (src.history.kept(c.kept)) return onPath(t) ?? src.history.head;
      let n = c.kept;
      while (n.tick < t && n.kids.length) n = n.kids.at(-1);
      return n;
    };
    const abandonedAt = (c, t) => ancestorAt(c.leaf, Math.min(t, c.leaf.tick)) ?? c.leaf;
    const shownOn = (c) => {
      let frames = 0;
      for (let n = c.leaf; n && n !== c.parent; n = n.parent) frames += n.shown;
      return frames;
    };

    // ---- the page
    const source = el("span", { class: "source" });
    const stats = el("span", { class: "stats" });
    const followBtn = el("button", { onclick: () => { reset(); root.focus(); } }, "Follow");
    const viewSel = el("select", { title: "Which view the engine draws (a player, a camera)", onchange: () => { pictureView = +viewSel.value; shownKey = ""; } },
      ...Array.from({ length: Math.max(1, ports) }, (_, i) => el("option", { value: i }, `view ${i}`)));
    const screen = (side, label) => {
      const canvas = el("canvas");
      const cap = el("figcaption", {}, label);
      return { fig: el("figure", { "data-side": side }, canvas, cap), canvas, cap, image: null };
    };
    const kept = screen("kept", "Now");
    const lost = screen("abandoned", "Predicted");
    const delta = screen("diff", "Where they differ");
    const strip = el("canvas", { class: "strip" });
    const list = el("ol", { class: "conflicts" });
    const detail = el("section", { class: "detail" });
    root.replaceChildren(
      el("header", {}, el("strong", {}, doc.title ?? "Machine"), el("span", { class: "muted" }, "history of"), source, viewSel, el("span", { class: "grow" }), stats, followBtn),
      el("div", { class: "screens" }, kept.fig, lost.fig, delta.fig),
      strip,
      el("div", { class: "lower" }, el("section", { class: "list" }, el("h3", {}, "Conflicts"), list), detail),
    );

    function paint(s, pic, mask = null) {
      if (!pic?.width) return;
      if (s.canvas.width !== pic.width || s.canvas.height !== pic.height) {
        s.canvas.width = pic.width;
        s.canvas.height = pic.height;
        s.image = null;
      }
      s.image ??= new ImageData(pic.width, pic.height);
      const d = s.image.data;
      if (!mask) d.set(pic.rgba);
      else
        for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
          const on = mask[p];
          d[i] = on ? 255 : pic.rgba[i] * 0.3;
          d[i + 1] = on ? 40 : pic.rgba[i + 1] * 0.3;
          d[i + 2] = on ? 60 : pic.rgba[i + 2] * 0.3;
          d[i + 3] = 255;
        }
      s.canvas.getContext("2d").putImageData(s.image, 0, 0);
    }

    // ---- the screens and the detail, for what is selected
    function drawSelection() {
      const h = src.history;
      if (!h.head) return;
      if (!sel && cursor === null) {
        // Following: the peer's own picture, as it draws it.
        lost.fig.hidden = delta.fig.hidden = true;
        // Drawn once per state, not per frame: a picture costs a render.
        const now = `follow:${h.head.id}:${pictureView}`;
        if (kept.drawn !== now) {
          const pic = src.host.picture(pictureView);
          if (pic) paint(kept, pic);
          kept.drawn = now;
        }
        kept.cap.textContent = `Now · tick ${h.head.tick}`;
        if (shownKey !== "follow") {
          shownKey = "follow";
          detail.replaceChildren(el("p", { class: "note" }, "Following the head. Click the strip to look at a tick, or a branch (or a conflict in the list) to see both sides of it. ← → step a tick; [ ] the previous and next conflict."));
        }
        return;
      }
      const t = cursor ?? sel.leaf.tick;
      const key = `${sel?.kept.id}:${t}:${pictureView}:${h.head.id}`;
      if (key === shownKey) return;
      shownKey = key;
      if (!sel) {
        const node = onPath(t);
        lost.fig.hidden = delta.fig.hidden = true;
        if (!node) return;
        paint(kept, rebuilder.at(node).frame(pictureView));
        kept.cap.textContent = `Tick ${t} · ${t < h.frontier ? "confirmed" : "predicted, so far"}`;
        detail.replaceChildren(...tickDetail(node).filter(Boolean));
        return;
      }
      const a = abandonedAt(sel, t), k = keptAt(sel, t);
      const sa = rebuilder.snapshot(a);
      const picA = rebuilder.at(a).frame(pictureView);
      const sk = rebuilder.snapshot(k);
      const picK = rebuilder.at(k).frame(pictureView);
      const d = diffStates(sa, sk);
      const pd = diffPictures(picA, picK);
      lost.fig.hidden = delta.fig.hidden = false;
      paint(lost, picA);
      paint(kept, picK);
      if (pd) paint(delta, picK, pd.mask);
      lost.cap.textContent = `Predicted · tick ${a.tick}${a.tick < t ? " (as far as it got)" : ""}`;
      kept.cap.textContent = `${h.kept(sel.kept) ? "Kept" : "Stepped instead (since rolled back again)"} · tick ${k.tick}`;
      delta.cap.textContent = pd ? `${((100 * pd.pixels) / pd.of).toFixed(1)}% of pixels differ` : "Where they differ";
      detail.replaceChildren(...conflictDetail(sel, t, d, pd).filter(Boolean));
    }

    const bits = (a, b) =>
      el("span", { class: "bits" }, ...Array.from(a, (x, i) =>
        el("span", { class: "byte" }, ...Array.from({ length: 8 }, (_, j) => {
          const bit = 7 - j;
          const on = (x >> bit) & 1, other = b ? (b[i] >> bit) & 1 : on;
          return el("i", { "data-on": !!on, "data-diff": on !== other });
        }))));

    function tickDetail(node) {
      const h = src.history;
      const row = node.row;
      const forks = node.parent?.kids.length > 1 ? h.conflicts.filter((c) => c.parent === node.parent) : [];
      return [
        el("h3", {}, `Tick ${node.tick - 1} → ${node.tick}`),
        el("p", { class: "note" }, `${node.tick <= h.frontier ? "Confirmed: every peer with these inputs has this state." : "Past the frontier: some input here is still a prediction."} Shown on ${node.shown} frame${node.shown === 1 ? "" : "s"}.`),
        row && el("table", {}, el("tr", {}, el("th", {}, "Port"), el("th", {}, "Input"), el("th", {}, "Bits")),
          ...Array.from({ length: ports }, (_, p) => {
            const b = row.subarray(p * W, (p + 1) * W);
            return el("tr", {}, el("td", {}, el("span", { class: "swatch", style: `background:${PORT[p % PORT.length]}` }), `P${p + 1}`), el("td", { class: "mono" }, hex(b)), el("td", {}, bits(b)));
          })),
        forks.length ? el("p", {}, `This step was taken ${forks.length + 1} ways: it is a conflict.`) : null,
      ];
    }

    function conflictDetail(c, t, d, pd) {
      const late = c.leaf.tick - c.parent.tick;
      const ago = ((src.history.at - c.at) / 1000).toFixed(1);
      return [
        el("h3", {}, `Conflict at tick ${c.parent.tick}: ${c.ports.map((p) => `P${p + 1}`).join(", ")}`),
        el("p", {}, `This peer predicted ${c.ports.length === 1 ? "this port's input" : "these ports' inputs"} (each repeats its last known input), stepped on ${late} tick${late === 1 ? "" : "s"} (${Math.round((late * 1000) / hz)} ms) to tick ${c.leaf.tick}, then learned the real input, ${ago} s ago. It rolled back and stepped ${c.restepped} tick${c.restepped === 1 ? "" : "s"} again; the predicted branch reached the screen on ${shownOn(c)} frame${shownOn(c) === 1 ? "" : "s"}.`),
        el("table", {}, el("tr", {}, el("th", {}, "Port"), el("th", {}, "Predicted"), el("th", {}, "Real"), el("th", {}, "Bits (real; red where the prediction differs)")),
          ...c.ports.map((p) => {
            const a = c.abandoned.row.subarray(p * W, (p + 1) * W), k = c.kept.row.subarray(p * W, (p + 1) * W);
            return el("tr", {}, el("td", {}, el("span", { class: "swatch", style: `background:${PORT[p % PORT.length]}` }), `P${p + 1}`), el("td", { class: "mono" }, hex(a)), el("td", { class: "mono" }, hex(k)), el("td", {}, bits(k, a)));
          })),
        el("h3", {}, `At tick ${t}`, el("input", { type: "range", min: c.parent.tick + 1, max: Math.max(c.leaf.tick, c.parent.tick + 1), value: t, oninput: (e) => { cursor = +e.target.value; shownKey = ""; } })),
        el("p", {}, d.bytes === 0 && d.globals === 0
          ? "The two states are the same here: the branches have converged."
          : `The states differ in ${d.bytes.toLocaleString()} byte${d.bytes === 1 ? "" : "s"} of memory, in ${d.regions.length} place${d.regions.length === 1 ? "" : "s"}${d.globals ? `, and ${d.globals} global${d.globals === 1 ? "" : "s"}` : ""}${pd ? `; ${pd.pixels.toLocaleString()} pixels of the picture` : ""}.`),
        d.regions.length ? el("ul", { class: "regions mono" }, ...d.regions.slice(0, 12).map(([a, b]) => el("li", {}, `0x${a.toString(16).padStart(8, "0")}–0x${b.toString(16).padStart(8, "0")} · ${b - a} B span`)), d.regions.length > 12 ? el("li", {}, `… ${d.regions.length - 12} more`) : null) : null,
      ];
    }

    // ---- the list of conflicts, newest first
    function drawList() {
      const cs = src.history.conflicts;
      if (cs.length === listed && !uiDirty) return;
      listed = cs.length;
      const shown = cs.slice(-200).reverse();
      list.replaceChildren(...shown.map((c) => el("li", {
        "data-selected": c === sel,
        onclick: () => select(c),
      }, el("span", { class: "swatch", style: `background:${PORT[c.ports[0] % PORT.length]}` }),
        `tick ${c.parent.tick} · ${c.ports.map((p) => `P${p + 1}`).join(",")} · ${c.leaf.tick - c.parent.tick} late${shownOn(c) ? ` · shown ${shownOn(c)}` : ""}`)),
        cs.length > 200 ? el("li", { class: "muted" }, `and ${cs.length - 200} older`) : null);
      if (!cs.length) list.replaceChildren(el("li", { class: "muted" }, "None yet. They happen when an input arrives after the tick it was for has been stepped on a prediction, and the prediction was wrong."));
    }

    function select(c) {
      sel = c;
      cursor = c ? c.leaf.tick : cursor;
      if (c) end = Math.max(c.leaf.tick + Math.round(span * 0.2), Math.min(src.history.head.tick, c.parent.tick + span));
      shownKey = "";
      uiDirty = true;
    }

    // ---- the strip
    let hits = []; // [x0, y0, x1, y1, conflict]
    const lastTick = () => (end ?? Math.max(src.history.head.tick, src.history.target));
    function drawStrip() {
      const h = src.history;
      const dpr = window.devicePixelRatio || 1;
      const cssW = strip.clientWidth || 600;
      const cssH = AXIS + ports * LANE + BRANCHES;
      if (strip.width !== Math.round(cssW * dpr) || strip.height !== Math.round(cssH * dpr)) {
        strip.width = Math.round(cssW * dpr);
        strip.height = Math.round(cssH * dpr);
        strip.style.height = `${cssH}px`;
      }
      const g = strip.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cs = getComputedStyle(root);
      const ink = cs.color, faint = cs.getPropertyValue("--hist-faint").trim() || "#8884";
      g.clearRect(0, 0, cssW, cssH);
      const t1 = lastTick(), t0 = t1 - span;
      const x = (t) => ((t - t0) / span) * cssW;
      const tickAtX = (px) => Math.round(t0 + (px / cssW) * span);

      // Axis: seconds, checkpoints.
      g.fillStyle = ink;
      g.font = "10px system-ui, sans-serif";
      const step = [1, 2, 5, 10, 30, 60, 120, 300].find((s) => (s * hz * cssW) / span > 60) ?? 600;
      for (let s = Math.ceil(t0 / hz / step) * step; s * hz <= t1; s += step) {
        g.fillRect(x(s * hz), AXIS - 4, 1, 4);
        g.fillText(`${s}s`, x(s * hz) + 2, 10);
      }
      const sdoc = session.doc();
      g.fillStyle = "#c80";
      for (const k of Object.keys(sdoc.checkpoints ?? {})) {
        const cx = x(+k);
        if (cx < 0 || cx > cssW) continue;
        g.beginPath();
        g.moveTo(cx, AXIS - 9); g.lineTo(cx + 4, AXIS - 5); g.lineTo(cx, AXIS - 1); g.lineTo(cx - 4, AXIS - 5);
        g.fill();
      }

      // Port lanes: who held it, and its input on the head's path.
      const seated = seating(sdoc.seats, ports);
      const perPx = span / cssW;
      for (let p = 0; p < ports; p++) {
        const y = AXIS + p * LANE;
        g.fillStyle = faint;
        g.fillRect(0, y + LANE - 1, cssW, 1);
        for (const s of seated[p]) {
          const a = Math.max(0, x(s.from)), b = Math.min(cssW, x(Math.min(s.until, t1 + 1)));
          if (b <= a) continue;
          g.fillStyle = PORT[p % PORT.length] + "22";
          g.fillRect(a, y, b - a, LANE - 1);
        }
        const cols = perPx > 1 ? cssW : span;
        for (let i = 0; i < cols; i++) {
          const t = perPx > 1 ? Math.floor(t0 + i * perPx) : t0 + i;
          const n = onPath(t + 1);
          if (!n?.row) continue;
          const b = n.row.subarray(p * W, (p + 1) * W);
          if (zero(b)) continue;
          g.fillStyle = `hsla(${hueOf(b)}, 65%, 50%, ${t < h.frontier ? 1 : 0.4})`;
          const px = perPx > 1 ? i : x(t);
          g.fillRect(px, y + 3, Math.max(1, perPx > 1 ? 1 : cssW / span), LANE - 7);
        }
        g.fillStyle = ink;
        g.fillText(`P${p + 1}`, 3, y + 11);
      }

      // Branches: each conflict peels off where it forked and runs to where
      // the peer had got on it.
      const top = AXIS + ports * LANE;
      g.fillStyle = faint;
      g.fillRect(0, top + 6, cssW, 1);
      hits = [];
      const slots = [];
      for (const c of h.conflicts) {
        if (c.leaf.tick < t0 || c.parent.tick > t1) continue;
        let slot = slots.findIndex((e) => e < c.parent.tick);
        if (slot < 0) slot = slots.length;
        if (slot > 6) continue;
        slots[slot] = c.leaf.tick + 1;
        const y = top + 14 + slot * 7;
        const a = x(c.parent.tick), b = Math.max(x(c.leaf.tick), a + 3);
        g.strokeStyle = PORT[c.ports[0] % PORT.length];
        g.lineWidth = c === sel ? 3 : 1.5;
        g.beginPath();
        g.moveTo(a, top + 6);
        g.lineTo(Math.min(b, a + 4), y);
        g.lineTo(b, y);
        g.stroke();
        hits.push([a - 3, top + 6, b + 3, y + 4, c]);
      }
      g.fillStyle = ink;
      g.fillText(`${h.conflicts.length} conflicts · ${h.idle} idle rollbacks`, 3, top + BRANCHES - 4);

      // The frontier, the head, the cursor.
      const line = (t, color, dash = []) => {
        const lx = x(t);
        if (lx < 0 || lx > cssW) return;
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.setLineDash(dash);
        g.beginPath();
        g.moveTo(lx + 0.5, 0);
        g.lineTo(lx + 0.5, cssH);
        g.stroke();
        g.setLineDash([]);
      };
      line(h.frontier, "#3a3");
      line(h.head.tick, ink, [3, 3]);
      if (cursor !== null) line(cursor, "#e33");
      strip.tickAtX = tickAtX;
    }

    // ---- input: pan, zoom, pick
    let drag = null;
    strip.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, end: lastTick(), moved: false };
      strip.setPointerCapture(e.pointerId);
    });
    strip.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved) end = Math.round(drag.end - (dx / strip.clientWidth) * span);
    });
    strip.addEventListener("pointerup", (e) => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      const r = strip.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const hit = hits.find(([a, b, c, d2]) => px >= a && px <= c && py >= b && py <= d2);
      if (hit) return select(hit[4]);
      const h = src.history;
      const t = Math.max(h.root.tick, Math.min(h.head.tick, strip.tickAtX(px)));
      if (sel && (t <= sel.parent.tick || t > sel.leaf.tick)) select(null);
      cursor = t;
      end ??= lastTick();
      shownKey = "";
      root.focus();
    });
    strip.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = strip.getBoundingClientRect();
      const t = strip.tickAtX(e.clientX - r.left);
      const t1 = lastTick();
      const next = Math.max(20, Math.min(Math.round(1200 * hz), Math.round(span * Math.pow(1.0015, e.deltaY))));
      // Keep the tick under the pointer where it is.
      if (end !== null || cursor !== null || sel) end = Math.round(t + ((t1 - t) * next) / span);
      span = next;
    }, { passive: false });
    root.addEventListener("keydown", (e) => {
      const h = src.history;
      const cs = h.conflicts;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const t = (cursor ?? h.head.tick) + (e.key === "ArrowLeft" ? -1 : 1);
        cursor = sel ? Math.max(sel.parent.tick + 1, Math.min(sel.leaf.tick, t)) : Math.max(h.root.tick, Math.min(h.head.tick, t));
        end ??= lastTick();
        shownKey = "";
      } else if ((e.key === "[" || e.key === "]") && cs.length) {
        const i = sel ? cs.indexOf(sel) : cs.length;
        const j = Math.max(0, Math.min(cs.length - 1, i + (e.key === "[" ? -1 : 1)));
        select(cs[j]);
      } else if (e.key === "Escape") reset();
      else return;
      e.preventDefault();
    });

    // ---- the loop
    const onSession = () => (uiDirty = true);
    session.on("change", onSession);
    await choose();
    let raf = 0, lastStrip = 0, lastStats = 0;
    const loop = (now) => {
      raf = requestAnimationFrame(loop);
      if (src.kind === "watcher") src.host.frame();
      // A player here may have come, or gone (its view closed).
      if ((traced.get(doc.session)?.history ?? null) !== (src.kind === "player" ? src.history : null)) choose();
      if (now - lastStats > 500) {
        lastStats = now;
        const h = src.history, st = src.host.stats ?? {};
        stats.textContent = `tick ${h.head?.tick ?? 0} · frontier ${h.frontier} · ${h.conflicts.length} conflicts · ${st.rewinds ?? 0} rollbacks · ${h.size.toLocaleString()} states held`;
        followBtn.disabled = cursor === null && !sel && end === null;
      }
      if (!src.history.head) return;
      syncPath();
      if (src.history.version !== stripVersion || uiDirty || drag || now - lastStrip > 250) {
        if (now - lastStrip > 33 || uiDirty) {
          stripVersion = src.history.version;
          lastStrip = now;
          drawStrip();
          drawList();
          uiDirty = false;
        }
      }
      try {
        drawSelection();
      } catch (e) {
        detail.replaceChildren(el("p", { class: "note", "data-error": true }, String(e.message ?? e)));
      }
    };
    raf = requestAnimationFrame(loop);
    root.focus();

    return () => {
      cancelAnimationFrame(raf);
      session.off("change", onSession);
      watcher?.host.close();
    };
  }

  let last = JSON.stringify([handle.doc()?.session, handle.doc()?.content]);
  const onChange = () => {
    const now = JSON.stringify([handle.doc()?.session, handle.doc()?.content]);
    if (now !== last) {
      last = now;
      show();
    }
  };
  handle.on("change", onChange);
  show();

  return () => {
    disposed = true;
    handle.off("change", onChange);
    stop();
    root.remove();
    style.remove();
  };
}
