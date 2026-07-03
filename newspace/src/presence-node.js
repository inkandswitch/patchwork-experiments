// PRESENCE as a BARE layer tool — the bar/controls half of presence, now a
// placeable window (the peer CURSOR/VIEW rendering stays canvas-level in
// brush/ui/presence.jsx — it draws in world space and belongs to the canvas).
// Seeded as `ns-presence`: overlay HOME with a canvas membership (ambient —
// presence matters while drawing), sticky bottom-right, dismissable like any seed.
// RAW callbacks + plain DOM — an opstream-processing node needs no Solid.
//
// It shows who's here (avatar chips) plus a USER (person) button opening a small
// flyout: a "show everyone's views" toggle and a follow button per peer. State
// travels over plain Sources on the canvas context — `peers` (also an auto-wired
// inlet), `showViews` (boolean, writable) and `following` (contactUrl|null,
// writable) — so the node subscribes with raw connects and writes with apply().
import { snapshot } from "./ops.js";
import { openPopover } from "./popover.js";

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// the person silhouette (sticker style: hand-drawn single stroke, like TOOL_META)
export const USER_ICON_PATH = "M11 3.5a3.4 3.4 0 010 6.8 3.4 3.4 0 010-6.8z M4.5 18.5c1-4.5 3.6-6.4 6.5-6.4s5.5 1.9 6.5 6.4";

function userIcon() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 22 22");
  svg.setAttribute("width", "16"); svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", USER_ICON_PATH);
  svg.append(p);
  return svg;
}

// write a peer entry INTO a face chip (initial, colour ring, avatar when
// resolvable) — update-in-place so a chip keeps its DOM identity across the
// up-to-~60/s peers emissions (a replaced button between pointerdown and click
// never receives the click).
function updateFace(f, p, serviceUrl) {
  f.textContent = (p.name || "?")[0].toUpperCase();
  f.style.setProperty("--c", p.color || "#888");
  const img = p.avatarUrl && typeof serviceUrl === "function" ? serviceUrl(p.avatarUrl) : null;
  f.style.backgroundImage = img ? `url("${img}")` : "";
  f.style.color = img ? "transparent" : "";
}
function faceEl(p, serviceUrl) { const f = el("span", "ns-pface"); updateFace(f, p, serviceUrl); return f; }

