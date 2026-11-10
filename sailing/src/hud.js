// What you see over the view while sailing (DESIGN.md, "Play"): a crosshair
// while aboard, a small sailing panel and one hint line saying what the keys
// do here. Before you come aboard, the way in, and the panel shrinks to its
// dial in the top left (the bottom of the view is a seated player's hand of
// cards); seated at something aboard (the view rides it), the way in is a
// small button up there too, with no walking keys (they're the game's). The panel's dial is the boat
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
import { seatedView } from "./crew.js";
import { trimOf } from "./trim.js";

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
 * Luffing: the sail up but her bow near the wind (apparent wind within 40°
 * of it) and hardly moving, not yet going astern: the moment to bear away,
 * before she's in irons. Anchored, she's meant to lie so.
 */
export const luffing = (read, sail, anchor) =>
  !!read?.apparentWind && anchor?.down !== true && Math.abs(Number(read.speed)) < 0.5 && Number(read.speed) >= -0.15 && Math.abs(read.apparentWind.angle) < (40 * Math.PI) / 180 && (Number(sail?.raised ?? 1) || 0) > 0.5;

const LUFFING = "Head to wind: bear away (A / D at the helm) until the sail fills";
// on a ship whose physics flies her main and jib apart (a rig contract's): stopped head to wind
// her rudder hardly bites, and backing the jib turns her in seconds (DESIGN.md, "Leaving the
// anchor"): B at the helm (B unrolls it if it's furled); it backs to windward, and dead ahead,
// where either side backs it, the wheel picks the side; B's hint names the way her bow will go
const IRONS_JIB = "In irons: back the jib (B at the helm; dead ahead, the wheel picks the way)";
const LUFFING_JIB = "Head to wind: back the jib (B at the helm; dead ahead, the wheel picks the way)";

const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

/**
 * One line naming where her stations are and what each works, for someone
 * walking her deck: "Wheel: steer, sheet, hoist · Mainsheet (cockpit): sheet,
 * hoist · Mast: hoist · Windlass: anchor". From ctx.sim.stationsOf (ids, or
 * anything truthy where she has one). Pure; "" when she has none.
 */
export function stationGuide(st) {
  if (!st) return "";
  const out = [];
  if (st.helm) out.push(st.sail ? "Wheel: steer, sheet, hoist" : "Wheel: steer");
  if (st.mainsheet && st.sail) out.push("Mainsheet (cockpit): sheet, hoist");
  if (st.sail) out.push(!st.helm && !st.mainsheet ? "Mast: hoist, sheet" : "Mast: hoist");
  if (st.winches?.length && st.jib) out.push("Winches: jib sheet, furl");
  if (st.anchor) out.push("Windlass: anchor");
  return out.join(" · ");
}

/**
 * With her sail down and her anchor up: where to raise it, from her
 * stations. At the wheel and the mainsheet you take the station first (F)
 * and then hold R: the quick hold R is only on the mast and the sail
 * (stations.js). Pure; "" otherwise.
 */
export function sailDownNudge(st, sail, anchor, jib = null) {
  if (st?.anchor && anchor?.down !== false) return "";
  // the jib rolled away, with winches to unroll it at
  const furled = !!st?.jib && st.winches?.length > 0 && !!jib && (Number(jib.furl) || 0) > 0.5 ? "jib furled: hold R at a winch" : "";
  if (!st?.sail || !sail || (Number(sail.raised ?? 1) || 0) > 0.5) return furled ? furled[0].toUpperCase() + furled.slice(1) : "";
  const posts = [st.helm && "the helm", st.mainsheet && "the mainsheet"].filter(Boolean);
  const main = !posts.length ? "Sail down: hold R at the mast to raise it" : `Sail down: take ${list(posts)} (F) and hold R, or hold R at the mast`;
  return furled ? `${main} · ${furled}` : main;
}

const ROW_TRIM = {};

/** A main hoisted this far or more reads as hoisted: a halyard stopping short of the block isn't a reef. */
export const HOISTED = 0.95;

