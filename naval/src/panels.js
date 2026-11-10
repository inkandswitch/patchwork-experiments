// The field groups (Hull, Rig, Sails, Loading) and the Numbers panel's markup.
// Field specs are data; tool.js turns them into inputs and writes through
// handle.change. Pure apart from building strings.

import { RIG_TYPES, RIG_TYPE_LABELS, HEADSAIL_KINDS, hasForetriangle, jOf } from "./naval/sailplan.js";
import { CREW_MODES, STEPPED, BALLAST_AT, isEstimated, getPath } from "./doc.js";
import { KEEL_KINDS, RUDDER_KINDS, KEEL_KIND_LABELS, RUDDER_KIND_LABELS } from "./naval/foils.js";
import { stabilityChart, polarChart, polarTable } from "./charts.js";
import { formatQuantity, formatText, KNOT } from "./naval/units.js";
import { BOW_AXES, UP_AXES } from "./naval/hull-frame.js";
import { HELM_BAND } from "./naval/vpp.js";

const P = (s) => s.split(".");
const sloopish = (doc) => hasForetriangle(doc.rig.type);
const linked = (doc) => !!doc.hull.link;
const unlinked = (doc) => !doc.hull.link;
const hasKeel = (doc) => doc.appendages.keel.kind !== "none";
const hasRudder = () => true;

/**
 * kind: "qty" a number with a dimension; "opt" a number that may be empty (null);
 * "select"; "J" (writes the mast position); "reefs" (a list of % of P);
 * "headsail" (kind or none); "link" (the linked hull: paste, drop, unlink);
 * "speeds" (a list of speeds, typed in knots or with units); "angles" (a list of degrees).
 */
