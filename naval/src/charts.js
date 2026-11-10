// The stability chart: righting moment against heel, with the crew's part
// shaded, the wind's heeling moment for each apparent wind, the steady heel
// where they meet, and the heel limit. One y-axis (moment); colours are theme
// tokens (rig.css), never literals; every series is named in the legend, the
// heeling curves also by a direct label, and each point has a hover target.
// Returns SVG markup; pure apart from the id counter.

import { formatQuantity, toDisplay, KNOT } from "./naval/units.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let nextId = 1;

/** Round a span up to a 1, 2 or 5 step for the axis. */
function niceStep(span, n = 4) {
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

/**
 * @param {{ points: { heelDeg, available, rm, rmBoat, crewRm, gz }[], winds: { aws, heelDeg, state, hm: (φ) => number }[], heelLimit: number }} s
 * @param {"metric"|"imperial"} system
 */
export function stabilityChart(s, system) {
  const run = [];
  for (const p of s.points) {
    if (!p.available) break;
    if (p.heelDeg > 90) break;
    run.push(p);
  }
  if (run.length < 2) return "";
  const W = 320, H = 190, L = 46, R = 10, T = 8, B = 22;
  const unit = toDisplay(1, "moment", system).label;
  const k = toDisplay(1, "moment", system).value; // display units per N·m
  const x1 = run[run.length - 1].heelDeg;
  const rmMax = Math.max(...run.map((p) => p.rm));
  const hi = rmMax * k * 1.08;
  const lo = Math.min(0, ...run.map((p) => p.rmBoat * k));
  const sx = (d) => L + ((W - L - R) * d) / (x1 || 1);
  const sy = (v) => T + ((H - T - B) * (hi - v)) / (hi - lo || 1);
  const path = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  const id = `rig-stab-${nextId++}`;

  const out = [];
  // grid and axes: recessive
  const step = niceStep(hi - lo);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    out.push(`<line class="grid" x1="${L}" y1="${sy(v).toFixed(1)}" x2="${W - R}" y2="${sy(v).toFixed(1)}"/>`);
    out.push(`<text class="tick" x="${L - 4}" y="${(sy(v) + 3).toFixed(1)}" text-anchor="end">${esc(+v.toPrecision(3))}</text>`);
  }
  for (const d of [0, 15, 30, 45, 60, 75, 90].filter((d) => d <= x1)) out.push(`<text class="tick" x="${sx(d).toFixed(1)}" y="${H - 6}" text-anchor="middle">${d}°</text>`);
  out.push(`<text class="tick" x="${L - 4}" y="${T + 2}" text-anchor="end" dominant-baseline="hanging">${esc(unit)}</text>`);

  // the crew's part: between RM without and with them
  if (run.some((p) => Math.abs(p.crewRm) > 1e-9)) {
    const top = run.map((p) => [sx(p.heelDeg), sy(p.rm * k)]);
    const bot = [...run].reverse().map((p) => [sx(p.heelDeg), sy(p.rmBoat * k)]);
    out.push(`<path class="crew-area" d="${path([...top, ...bot])}Z"><title>The crew's righting moment</title></path>`);
  }
  // heel limit
  if (s.heelLimit > 0 && s.heelLimit <= x1)
    out.push(`<line class="limit" x1="${sx(s.heelLimit)}" y1="${T}" x2="${sx(s.heelLimit)}" y2="${H - B}"/><text class="tick" x="${sx(s.heelLimit) + 3}" y="${T + 8}">reef ${s.heelLimit}°</text>`);
  // heeling moments, clipped to the plot
  out.push(`<clipPath id="${id}"><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></clipPath>`);
  const hm = [];
  let lastLabelY = -Infinity;
  for (const w of [...s.winds].sort((p, q) => q.aws - p.aws)) {
    const pts = run.map((p) => [sx(p.heelDeg), sy(w.hm(p.heelDeg) * k)]);
    hm.push(`<path class="hm-line" d="${path(pts)}"/>`);
    const kn = Math.round((w.aws / KNOT) * 10) / 10;
    // direct label at upright, where the curves are furthest apart
    const y0 = sy(w.hm(0) * k);
    // strongest first, each label only where it clears the one above
    if (y0 >= T + 8 && y0 <= H - B && y0 - lastLabelY >= 12) {
      lastLabelY = y0;
      out.push(`<text class="hm-label" x="${L + 3}" y="${(y0 - 3).toFixed(1)}">${kn} kn</text>`);
    }
  }
  out.push(`<g clip-path="url(#${id})">${hm.join("")}</g>`);
  // righting moment
  out.push(`<path class="rm-line" d="${path(run.map((p) => [sx(p.heelDeg), sy(p.rm * k)]))}"/>`);
  // steady heels
  for (const w of s.winds) {
    if (w.state !== "steady" || w.heelDeg == null) continue;
    const kn = Math.round((w.aws / KNOT) * 10) / 10;
    const y = sy(w.hm(w.heelDeg) * k);
    out.push(`<circle class="steady" cx="${sx(w.heelDeg).toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${kn} kn apparent: steady heel ${w.heelDeg.toFixed(1)}°</title></circle>`);
  }
  // hover targets on the RM curve
  for (const p of run)
    out.push(
      `<circle class="hit" cx="${sx(p.heelDeg).toFixed(1)}" cy="${sy(p.rm * k).toFixed(1)}" r="6"><title>${p.heelDeg}°: RM ${esc(formatQuantity(p.rm, "moment", system))}${p.crewRm ? ` (crew ${esc(formatQuantity(p.crewRm, "moment", system))})` : ""}, GZ ${esc(formatQuantity(p.gz, "length", system))}</title></circle>`,
    );

  const legend = `<div class="chart-legend cluster" aria-hidden="true">
    <span><i class="key rm"></i>Righting moment</span>
    <span><i class="key crew"></i>Crew's part</span>
    <span><i class="key hm"></i>Heeling moment, by apparent wind</span>
    <span><i class="key steady"></i>Steady heel</span>
  </div>`;
  return `<figure class="stability-chart">${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Righting and heeling moments against heel">${out.join("")}</svg></figure>`;
}