export function mountPresence({ element, inlets = {}, context }) {
  // peers: the wired inlet wins (it auto-wires to the canvas's ambient `peers`
  // outlet — the bare-tool convention), falling back to the context Source.
  const peersStream = () => { const p = inlets.peers; if (p && p.wired) return p; return (context && context.peers) || p; };
  const viewsStream = () => (context && context.showViews) || null;
  const followStream = () => (context && context.following) || null;
  const serviceUrl = context && context.serviceUrl;

  const peers = () => { const v = peersStream()?.value; return Array.isArray(v) ? v.filter(Boolean) : []; };
  const viewsOn = () => !!viewsStream()?.value;
  const followingUrl = () => followStream()?.value || null;
  const setViews = (on) => { const s = viewsStream(); if (s && typeof s.apply === "function") s.apply(snapshot(!!on)); };
  const follow = (url) => { const s = followStream(); if (s && typeof s.apply === "function") s.apply(snapshot(followingUrl() === url ? null : url)); };

  let open = false;
  const root = el("div", "ns-presence-bar");
  root.addEventListener("pointerdown", (e) => e.stopPropagation()); // pointerDOWN only (the house rule)
  const faces = el("span", "ns-presence-faces");
  const btn = el("button", "ns-presence-btn");
  btn.append(userIcon());
  btn.title = "People here — everyone's views & following";
  btn.addEventListener("click", () => { open = !open; render(); });
  root.append(faces, btn);
  element.append(root);

  // RECONCILED chrome, keyed by peer id. Peers emit up to ~60/s while someone
  // moves; a full DOM rebuild per emission replaced buttons between pointerdown
  // and click (dead buttons) and dismissed/reopened the flyout (flicker). Chips
  // and open-flyout rows are created ONCE per peer and updated in place.
  const chips = new Map(); // contactUrl -> { chip, face }
  let chipOrder = "";
  const syncFaces = (list) => {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.contactUrl);
      let c = chips.get(p.contactUrl);
      if (!c) {
        c = { chip: el("button", "ns-pface-btn"), face: faceEl(p, serviceUrl) };
        c.chip.append(c.face);
        c.chip.addEventListener("click", () => follow(p.contactUrl));
        chips.set(p.contactUrl, c);
      }
      updateFace(c.face, p, serviceUrl);
      c.chip.classList.toggle("following", followingUrl() === p.contactUrl);
      c.chip.title = followingUrl() === p.contactUrl ? `Stop following ${p.name || "them"}` : `${p.name || "someone"} — click to follow`;
    }
    for (const [url, c] of chips) if (!seen.has(url)) { c.chip.remove(); chips.delete(url); }
    // (re)append in list order only when the order actually changed — a move keeps
    // node identity, and the common no-op path touches nothing at all
    const order = list.map((p) => p.contactUrl).join("|");
    if (order !== chipOrder) { chipOrder = order; for (const p of list) { const c = chips.get(p.contactUrl); if (c) faces.append(c.chip); } }
  };

  // the flyout — PORTAL'd to the canvas root (popover.js): the bare window's
  // body clips (overflow: hidden), so an in-widget menu was invisible. The
  // popover opens away from whichever edge the bar is docked to. Built ONCE per
  // open; its views toggle + per-peer rows update in place per emission.
  let closeMenu = null; // the portal'd flyout's close fn (popover.js)
  let menuEl = null, viewsBtn = null, viewsTick = null, sepEl = null;
  const rows = new Map(); // contactUrl -> { row, face, name, flag }
  const dismissMenu = () => { if (closeMenu) { const c = closeMenu; closeMenu = null; menuEl = null; rows.clear(); c(); } };
  const buildMenu = () => {
    menuEl = el("div", "ns-menu ns-presence-menu");
    menuEl.addEventListener("wheel", (e) => e.stopPropagation());
    viewsBtn = el("button", "ns-presence-item");
    viewsBtn.title = "Overlay other people's views on the canvas";
    viewsTick = el("span", "ns-presence-tick");
    viewsBtn.append(viewsTick, el("span", null, "show everyone's views"));
    viewsBtn.addEventListener("click", () => { setViews(!viewsOn()); render(); });
    sepEl = el("div", "ns-menu-sep");
    menuEl.append(viewsBtn, sepEl);
    closeMenu = openPopover({ anchor: btn, menu: menuEl, onClose: () => { closeMenu = null; menuEl = null; rows.clear(); open = false; render(); } });
  };
  const syncMenu = (list) => {
    viewsBtn.classList.toggle("active", viewsOn());
    viewsTick.textContent = viewsOn() ? "▣" : "▢";
    sepEl.textContent = list.length ? "people" : "just you here";
    const seen = new Set();
    for (const p of list) {
      seen.add(p.contactUrl);
      let r = rows.get(p.contactUrl);
      if (!r) {
        r = { row: el("button", "ns-presence-item"), face: faceEl(p, serviceUrl), name: el("span", "ns-presence-name"), flag: el("span", "ns-presence-follow") };
        r.row.append(r.face, r.name, r.flag);
        r.row.addEventListener("click", () => { follow(p.contactUrl); render(); });
        menuEl.append(r.row);
        rows.set(p.contactUrl, r);
      }
      const on = followingUrl() === p.contactUrl;
      updateFace(r.face, p, serviceUrl);
      r.name.textContent = p.name || "someone";
      r.flag.textContent = on ? "following" : "follow";
      r.row.classList.toggle("active", on);
      r.row.title = on ? `Stop following ${p.name || "them"}` : `Follow ${p.name || "them"} — your camera tracks theirs`;
    }
    for (const [url, r] of rows) if (!seen.has(url)) { r.row.remove(); rows.delete(url); }
  };

  const render = () => {
    const list = peers();
    btn.classList.toggle("active", open || viewsOn() || !!followingUrl());
    syncFaces(list);
    if (!open) { dismissMenu(); return; }
    if (!closeMenu) buildMenu();
    syncMenu(list);
  };

  // raw connects: re-render on peers / showViews / following changes (the inlet
  // proxy swaps backing internally, so one connect covers rewires)
  const offs = [];
  const sub = (s) => { if (s && typeof s.connect === "function") offs.push(s.connect(() => render())); };
  sub(inlets.peers);
  if (context && context.peers && context.peers !== inlets.peers) sub(context.peers);
  sub(viewsStream());
  sub(followStream());

  render();
  return () => { for (const o of offs) { try { o(); } catch {} } dismissMenu(); root.remove(); };
}

export const plugin = {
  type: "sketchy:surface",
  id: "presence",
  name: "Presence",
  icon: "Users",
  bare: true, // a frameless widget: no node frame; chrome comes from the bare-chrome bar
  inlets: [{ name: "peers", type: "json" }], // auto-wires to the canvas's ambient peers outlet
  outlets: [],
  async load() { return mountPresence; },
};