export const FIELD_GROUPS = [
  {
    id: "hull",
    title: "Hull",
    note: "Link a hull (a camber hull, a GLB file, or any doc a scene can build; the hull itself, not a scene's render of it) to put the drawn hull under the rig, at its own size. With no link, the principal dimensions build a synthetic hull.",
    fields: [
      { key: "hull.link", label: "Linked hull", kind: "link" },
      { path: P("hull.link.frame.bow"), label: "Bow points along", kind: "select", options: BOW_AXES.map((a) => [a, `GLB ${a}`]), show: linked, hint: "the GLB axis the bow points along" },
      { path: P("hull.link.frame.up"), label: "Up is", kind: "select", options: UP_AXES.map((a) => [a, `GLB ${a}`]), show: linked, hint: "camber: bow +X, up +Y" },
      { path: P("hull.dims.loa"), label: "LOA", dim: "length", show: unlinked },
      { path: P("hull.dims.lwl"), label: "LWL", dim: "length", show: unlinked },
      { path: P("hull.dims.beam"), label: "Beam", dim: "length", show: unlinked },
      { path: P("hull.dims.bwl"), label: "BWL", dim: "length", hint: "beam at the waterline", show: unlinked },
      { path: P("hull.dims.tc"), label: "Tc", dim: "length", hint: "canoe-body draft, without the keel", show: unlinked },
      { path: P("hull.dims.draft"), label: "Draft", dim: "length", hint: "overall; used only with no keel (the keel's own sets it)", show: (d) => unlinked(d) && d.appendages.keel.kind === "none" },
      { path: P("hull.dims.freeboard"), label: "Freeboard", dim: "length", hint: "sheer above the DWL", show: unlinked },
      { path: P("hull.dims.displacementKg"), label: "Displacement", dim: "mass", show: unlinked },
      { path: P("hull.dims.cp"), label: "Cp", dim: "ratio", kind: "opt", hint: "prismatic; empty = estimated", show: unlinked },
      { path: P("hull.dims.cm"), label: "Cm", dim: "ratio", kind: "opt", hint: "midship section; empty = estimated", show: unlinked },
      { path: P("hull.dims.lcbFrac"), label: "LCB", dim: "percent", kind: "opt", hint: "% of LWL forward of mid-LWL (− aft); empty = estimated", show: unlinked },
      { path: P("hull.dims.deadriseDeg"), label: "Deadrise", dim: "angle", kind: "opt", hint: "the planing bottom's, aft; empty = from the hull's section" },
    ],
  },
  {
    id: "rig",
    title: "Rig",
    fields: [
      {
        path: P("rig.type"),
        label: "Type",
        kind: "select",
        options: RIG_TYPES.map((t) => [t, RIG_TYPE_LABELS[t]]),
      },
      { path: P("rig.mast.aftOfStem"), label: "Mast aft of stem", dim: "length", hint: "front of the mast at the sheer" },
      { key: "J", label: "J", kind: "J", dim: "length", hint: "forestay tack to mast; moves the mast", show: sloopish },
      { path: P("rig.forestayAftOfStem"), label: "Forestay tack aft of stem", dim: "length", hint: "negative for a bowsprit", show: sloopish },
      { path: P("rig.I"), label: "I", dim: "length", hint: "forestay height on the mast, above the sheer", show: sloopish },
      { path: P("rig.ISP"), label: "ISP", dim: "length", kind: "opt", hint: "spinnaker halyard; empty = mast top", show: sloopish },
      { path: P("rig.mast.rakeDeg"), label: "Rake", dim: "angle", hint: "+ = masthead aft" },
      { path: P("rig.mast.stepped"), label: "Stepped on", kind: "select", options: STEPPED.map((s) => [s, s === "deck" ? "Deck" : "Keel"]) },
      { path: P("rig.mast.kgPerM"), label: "Mast section", dim: "massPerLength", kind: "opt", hint: "kg/m; empty = estimated from its length" },
    ],
  },
  {
    id: "sails",
    title: "Sails",
    fields: [
      { path: P("rig.P"), label: "P", dim: "length", hint: "main luff, boom to head" },
      { path: P("rig.E"), label: "E", dim: "length", hint: "main foot along the boom" },
      { path: P("rig.BAS"), label: "BAS", dim: "length", hint: "boom above sheer" },
      { path: P("rig.main.roach"), label: "Roach", dim: "percent", hint: "of the main's triangle" },
      { path: P("rig.main.reefs"), label: "Reefs", kind: "reefs", hint: "% of P each reef takes down, e.g. 15, 30" },
      { key: "headsail", path: P("rig.headsail"), label: "Headsail", kind: "headsail", show: sloopish },
      { path: P("rig.headsail.LP"), label: "LP", dim: "length", hint: "clew to luff, perpendicular", show: (d) => sloopish(d) && !!d.rig.headsail },
      { path: P("rig.headsail.clewHeight"), label: "Clew height", dim: "length", kind: "opt", hint: "above the tack; empty = estimated", show: (d) => sloopish(d) && !!d.rig.headsail },
      { path: P("rig.staysail.I2"), label: "Staysail I2", dim: "length", show: (d) => d.rig.type === "cutter" },
      { path: P("rig.staysail.J2"), label: "Staysail J2", dim: "length", hint: "inner forestay tack forward of the mast", show: (d) => d.rig.type === "cutter" },
      { path: P("rig.staysail.LP2"), label: "Staysail LP2", dim: "length", show: (d) => d.rig.type === "cutter" },
    ],
  },
  {
    id: "keel",
    title: "Keel",
    note: 'Drag its corners on the drawing. The root hangs from the canoe body.',
    fields: [
      { path: P("appendages.keel.kind"), label: "Kind", kind: "select", options: KEEL_KINDS.map((k) => [k, KEEL_KIND_LABELS[k]]) },
      { path: P("appendages.keel.aftOfStem"), label: "Aft of stem", dim: "length", hint: "root leading edge", show: hasKeel },
      { path: P("appendages.keel.span"), label: "Span", dim: "length", hint: "root to tip", show: hasKeel },
      { path: P("appendages.keel.rootChord"), label: "Root chord", dim: "length", show: hasKeel },
      { path: P("appendages.keel.tipChord"), label: "Tip chord", dim: "length", show: hasKeel },
      { path: P("appendages.keel.sweepDeg"), label: "Sweep", dim: "angle", hint: "leading edge, + = tip aft", show: hasKeel },
      { path: P("appendages.keel.tc"), label: "Thickness", dim: "percent", hint: "t/c of the section", show: hasKeel },
      { path: P("appendages.keel.bulb.length"), label: "Bulb length", dim: "length", show: (d) => d.appendages.keel.kind === "fin-bulb" },
      { path: P("appendages.keel.bulb.diameter"), label: "Bulb diameter", dim: "length", show: (d) => d.appendages.keel.kind === "fin-bulb" },
    ],
  },
  {
    id: "rudder",
    title: "Rudder",
    note: 'Drag its corners on the drawing.',
    fields: [
      { path: P("appendages.rudder.kind"), label: "Kind", kind: "select", options: RUDDER_KINDS.map((k) => [k, RUDDER_KIND_LABELS[k]]) },
      { path: P("appendages.rudder.aftOfStem"), label: "Aft of stem", dim: "length", hint: "root leading edge", show: hasRudder },
      { path: P("appendages.rudder.span"), label: "Span", dim: "length", hint: "root to tip", show: hasRudder },
      { path: P("appendages.rudder.rootChord"), label: "Root chord", dim: "length", show: hasRudder },
      { path: P("appendages.rudder.tipChord"), label: "Tip chord", dim: "length", show: hasRudder },
      { path: P("appendages.rudder.sweepDeg"), label: "Sweep", dim: "angle", hint: "leading edge, + = tip aft", show: hasRudder },
      { path: P("appendages.rudder.tc"), label: "Thickness", dim: "percent", hint: "t/c of the section", show: hasRudder },
      { path: P("appendages.rudder.maxDeg"), label: "Helm limit", dim: "angle", hint: "the most rudder the steering gives" },
      { path: P("appendages.rudder.stockFrac"), label: "Stock at", dim: "percent", hint: "of the mean chord, aft of its leading edge" },
    ],
  },
  {
    id: "loading",
    title: "Loading",
    fields: [
      {
        path: P("loading.displacement.from"),
        label: "Float at",
        kind: "select",
        options: [
          ["hull", "Hull's own"],
          ["given", "Given"],
        ],
        hint: "a linked hull's own is what it displaces at its design waterline (z = 0)",
      },
      { path: P("loading.displacement.kg"), label: "Displacement", dim: "mass", kind: "opt", show: (d) => d.loading.displacement.from === "given" },
      { path: P("loading.ballast.kg"), label: "Ballast", dim: "mass" },
      { path: P("loading.ballast.at"), label: "Ballast in", kind: "select", options: BALLAST_AT.map((a) => [a, { bulb: "The bulb", keel: "The keel", hull: "The hull (inside)" }[a]]) },
      { path: P("loading.lightship.kg"), label: "Lightship", dim: "mass", kind: "opt", hint: "hull, deck, fit-out; empty = the remainder of the displacement" },
      { path: P("loading.lightship.vcg"), label: "Lightship VCG", dim: "length", kind: "opt", hint: "above the DWL; empty = the hull's mid-depth" },
      { path: P("loading.crew.count"), label: "Crew", dim: "ratio", integer: true },
      { path: P("loading.crew.kgEach"), label: "Each", dim: "mass" },
      {
        path: P("loading.crew.mode"),
        label: "Crew sits",
        kind: "select",
        options: CREW_MODES.map((m) => [m, { none: "Not counted", sitting: "Sitting in", rail: "On the rail", hiking: "Hiking", trapeze: "On trapeze" }[m]]),
      },
      { path: P("loading.crew.arm"), label: "Crew arm", dim: "length", kind: "opt", hint: "their centre to windward of the centreline; empty = by how they sit" },
    ],
  },
  {
    id: "conditions",
    title: "Wind",
    fields: [
      { path: P("conditions.aws"), label: "Apparent winds", kind: "speeds", hint: "for steady heel, e.g. 8, 12, 16, 20 kn" },
      { path: P("conditions.heelLimitDeg"), label: "Reef at", dim: "angle", hint: "the heel you'd reef at; the polar flattens and reefs to keep within it" },
      { path: P("conditions.tws"), label: "True winds", kind: "speeds", hint: "the polar's, e.g. 6, 8, 10, 12, 14, 16, 20 kn" },
      { path: P("conditions.twa"), label: "True wind angles", kind: "angles", hint: "the polar's rows, degrees off the bow" },
      { path: P("conditions.reference.tws"), label: "Reference wind", dim: "speed", hint: "true; where the helm is read" },
      { path: P("conditions.reference.twa"), label: "Reference angle", dim: "angle", hint: "true wind angle for the helm" },
    ],
  },
];