// ───────────────────────────────── performance

/** A TWS series' colour: one hue, light to dark with the wind (sequential: TWS is ordered). */
const seriesClass = (i) => `tws-${Math.min(6, i)}`;

/**
 * The polar: boat speed against true wind angle, one curve per true wind
 * speed (a single-hue ramp, light to dark, with the legend and a direct
 * label at each curve's end), the beat and run VMG points marked, and every
 * point a hover target with its numbers. A flagged point is drawn hollow
 * and its title says why; a point with no speed (beyond model, no
 * equilibrium) isn't joined into its curve.
 * @param {{ points: object[], beat: object[], run: object[] }} polar vpp.js polar()
 * @param {"metric"|"imperial"} system
 */
export function polarChart(polar, system, { extrapolated = false } = {}) {
  const tws = [...new Set(polar.points.map((p) => p.tws))].sort((a, b) => a - b);
  const sp = polar.points.filter((p) => p.speed != null).map((p) => p.speed / KNOT);
  if (!sp.length) return "";
  const W = 300, H = 300, cx = 30, cy = H / 2, R = 130;
  const step = niceStep(Math.max(...sp), 4);
  const top = Math.ceil(Math.max(...sp) / step) * step;
  const pt = (twa, kn) => {
    const r = (R * kn) / top, t = twa * (Math.PI / 180);
    return [cx + r * Math.sin(t), cy - r * Math.cos(t)];
  };
  const out = [];
  for (let v = step; v <= top + 1e-9; v += step) {
    const r = (R * v) / top;
    out.push(`<path class="grid" d="M${cx},${(cy - r).toFixed(1)}A${r.toFixed(1)},${r.toFixed(1)} 0 0 1 ${cx},${(cy + r).toFixed(1)}"/>`);
    out.push(`<text class="tick" x="${cx - 3}" y="${(cy - r + 3).toFixed(1)}" text-anchor="end">${+v.toFixed(1)}</text>`);
  }
  for (const a of [0, 30, 60, 90, 120, 150, 180]) {
    const [x, y] = pt(a, top);
    out.push(`<line class="grid" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`);
    const [lx, ly] = pt(a, top * 1.07);
    out.push(`<text class="tick" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="middle">${a}°</text>`);
  }
  out.push(`<text class="tick" x="${cx - 3}" y="${cy + 12}" text-anchor="end">kn</text>`);
  const labels = [];
  // strongest wind first, so where labels collide the outermost curve keeps its label
  [...tws.entries()].reverse().forEach(([i, w]) => {
    const pts = polar.points.filter((p) => p.tws === w).sort((a, b) => a.twa - b.twa);
    const kn = Math.round((w / KNOT) * 10) / 10;
    // a curve through the points with a speed; a gap where there is none
    let d = "", pen = false;
    for (const p of pts) {
      if (p.speed == null) {
        pen = false;
        continue;
      }
      const [x, y] = pt(p.twa, p.speed / KNOT);
      d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      pen = true;
    }
    out.push(`<path class="polar-line ${seriesClass(i)}" d="${d}"/>`);
    for (const p of pts) {
      if (p.speed == null && !p.ok) continue;
      const v = (p.speed ?? p.V) / KNOT;
      const [x, y] = pt(p.twa, v);
      const why = p.flags.map((f) => f.text).join(" ");
      const t = `${kn} kn true at ${p.twa}°: ${p.speed == null ? "no speed shown" : `${v.toFixed(2)} kn`}, heel ${p.heel.toFixed(1)}°, leeway ${p.leeway.toFixed(1)}°, rudder ${p.rudder.toFixed(1)}°${p.flat < 1 ? `, flat ${p.flat.toFixed(2)}` : ""}${p.reef >= 0 ? `, reef ${p.reef + 1}` : ""}${p.regimeText ? `; ${p.regimeText}` : ""}${why ? `. ${why}` : ""}`;
      out.push(`<circle class="polar-dot ${seriesClass(i)}"${p.hollow ? " data-hollow" : ""}${p.regime ? ` data-regime="${p.regime}"` : ""} cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${esc(t)}</title></circle>`);
    }
    // a direct label at the curve's end, only where it clears the ones already placed (the legend names every series)
    const last = pts.filter((p) => p.speed != null).at(-1);
    if (last) {
      const [x, y] = pt(last.twa, last.speed / KNOT);
      const lx = x + 9, ly = y + 3;
      if (!labels.some(([px, py]) => Math.abs(px - lx) < 16 && Math.abs(py - ly) < 11)) {
        labels.push([lx, ly]);
        out.push(`<text class="polar-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}">${kn}</text>`);
      }
    }
  });
  for (const [list, cls, what] of [[polar.beat, "beat", "Best beat VMG"], [polar.run, "run", "Best run VMG"]])
    for (const p of list) {
      if (!p?.ok || p.speed == null) continue;
      const [x, y] = pt(p.twa, p.speed / KNOT);
      out.push(`<rect class="vmg ${cls}" x="${(x - 3).toFixed(1)}" y="${(y - 3).toFixed(1)}" width="6" height="6"><title>${esc(`${what} at ${Math.round((p.tws / KNOT) * 10) / 10} kn true: ${(Math.abs(p.vmg) / KNOT).toFixed(2)} kn at ${p.twa.toFixed(1)}°`)}</title></rect>`);
    }
  const legend = `<div class="chart-legend cluster" aria-hidden="true">
    ${tws.map((w, i) => `<span><i class="key polar ${seriesClass(i)}"></i>${Math.round((w / KNOT) * 10) / 10} kn</span>`).join("")}
    <span><i class="key hollow"></i>in doubt (hover for why)</span>${extrapolated ? '<span><i class="key dashed"></i>DSYHS extrapolated</span>' : ""}
    <span><i class="key vmg"></i>best VMG</span>
  </div>`;
  return `<figure class="polar-chart">${legend}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Boat speed against true wind angle, one curve per true wind speed">${out.join("")}</svg></figure>`;
}

