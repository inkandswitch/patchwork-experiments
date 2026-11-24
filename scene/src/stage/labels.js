// DOM labels over the canvas that track points in the world (STAGE.md,
// `labels()`), one set per owner, every owner's decluttered together.

import { Matrix4, Vector3 } from "three";

const v3 = (a) => (Array.isArray(a) ? new Vector3(Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0) : new Vector3().copy(a));

// Which labels give way when they overlap: a label is hidden if it would cover
// one of higher (or equal, earlier) rank, and rank NEVER_HIDE and up never
// hide. Each item says its own `rank` (1 if it doesn't).
const NEVER_HIDE = 2;

const labelRank = (entry) => (Number.isFinite(entry.rank) ? entry.rank : 1);

/** Measure an entry's element, once per text. */
function measure(e) {
  const text = e.el.textContent;
  if (e.sizeFor !== text || !e.w) {
    e.w = e.el.offsetWidth;
    e.h = e.el.offsetHeight;
    e.sizeFor = text;
  }
}

/** Hide labels that overlap one of higher rank. entries: { el, p: { x, y }, rank? }; caches each el's size. */
export function declutter(entries) {
  const sized = entries.map((e) => {
    measure(e);
    return { e, rank: labelRank(e) };
  });
  sized.sort((a, b) => b.rank - a.rank);
  const kept = [];
  const gap = 2;
  for (const { e, rank } of sized) {
    const r = { x0: e.p.x - e.w / 2 - gap, x1: e.p.x + e.w / 2 + gap, y0: e.p.y - e.h / 2 - gap, y1: e.p.y + e.h / 2 + gap };
    const hit = rank < NEVER_HIDE && kept.some((k) => r.x0 < k.x1 && r.x1 > k.x0 && r.y0 < k.y1 && r.y1 > k.y0);
    e.el.style.visibility = hit ? "hidden" : "";
    if (!hit) kept.push(r);
  }
}

/**
 * Labels, one set per owner (an extension's key), so each replaces its own
 * and every owner's are decluttered together. An item: { key (required),
 * text, and where it goes: position? (a point [x, y, z]), at?() → position
 * (asked each time it's placed: one that follows something), screen?
 * ({ x, y }, port px), or place?({ project, w, h }) → { x, y, leader?: { x, y } }
 * | null (port px, asked each time it's placed: `project` takes a point to
 * port px or null, w and h are the label's size; a leader is drawn from the
 * point given to the label); className?, data? (data-* attributes), rank?,
 * onPointerDown? }. Points are in the owner's frame.
 */