/** A field's current value as text in the display system. */
export function fieldText(doc, f, system) {
  if (f.kind === "link") return doc.hull.link?.url ?? "";
  if (f.kind === "J") return formatQuantity(jOf(doc.rig), "length", system);
  if (f.kind === "reefs") return (doc.rig.main.reefs ?? []).map((r) => `${+(r * 100).toFixed(1)}`).join(", ");
  if (f.kind === "speeds") return (getPath(doc, f.path) ?? []).map((v) => `${+(v / KNOT).toFixed(1)}`).join(", ") + " kn";
  if (f.kind === "angles") return (getPath(doc, f.path) ?? []).map((v) => `${+v.toFixed(1)}`).join(", ");
  if (f.kind === "headsail") return doc.rig.headsail ? doc.rig.headsail.kind : "none";
  const v = getPath(doc, f.path);
  if (f.kind === "select") return String(v);
  if (v == null) return "";
  if (f.integer) return String(v);
  return formatQuantity(v, f.dim, system);
}

export const fieldEstimated = (doc, f) => !!f.path && isEstimated(doc, f.path);

export const HEADSAIL_OPTIONS = [...HEADSAIL_KINDS.map((k) => [k, k === "self-tacking" ? "Self-tacking jib" : k[0].toUpperCase() + k.slice(1)]), ["none", "None"]];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const PROV_TEXT = {
  given: "given",
  estimated: "estimated",
  derived: "derived",
  "from-estimated": "from estimated",
  mesh: "from mesh",
  synthetic: "synthetic hull",
  table: "from statics table",
};
const PROV_TITLE = {
  mesh: "read off the linked hull's mesh",
  synthetic: "read off a synthetic hull built from the principal dimensions",
  table: "read off the hydrostatic table (Chartroom hydrostatic-table v1)",
};