/**
 * The ORC-certificate-style table: boat speed (kn) by true wind angle down
 * and true wind speed across, then beat and run VMG and their angles.
 * A flagged cell is marked and its title says why.
 */
export function polarTable(polar, system) {
  const tws = [...new Set(polar.points.map((p) => p.tws))].sort((a, b) => a - b);
  const twa = [...new Set(polar.points.map((p) => p.twa))].sort((a, b) => a - b);
  const at = (w, a) => polar.points.find((p) => p.tws === w && p.twa === a);
  const cell = (p, v) => {
    if (!p) return "<td></td>";
    // the regime is named where it isn't plain displacement sailing, so a planing speed says it is one
    const why = [p.regime && p.regime !== "displacement" ? p.regimeText : "", ...p.flags.map((f) => f.text)].filter(Boolean).join(". ");
    const text = v == null ? "—" : v.toFixed(2);
    return `<td${p.hollow ? " data-flagged" : ""}${p.regime ? ` data-regime="${p.regime}"` : ""}${why ? ` title="${esc(why)}"` : ""}>${text}${p.regime === "planing" && v != null ? '<sup class="planing">P</sup>' : ""}${p.hollow ? "<sup>*</sup>" : ""}</td>`;
  };
  const kn = (v) => (v == null ? null : v / KNOT);
  const rows = [];
  rows.push(`<tr><th scope="row">Beat VMG</th>${tws.map((w, i) => cell(polar.beat[i], kn(polar.beat[i]?.speed != null ? polar.beat[i].vmg : null))).join("")}</tr>`);
  rows.push(`<tr><th scope="row">Beat angle</th>${tws.map((w, i) => `<td>${polar.beat[i]?.ok ? `${polar.beat[i].twa.toFixed(1)}°` : "—"}</td>`).join("")}</tr>`);
  for (const a of twa) rows.push(`<tr><th scope="row">${a}°</th>${tws.map((w) => cell(at(w, a), kn(at(w, a)?.speed))).join("")}</tr>`);
  rows.push(`<tr><th scope="row">Run VMG</th>${tws.map((w, i) => cell(polar.run[i], kn(polar.run[i]?.speed != null ? -polar.run[i].vmg : null))).join("")}</tr>`);
  rows.push(`<tr><th scope="row">Run angle</th>${tws.map((w, i) => `<td>${polar.run[i]?.ok ? `${polar.run[i].twa.toFixed(1)}°` : "—"}</td>`).join("")}</tr>`);
  return `<div class="polar-table-wrap"><table class="polar-table">
  <caption>Boat speed, kn, by true wind angle and speed${polar.points.some((p) => p.regime === "planing" && p.speed != null) ? "; P planing (Savitsky)" : ""}${polar.points.some((p) => p.hollow) ? "; * in doubt, hover for why" : ""}</caption>
  <thead><tr><th scope="col">TWA \\ TWS</th>${tws.map((w) => `<th scope="col">${Math.round((w / KNOT) * 10) / 10} kn</th>`).join("")}</tr></thead>
  <tbody>${rows.join("")}</tbody></table></div>`;
}