export class LabelLayer {
  /** @param {HTMLElement} parent  @param {() => void} [onChange]  a set changed (the viewport redraws) */
  constructor(parent, onChange = null) {
    this.el = document.createElement("div");
    this.el.className = "labels";
    parent.append(this.el);
    this.onChange = onChange;
    this.groups = new Map(); // owner → Map(key → { el, world, follow, screen, place, rank, item })
    this.frames = new Map(); // owner → () => its frame's world matrix (column-major) or null: its positions are in that frame
    this.shown = new Map(); // owner → () => are they shown now (a linked doc's, while its link's content is)
  }
  /** An owner's labels; `frame`: positions are in that frame (a stage's), and follow it as it moves; `shown`: whether they show now. */
  sync(owner, items, frame = null, shown = null) {
    if (typeof frame === "function") this.frames.set(owner, frame);
    else this.frames.delete(owner);
    if (typeof shown === "function") this.shown.set(owner, shown);
    else this.shown.delete(owner);
    const prev = this.groups.get(owner) ?? new Map();
    const next = new Map();
    for (const item of items ?? []) {
      if (item?.key == null || next.has(item.key)) continue;
      let entry = prev.get(item.key);
      if (!entry) {
        const el = document.createElement("div");
        entry = { el, dataKeys: [] };
        this.el.append(el);
      }
      prev.delete(item.key);
      entry.world = item.position ? v3(item.position) : null;
      entry.screen = item.screen ?? null;
      entry.follow = typeof item.at === "function" ? item.at : null;
      entry.place = typeof item.place === "function" ? item.place : null;
      entry.rank = Number.isFinite(item.rank) ? item.rank : undefined;
      entry.item = item;
      const el = entry.el;
      el.className = `label ${item.className ?? ""}`.trim();
      const text = item.text == null ? "" : String(item.text);
      if (el.textContent !== text) el.textContent = text;
      const data = item.data ?? {};
      for (const k of entry.dataKeys) if (!(k in data)) el.removeAttribute(`data-${k}`);
      for (const [k, v] of Object.entries(data)) {
        if (v == null || v === false) el.removeAttribute(`data-${k}`);
        else el.setAttribute(`data-${k}`, v === true ? "" : String(v));
      }
      entry.dataKeys = Object.keys(data);
      el.onpointerdown = item.onPointerDown
        ? (e) => {
            e.stopPropagation();
            item.onPointerDown(e);
          }
        : null;
      next.set(item.key, entry);
    }
    for (const { el, leader } of prev.values()) {
      el.remove();
      leader?.remove();
    }
    if (next.size) this.groups.set(owner, next);
    else {
      this.groups.delete(owner);
      this.frames.delete(owner);
      this.shown.delete(owner);
    }
    this.onChange?.();
  }
  /** Every owner's labels as it last set them: [{ owner, items }], in the order the sets were made. */
  items() {
    return [...this.groups].map(([owner, entries]) => ({ owner, items: [...entries.values()].map((e) => e.item) }));
  }
  /** Remove an owner's labels. */
  clear(owner) {
    if (this.groups.has(owner)) this.sync(owner, []);
  }
  /** Place every label; project(Vector3) → { x, y } port px, or null when it can't be seen. */
  update(projectWorld) {
    const placed = [];
    const m4 = new Matrix4();
    for (const [owner, entries] of this.groups) {
      const fm = this.frames.get(owner)?.() ?? null;
      if (fm) m4.fromArray(fm);
      const project = fm ? (v) => projectWorld(v3(v).applyMatrix4(m4)) : (v) => projectWorld(v3(v));
      const hidden = this.shown.get(owner)?.() === false;
      for (const entry of entries.values()) {
        let at = null;
        let leader = null;
        if (hidden) at = null;
        else if (entry.place) {
          // measured shown: a hidden element has no size
          entry.el.style.display = "";
          measure(entry);
          const p = entry.place({ project, w: entry.w || 0, h: entry.h || 0 });
          if (p) {
            at = { x: p.x, y: p.y };
            if (p.leader) leader = { x0: p.leader.x, y0: p.leader.y, x1: p.x, y1: p.y };
          }
        } else {
          const w = entry.follow ? entry.follow() : entry.world;
          at = entry.screen ?? (w ? project(w) : null);
        }
        if (!at) {
          entry.el.style.display = "none";
          if (entry.leader) entry.leader.style.display = "none";
          entry.p = null;
          continue;
        }
        entry.el.style.display = "";
        this.drawLeader(entry, leader);
        entry.el.style.transform = `translate(${Math.round(at.x)}px, ${Math.round(at.y)}px) translate(-50%, -50%)`;
        entry.p = at;
        placed.push(entry);
      }
    }
    declutter(placed);
  }
  drawLeader(entry, l) {
    if (!l) {
      if (entry.leader) entry.leader.style.display = "none";
      return;
    }
    if (!entry.leader) {
      entry.leader = document.createElement("div");
      entry.leader.className = "label-leader";
      this.el.prepend(entry.leader);
    }
    const len = Math.hypot(l.x1 - l.x0, l.y1 - l.y0);
    const ang = Math.atan2(l.y1 - l.y0, l.x1 - l.x0);
    entry.leader.style.display = "";
    entry.leader.style.width = `${len.toFixed(1)}px`;
    entry.leader.style.transform = `translate(${l.x0.toFixed(1)}px, ${l.y0.toFixed(1)}px) rotate(${ang.toFixed(4)}rad)`;
  }
  dispose() {
    this.el.remove();
    this.groups.clear();
  }
}