/**
 * One sail's row, from its trim (trim.js) and its station's values: the
 * state word (`state`, which the row's data-trim colours) and the rest. No
 * angles: the word says which side of the working band the sail is
 * ("luffing", "soft" under-trimmed, "drawing", "stalled" over-trimmed),
 * and a stalled sail its sheet can't ease further reads "eased out ·
 * stalled" in the neutral colour (state "eased"): only the course can help.
 * The main: "drawing · sheet 40%", "soft · sheet 60%", "reefed 30% ·
 * drawing", "down". The jib: "drawing · sheet 30%", "backed · port",
 * "unrolling · backed port" (rolling out while held), "wing · sheet 50%",
 * "furled 40% · luffing", "furled"; no sheet without a Jib piece (`v`
 * null: it's trimmed with the main). Pure.
 * @param {object} s  the sail, as read().sails gives it
 * @param {{ alpha0, stall, width, wingFrom }} k  its thresholds (trim.js trimModelOf)
 * @param {{ raised?, sheet?, held?, furl? } | null} v  its station's values: the sail station's for the main, the jib's for the jib (null: no Jib piece)
 * @returns {{ state: string, text: string }}
 */
export function sailRow(s, k, v = {}) {
  const t = trimOf(s, k, ROW_TRIM);
  const piece = v != null;
  v = v ?? {};
  const pct = (x, d) => `${Math.round((Number.isFinite(Number(x)) ? Number(x) : d) * 100)}%`;
  const state = t.atStop ? "eased" : t.state;
  const word = t.atStop ? "eased out · stalled" : t.state;
  const sheet = `sheet ${pct(v.sheet, 0.5)}`;
  if (s.main) {
    const raised = Number.isFinite(Number(v.raised)) ? Number(v.raised) : 1;
    if (t.state === "down" || raised <= 0) return { state: "down", text: "down" };
    if (raised < HOISTED) return { state, text: `reefed ${pct(1 - raised, 0)} · ${word}` };
    return { state, text: `${word} · ${sheet}` };
  }
  const furl = Number(v.furl) || 0;
  if (t.state === "down" || furl >= 1) return { state: "down", text: "furled" };
  const held = v.held === "port" || v.held === "starboard" ? v.held : null;
  // made fast on a side and rolling out: what the crew chose, whatever the clew is doing on its way there
  if (held && furl > 0) return { state: "backed", text: `unrolling · backed ${held}` };
  const side = held ?? ((Number(s.angle) || 0) < 0 ? "port" : "starboard");
  const rest = t.state === "backed" ? side : piece ? sheet : "";
  if (furl > 0) return { state, text: `furled ${pct(furl, 0)} · ${word}` };
  return { state, text: rest ? `${word} · ${rest}` : word };
}

/**
 * What the HUD shows, from what it reads. Pure.
 * On a ship whose physics flies her sails apart (read.sails: a rig
 * contract's), the panel's "Sail" row is a row per sail, `main` and `jib`
 * (sailRow; `models` their thresholds by sail id, `jib` the jib's values),
 * and the advice head to wind is the jib's.
 * @param {{ me: object, read?: object | null, speed?: number | null, wind?: number[] | null, sail?: { raised?, sheet? } | null, jib?: { sheet?, held?, furl? } | null, models?: object | null, anchor?: { down? } | null, stations?: object | null, seated?: boolean }} o
 *   me: ctx.crew.me(); read: ctx.sim.read(ship); speed: her speed to show (m/s), else speedOver(read);
 *   wind: the true wind at the ship [vx, vz]; stations: ctx.sim.stationsOf(ship), for
 *   the line saying where they are (`guide`, walking her deck) and where to raise a
 *   lowered sail (`advice`, under way); seated: the view rides something
 *   (a seat at a table aboard her: crew.js seatedView), where the keys mean
 *   that thing's verbs, so the walking keys aren't offered and a click on the
 *   view doesn't come aboard (Enter or the button does)
 */
