// What you see over the view while sailing (DESIGN.md, "Play"): a crosshair
// while aboard, a small sailing panel and one hint line saying what the keys
// do here. Before you come aboard, the way in. The panel's dial is the boat
// bow-up with north on its rim, the apparent wind as a solid arrow (what the
// sail feels) and the true wind as a hollow mark on the rim (where the
// weather comes from); beside it her speed over the ground along her bow,
// steadied over a second or two (the waves' own surge isn't hers), her
// heading, the true wind's speed and direction, the sail and the anchor.
// It only reads: ctx.crew.me(), ctx.sim.read(), the stations' values and the
// wind. The model is pure (hudModel); the DOM is touched only when a value
// changes.

import css from "./hud.css?inline";
import { bodyOf } from "./body.js";

const KNOTS = 1.943844; // per m/s
const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const WALK_KEYS = "WASD walk · Shift run · Space jump · F use · Esc leave";

/** m/s in knots, to a tenth. */
export const knots = (ms) => Math.round((Number(ms) || 0) * KNOTS * 10) / 10;

/** A heading (radians, 0 = north, toward east) as whole degrees 0..359 and its point of the compass. */
export function compass(rad) {
  const deg = ((Math.round(((Number(rad) || 0) * 180) / Math.PI) % 360) + 360) % 360;
  return { deg, point: POINTS[Math.round(deg / 45) % 8] };
}

/** Radians to degrees, for an SVG rotate(), to a tenth. */
const deg = (rad) => Math.round(((Number(rad) || 0) * 1800) / Math.PI) / 10;

/** The bearing (radians, 0 north toward east) the wind [vx, vz] blows from. */
export const windFrom = (w) => Math.atan2(-w[0], w[1]);

/**
 * A ship's speed over the ground along her bow (m/s, − astern), from what
 * she reads (her world velocity and heading); else her speed through the
 * water.
 */
export function speedOver(read) {
  const v = read?.velocity;
  if (!Array.isArray(v) || !Number.isFinite(read.heading)) return Number(read?.speed) || 0;
  return v[0] * Math.sin(read.heading) - v[2] * Math.cos(read.heading);
}

/** In irons: head to wind with the sail up, going astern. */
export const inIrons = (read, sail) =>
  !!read?.apparentWind && Number(read.speed) < -0.15 && Math.abs(read.apparentWind.angle) < (35 * Math.PI) / 180 && (Number(sail?.raised ?? 1) || 0) > 0.5;

const IRONS = "In irons, going astern: lower the sail and let her fall off, then raise it";

/**
 * What the HUD shows, from what it reads. Pure.
 * @param {{ me: object, read?: object | null, speed?: number | null, wind?: number[] | null, sail?: { raised?, sheet? } | null, anchor?: { down? } | null }} o
 *   me: ctx.crew.me(); read: ctx.sim.read(ship); speed: her speed to show (m/s), else speedOver(read);
 *   wind: the true wind at the ship [vx, vz]
 */
export function hudModel({ me, read = null, speed = null, wind = null, sail = null, anchor = null }) {
  const state = !me?.playing ? "lobby" : me.paused ? "paused" : "aboard";
  const pct = (v, d) => `${Math.round((Number.isFinite(Number(v)) ? Number(v) : d) * 100)}%`;
  const c = read ? compass(read.heading) : null;
  let hint;
  let keys = "";
  if (state === "lobby") (hint = "Click to come aboard"), (keys = WALK_KEYS);
  else if (state === "paused") hint = "Click to carry on";
  else if (me.hint) hint = me.hint;
  else if (me.swimming) hint = "WASD swim · F at the ladder to climb aboard";
  else hint = me.free ? `Drag to look · ${WALK_KEYS}` : WALK_KEYS;
  const kn = read ? knots(speed ?? speedOver(read)) : 0;
  const from = wind ? windFrom(wind) : null;
  return {
    state,
    hint,
    keys,
    advice: state === "aboard" && inIrons(read, sail) ? IRONS : "",
    panel: !!read,
    speed: read ? (kn < -0.05 ? `astern ${(-kn).toFixed(1)} kn` : `${Math.abs(kn).toFixed(1)} kn`) : "",
    heading: c ? `${String(c.deg).padStart(3, "0")}° ${c.point}` : "",
    wind: wind ? `${Math.round(knots(Math.hypot(wind[0], wind[1])))} kn ${compass(from).point}` : "",
    sail: sail ? `${pct(sail.raised, 1)} · sheet ${pct(sail.sheet, 0.5)}` : "",
    anchor: anchor ? (anchor.down === false ? "Up" : "Down") : "",
    // the dial: the apparent wind's arrow round the boat (+ from starboard, so clockwise), north round the rim
    windAngle: read?.apparentWind ? deg(read.apparentWind.angle) : null,
    // the true wind's mark on the rim: where it comes from, relative to the bow
    trueAngle: read && from != null ? deg(from - read.heading) : null,
    north: read ? deg(-read.heading) : 0,
  };
}

const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  e.append(...kids);
  return e;
};

/**
 * @param {object} api
 * @param {{ sea, sim, crew }} ctx
 */
