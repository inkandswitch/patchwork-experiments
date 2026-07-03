// The LLM MAGNIFYING GLASS — place it on the board and press "look": it reads the items its
// own bounds cover (via the canvas `board` context source), summarises them, and asks the
// LLM for a one-line description of what's under the glass. The description is also exposed
// on a `description` outlet (wire it onward). Powered by @chee/patchwork-llm.
//
// (The board-snapshot helper is pure + tested; this mount just wires it to the LLM. It
// imports the external LLM lib, so the MOUNT isn't unit-tested — the helper carries the logic.)
import { Source, stringSchema } from "./opstreams.js";
import { generate } from "@chee/patchwork-llm";
import { itemsUnder, describeItems } from "./board-snapshot.js";
import { itemBounds } from "./model.js";

// A radial LENS displacement map → an SVG filter used as a `backdrop-filter`, so the glass
// geometrically BULGES the live canvas behind it (the "liquid glass" technique). Generated
// once: each pixel's R/G encode a radial displacement that grows toward the rim and points
// INWARD (pulls the rim's content toward the centre ⇒ a convex magnifier bulge). Chromium
// applies `backdrop-filter: url()`; elsewhere it's a no-op and you still get a glass circle.
function ensureLensFilter() {
  const ID = "ns-lens";
  if (typeof document === "undefined" || document.getElementById("ns-lens-svg")) return ID;
  const N = 128, cv = document.createElement("canvas"); cv.width = cv.height = N;
  const g = cv.getContext("2d"); if (!g) return ID;
  const img = g.createImageData(N, N), c = (N - 1) / 2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x - c) / c, dy = (y - c) / c, r = Math.hypot(dx, dy);
    const disp = r < 1 ? Math.pow(r, 1.6) : 0;        // 0 at centre → max at the rim
    const ux = r > 1e-4 ? dx / r : 0, uy = r > 1e-4 ? dy / r : 0;
    const i = (y * N + x) * 4;
    img.data[i] = 128 - ux * disp * 127;              // R: sample INWARD ⇒ magnify
    img.data[i + 1] = 128 - uy * disp * 127;          // G
    img.data[i + 2] = 128; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const url = cv.toDataURL();
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.id = "ns-lens-svg"; svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;width:0;height:0";
  svg.innerHTML = `<filter id="${ID}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feImage href="${url}" preserveAspectRatio="none" x="0" y="0" width="100%" height="100%" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="34" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  document.body.appendChild(svg);
  return ID;
}

export function mountLLMMagnifier({ element, api, setOutlet }) {
  const out = new Source("");
  if (setOutlet) setOutlet("description", out);
  ensureLensFilter();

  // a transparent GLASS LENS: the body bulges the backdrop (CSS), a small button asks the
  // LLM, and a caption shows the answer over a scrim. (Round/glass chrome via CSS on .ns-glass.)
  const root = document.createElement("div"); root.className = "ns-magnifier";
  const btn = document.createElement("button"); btn.className = "ns-magnify-btn"; btn.textContent = "🔍"; btn.title = "describe what's under the glass";
  btn.addEventListener("pointerdown", (e) => e.stopPropagation()); // clicking the trigger shouldn't grab/move the glass
  const body = document.createElement("div"); body.className = "ns-magnify-cap"; body.textContent = "";
  root.append(btn, body); element.append(root);

  // THIS node's id (from the canvas wrapper) → its live item → its bounds (the glass region)
  const selfId = () => { const el = element.closest && element.closest("[data-item-id]"); return el && el.getAttribute("data-item-id"); };
  const board = () => (api && api.context && api.context.board && api.context.board.value) || [];
  const snapshot = () => {
    const id = selfId(); if (!id) return null;
    const me = board().find((x) => x.id === id); if (!me) return null;
    const under = itemsUnder(board(), itemBounds(me), itemBounds, id);
    return { under, desc: describeItems(under) };
  };

  let busy = false;
  const look = async () => {
    if (busy) return;
    const snap = snapshot();
    if (!snap) { body.textContent = "(place me on the board)"; return; }
    if (!snap.under.length) { body.textContent = "nothing under the glass"; out.push(""); return; }
    busy = true; body.textContent = "…";
    try {
      const sys = "You are a magnifying glass hovering over an infinite sketch canvas. In ONE short, vivid sentence, describe what is under the glass for a passer-by. No preamble.";
      const { text } = await generate([
        { role: "system", content: sys },
        { role: "user", content: `Under the glass: ${snap.desc}.` },
      ]);
      const t = (text || "").trim();
      body.textContent = t || snap.desc; out.push(t || snap.desc);
    } catch (e) { body.textContent = "⚠ " + ((e && e.message) || "LLM failed"); }
    busy = false;
  };
  btn.onclick = look;

  return () => { root.remove(); };
}

export const plugin = {
  type: "sketchy:surface",
  id: "llm-magnifier",
  name: "Magnifying glass",
  icon: "Search",
  round: true,  // an ellipse outline, not a rectangle
  glass: true,  // transparent glass chrome (no title/body fill) + the backdrop bulge
  inlets: [],
  outlets: [{ name: "description", type: "text", schema: stringSchema() }],
  async load() { return mountLLMMagnifier; },
};