export function hudModel({ me, read = null, speed = null, wind = null, sail = null, jib = null, models = null, anchor = null, stations = null, seated = false }) {
  const state = !me?.playing ? "lobby" : me.paused ? "paused" : "aboard";
  const pct = (v, d) => `${Math.round((Number.isFinite(Number(v)) ? Number(v) : d) * 100)}%`;
  const c = read ? compass(read.heading) : null;
  let hint;
  let keys = "";
  if (state === "lobby" && seated) hint = "Come aboard (Enter)";
  else if (state === "lobby") (hint = "Click to come aboard"), (keys = WALK_KEYS);
  else if (state === "paused") hint = "Click to carry on";
  else if (me.hint) hint = me.hint;
  else if (me.swimming) hint = "WASD swim · F at the ladder to climb aboard";
  else hint = me.free ? `Drag to look · ${WALK_KEYS}` : WALK_KEYS;
  const kn = read ? knots(speed ?? speedOver(read)) : 0;
  const from = wind ? windFrom(wind) : null;
  // a row per sail where her physics flies them apart
  const sails = Array.isArray(read?.sails) ? read.sails : null;
  const rowOf = (pick, v) => {
    const s = sails?.find(pick);
    return s && models?.[s.id] ? sailRow(s, models[s.id], v) : null;
  };
  const main = rowOf((x) => x.main, sail ?? {});
  const jibRow = rowOf((x) => !x.main, jib ?? null);
  // the jib's advice only where B at the helm has a jib to back: a Jib piece, and her physics flying a headsail
  const backs = !!stations?.jib && !!sails?.some((x) => !x.main);
  return {
    state,
    seated: state === "lobby" && !!seated,
    hint,
    keys,
    advice: state !== "aboard" ? "" : inIrons(read, sail) ? (backs ? IRONS_JIB : IRONS) : luffing(read, sail, anchor) ? (backs ? LUFFING_JIB : LUFFING) : sailDownNudge(stations, sail, anchor, jib),
    // walking her deck (not at a station, not in the water): where her stations are
    guide: state === "aboard" && !me.station && !me.swimming ? stationGuide(stations) : "",
    panel: !!read,
    speed: read ? (kn < -0.05 ? `astern ${(-kn).toFixed(1)} kn` : `${Math.abs(kn).toFixed(1)} kn`) : "",
    heading: c ? `${String(c.deg).padStart(3, "0")}° ${c.point}` : "",
    wind: wind ? `${Math.round(knots(Math.hypot(wind[0], wind[1])))} kn ${compass(from).point}` : "",
    sail: sail && !main ? `${pct(sail.raised, 1)} · sheet ${pct(sail.sheet, 0.5)}` : "",
    main: main?.text ?? "",
    mainTrim: main?.state ?? "",
    jib: jibRow?.text ?? "",
    jibTrim: jibRow?.state ?? "",
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
  for (const [k, label] of [["speed", "Speed"], ["heading", "Heading"], ["wind", "True wind"], ["sail", "Sail"], ["main", "Main"], ["jib", "Jib"], ["anchor", "Anchor"]]) {
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
  const guide = el("div", { "data-k": "guide" });
  const hints = el("div", { class: "sail-hint" }, button, hint, keys, guide, advice);
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
      jib: st?.jib ? ctx.sim.value(st.jib) : null,
      models: ship ? (ctx.sim.sailModels?.(ship) ?? null) : null,
      anchor: st?.anchor ? ctx.sim.value(st.anchor) : null,
      stations: st,
      seated: seatedView(api),
    });
    put("state", model.state, (v) => root.setAttribute("data-state", v));
    put("seated", model.seated, (v) => root.toggleAttribute("data-seated", v));
    // before coming aboard the hint is a button (a click on the view does the same)
    const lobby = model.state === "lobby";
    put("lobby", lobby, (v) => ((button.hidden = !v), (hint.hidden = v)));
    put("hint", model.hint, (v) => ((lobby ? button : hint).textContent = v));
    put("keys", model.keys, text(keys));
    put("advice", model.advice, text(advice));
    put("guide", model.guide, (v) => ((guide.textContent = v), (guide.hidden = !v)));
    put("panel", model.panel, (v) => (panel.hidden = !v));
    for (const k of ["speed", "heading", "wind", "sail", "main", "jib", "anchor"]) {
      put(k, model[k], (v) => {
        rows[k].dd.textContent = v;
        rows[k].dt.hidden = rows[k].dd.hidden = !v;
      });
    }
    // each sail's row coloured by its state (hud.css)
    for (const k of ["main", "jib"]) put(`${k}Trim`, model[`${k}Trim`], (v) => (v ? rows[k].dd.setAttribute("data-trim", v) : rows[k].dd.removeAttribute("data-trim")));
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