export function createHud(api, ctx) {
  api.style(css);
  const overlay = api.overlay();
  const root = el("div", { class: "sail-hud", "data-state": "lobby" });

  // the dial: a ring, north on it, the boat bow-up, the wind's arrow pointing in from the rim
  const north = svg("text", { "data-part": "north", x: 0, y: -37 });
  north.textContent = "N";
  const northG = svg("g");
  northG.append(north);
  const arrow = svg("path", { "data-part": "wind", d: "M0,-46 L0,-27 M-6,-33 L0,-26 L6,-33" });
  const windG = svg("g");
  windG.append(arrow);
  const trueG = svg("g");
  trueG.append(svg("path", { "data-part": "true", d: "M0,-38 L-5.5,-48 L5.5,-48 Z" }));
  const dial = svg("svg", { class: "sail-dial", viewBox: "-50 -50 100 100", "aria-hidden": "true" });
  dial.append(
    svg("circle", { "data-part": "ring", r: 44 }),
    northG,
    svg("path", { "data-part": "boat", d: "M0,-22 C7,-12 8,2 6,20 L-6,20 C-8,2 -7,-12 0,-22 Z" }),
    trueG,
    windG,
  );

  const rows = {};
  const read = el("dl", { class: "sail-read" });
  for (const [k, label] of [["speed", "Speed"], ["heading", "Heading"], ["wind", "True wind"], ["sail", "Sail"], ["anchor", "Anchor"]]) {
    const dt = el("dt", {}, label);
    const dd = el("dd", { "data-k": k });
    rows[k] = { dt, dd };
    read.append(dt, dd);
  }
  const panel = el("section", { class: "sail-panel", "aria-label": "Sailing" }, dial, read);
  panel.hidden = true;

  const button = el("button", { type: "button" });
  button.addEventListener("click", () => ctx.crew.start?.());
  const hint = el("div", { "data-k": "hint", role: "status" });
  const keys = el("div", { "data-k": "keys" });
  const advice = el("div", { "data-k": "advice" });
  const hints = el("div", { class: "sail-hint" }, button, hint, keys, advice);
  root.append(el("div", { class: "sail-crosshair" }), panel, hints);
  overlay.append(root);

  const shown = {};
  const put = (key, v, fn) => {
    if (shown[key] === v) return;
    shown[key] = v;
    fn(v);
  };
  const text = (node) => (v) => (node.textContent = v);

  // her speed, steadied: a wave's surge under her comes and goes in a few seconds
  const STEADY_S = 1.5;
  let steady = null; // { ship, v }
  function speedOf(ship, read, dt) {
    if (!read) return (steady = null);
    const raw = speedOver(read);
    if (steady?.ship !== ship) steady = { ship, v: raw };
    else steady.v += (raw - steady.v) * (1 - Math.exp(-dt / STEADY_S));
    return steady.v;
  }

  function render(dt = 0) {
    const me = ctx.crew?.me?.() ?? { playing: false };
    const ship = me.on ?? ctx.sim?.ships?.()[0] ?? null;
    const st = ship ? ctx.sim.stationsOf?.(ship) : null;
    let wind = null;
    const m = ship ? bodyOf(api, ship) : null;
    if (m && ctx.sea?.wind) wind = ctx.sea.wind.at(m[12], m[14], ctx.sea.clock?.() ?? 0);
    const read = ship ? ctx.sim.read(ship) : null;
    const model = hudModel({
      me,
      read,
      speed: speedOf(ship, read, dt),
      wind,
      sail: st?.sail ? ctx.sim.value(st.sail) : null,
      anchor: st?.anchor ? ctx.sim.value(st.anchor) : null,
    });
    put("state", model.state, (v) => root.setAttribute("data-state", v));
    // before coming aboard the hint is a button (a click on the view does the same)
    const lobby = model.state === "lobby";
    put("lobby", lobby, (v) => ((button.hidden = !v), (hint.hidden = v)));
    put("hint", model.hint, (v) => ((lobby ? button : hint).textContent = v));
    put("keys", model.keys, text(keys));
    put("advice", model.advice, text(advice));
    put("panel", model.panel, (v) => (panel.hidden = !v));
    for (const k of ["speed", "heading", "wind", "sail", "anchor"]) {
      put(k, model[k], (v) => {
        rows[k].dd.textContent = v;
        rows[k].dt.hidden = rows[k].dd.hidden = !v;
      });
    }
    for (const [k, g] of [["windAngle", windG], ["trueAngle", trueG]]) {
      put(k, model[k], (v) => {
        g.style.display = v == null ? "none" : "";
        if (v != null) g.setAttribute("transform", `rotate(${v})`);
      });
    }
    // the N goes round the rim and stays upright
    put("north", model.north, (v) => (northG.setAttribute("transform", `rotate(${v})`), north.setAttribute("transform", `rotate(${-v} 0 -37)`)));
  }

  let since = 0;
  render();

  return {
    /** One frame: the numbers ten times a second is plenty. */
    tick(dt) {
      since += dt;
      if (since < 0.1) return;
      render(since);
      since = 0;
    },
    update: () => render(),
    dispose() {
      root.remove();
    },
  };
}