/** A row's provenance chip. "from estimated" names its estimated inputs inline (no hover needed). */
function provChip(r) {
  const provTitle = [PROV_TITLE[r.prov], r.from?.length ? `from estimated: ${r.from.join(", ")}` : ""].filter(Boolean).join("; ") || PROV_TEXT[r.prov];
  if (r.prov === "from-estimated") {
    const names = r.from?.length ? (r.from.length <= 2 ? r.from.join(", ") : `${r.from.length} inputs`) : "inputs";
    return `<span class="prov" data-prov="from-estimated" title="${esc(provTitle)}">◦ est. ${esc(names)}</span>`;
  }
  return `<span class="prov" data-prov="${r.prov}" title="${esc(provTitle)}">${PROV_TEXT[r.prov]}</span>`;
}

/** One line naming every estimated input a section's rows depend on, or "". */
function estimatedLine(s) {
  const from = [...new Set(s.rows.filter((r) => r.prov === "from-estimated").flatMap((r) => r.from ?? []))];
  if (!from.length) return "";
  return `<p class="est-line">Rows marked ◦ depend on estimated ${esc(from.join(", "))}.</p>`;
}

/** The Numbers panel. Every row carries data-readout and data-value (SI) for probes. */
export function numbersHtml(n, system) {
  return n.sections
    .map(
      (s) => `<section class="numbers-group" data-group="${s.id}"${s.stale ? " data-stale" : ""}>
  <h3>${esc(s.title)}</h3>
  ${s.banner ? `<div class="extrap-banner" data-level="${s.banner.level}" role="note"><strong>${esc(s.banner.text)}.</strong> <details><summary>Which parameters</summary>${esc(s.banner.details)}</details></div>` : ""}
  ${s.note ? `<p class="section-note">${esc(formatText(s.note, system))}</p>` : ""}
  ${estimatedLine(s)}
  ${s.performance ? `<div class="perf-figures"${s.banner?.level === "far" ? " data-extrapolated" : ""}>${polarChart(s.performance.polar, system, { extrapolated: s.banner?.level === "far" })}${polarTable(s.performance.polar, system)}</div>` : ""}
  ${s.stability ? stabilityChart(s.stability, system) : ""}
  ${s.curve ? gzChart(s.curve, system) : ""}
  <dl>${s.rows
    .map((r) => {
      const value = r.dim === "ratio" ? (Number.isFinite(r.value) ? r.value.toFixed(r.value >= 100 ? 1 : 2) : "—") : formatQuantity(r.value, r.dim, system);
      const band = r.band ? `<span class="band"${r.band.out ? " data-out" : ""} title="${esc(r.source ?? "")}">${esc(r.band.label)}</span>` : "";
      const note = r.note ? `<span class="note">${esc(formatText(r.note, system))}</span>` : "";
      return `<div class="readout" data-readout="${r.id}" data-value="${Number.isFinite(r.value) ? r.value : ""}" data-prov="${r.prov}">
    <dt>${esc(formatText(r.label, system))}</dt>
    <dd><strong>${esc(value)}</strong>${provChip(r)}${band}${note}</dd>
  </div>`;
    })
    .join("")}</dl>
</section>`,
    )
    .join("");
}

/**
 * The strip under the drawing: what the reference point gives now, updated on
 * every render (and every drag frame, when it is marked ≈: the sails' trim
 * is borrowed until the drag ends).
 */
export function glanceHtml(n, system) {
  const g = n.glance;
  if (!g) return "";
  const q = (v, dim) => (v == null || !Number.isFinite(v) ? "—" : formatQuantity(v, dim, system));
  const item = (id, label, value, extra = "", out = false) =>
    `<div class="glance-item" data-glance="${id}"${out ? " data-out" : ""}><span class="glance-label">${esc(label)}</span><strong>${esc(value)}</strong>${extra}</div>`;
  const leadText = Number.isFinite(g.lead.pct) ? `${g.lead.pct.toFixed(1)}%` : "—";
  const leadBand = g.lead.range ? `<span class="band"${g.lead.out ? " data-out" : ""}>${esc(`${g.lead.range[0]}–${g.lead.range[1]}% est.`)}</span>` : "";
  const items = [];
  if (!g.ok) {
    items.push(item("lead", "Lead", leadText, leadBand, g.lead.out));
    return `<div class="rig-glance-inner"><p class="glance-at">At the reference point: not yet${g.why ? ` (${esc(g.why)})` : ""}.</p><div class="glance-items">${items.join("")}</div></div>`;
  }
  const h = g.helm;
  const helmVal = h && Number.isFinite(h.deg) ? (Math.abs(h.deg) < 0.5 ? "neutral" : `${h.deg > 0 ? "weather" : "lee"} ${Math.abs(h.deg).toFixed(1)}°`) : "—";
  const helmChip = h ? `<span class="band"${h.out ? " data-out" : ""} title="${esc(HELM_BAND.source)}">${h.out ? (h.id === "cannot" ? "can't be held" : h.id === "lee" ? "lee: out of band" : "heavy: over 5°") : "0–5° weather"}</span>` : "";
  items.push(item("helm", "Helm", helmVal, helmChip, !!h?.out));
  const ex = g.extrapolated;
  const speedChip = ex ? `<span class="band"${ex.level === "far" ? " data-out" : ""} title="${esc(ex.text)}">DSYHS extrap. ${ex.count}/${ex.of}</span>` : "";
  items.push(item("speed", "Boat speed", q(g.speed, "speed"), speedChip));
  items.push(item("vmg", "VMG", q(g.vmg, "speed")));
  items.push(item("heel", "Heel", q(g.heel, "angle")));
  items.push(item("sails", "Sails", g.sails));
  items.push(item("lead", "Lead", leadText, leadBand, g.lead.out));
  const lines = [];
  if (g.disagree) lines.push(`<p class="glance-disagree">${esc(g.disagree)}</p>`);
  if (g.inDoubt.length) lines.push(`<p class="glance-doubt">In doubt: ${esc(g.inDoubt.join(" "))}</p>`);
  return `<div class="rig-glance-inner"${n.approximate ? " data-approx" : ""}><p class="glance-at">At ${esc(g.at)}${n.approximate ? " (≈ while dragging)" : ""}</p><div class="glance-items">${items.join("")}</div>${lines.join("")}</div>`;
}

/**
 * The GZ curve: one series against heel, the zero line as the baseline, the
 * heels the table doesn't cover left out (never drawn as zero). Each point
 * has a hover target with its value.
 */
export function gzChart(curve, system) {
  const pts = curve.filter((p) => p.available);
  if (pts.length < 2) return "";
  const W = 300, H = 120, L = 44, R = 8, T = 8, B = 22;
  const x1 = Math.max(...pts.map((p) => p.heelDeg));
  const gz = pts.map((p) => p.gz);
  const lo = Math.min(0, ...gz), hi = Math.max(0, ...gz);
  const span = hi - lo || 1;
  const sx = (d) => L + ((W - L - R) * d) / (x1 || 1);
  const sy = (v) => T + ((H - T - B) * (hi - v)) / span;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.heelDeg).toFixed(1)},${sy(p.gz).toFixed(1)}`).join("");
  const ticks = [0, 30, 60, 90, 120, 150, 180].filter((d) => d <= x1);
  const fmt = (v) => formatQuantity(v, "length", system);
  const hits = pts
    .map((p) => `<circle class="gz-hit" cx="${sx(p.heelDeg).toFixed(1)}" cy="${sy(p.gz).toFixed(1)}" r="6"><title>${p.heelDeg}°: GZ ${esc(fmt(p.gz))}</title></circle>`)
    .join("");
  return `<svg class="gz-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="GZ curve against heel">
  <line class="gz-zero" x1="${L}" y1="${sy(0)}" x2="${W - R}" y2="${sy(0)}"/>
  ${ticks.map((d) => `<text class="gz-tick" x="${sx(d)}" y="${H - 6}" text-anchor="middle">${d}°</text>`).join("")}
  <text class="gz-tick" x="${L - 4}" y="${sy(hi) + 4}" text-anchor="end">${esc(formatQuantity(hi, "length", system, { digits: 2 }))}</text>
  <text class="gz-tick" x="${L - 4}" y="${sy(lo) + 4}" text-anchor="end">${esc(formatQuantity(lo, "length", system, { digits: 2, unit: false }))}</text>
  <path class="gz-line" d="${line}"/>
  ${hits}
</svg>`;
}
