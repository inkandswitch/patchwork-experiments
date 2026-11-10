// The profile drawing: the rig over the hull, seen from starboard, bow to the
// right. The hull is the mesh's silhouette (a linked hull's, or the synthetic
// one's) with its underwater lateral profile filled, or, while a linked hull
// loads, a box outline. Returns SVG markup; world units are metres (x forward, z up), so the
// viewBox is the drawing's bounds with z flipped. Pure, no DOM.
//
// Under the hull: the keel (and bulb) and rudder with its stock, and the
// balance marks (the lead's CLR and the dimension line to the designer's CE,
// the whole profile's CLR, the foils' hydrodynamic centre, CG and CB). With
// `handles`, the drag handles (handles.js) are drawn on top.

import { handlePoints, spreadHandles } from "./handles.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pt = (p) => `${p[0]},${-p[1]}`;
/** Text cut to about a width (an average glyph is ~0.55 em), with an ellipsis. */
const fitText = (text, width, fs) => {
  const n = Math.floor(width / (0.55 * fs));
  return text.length <= n ? text : `${text.slice(0, Math.max(1, n - 1))}…`;
};
const poly = (ps) => ps.map(pt).join(" ");

/** The drawing's bounds [minX, minZ, maxX, maxZ] over every point of the hull and rig. */
export function drawingBounds(hull, plan, app = null) {
  const ps = [
    [hull.stern[0], hull.draftZ],
    [hull.stem[0], hull.stem[1]],
    plan.mast.head,
    plan.mast.partners,
    ...plan.sails.flatMap((s) => s.polygon),
  ];
  if (plan.forestay) ps.push(plan.forestay.tack);
  for (const f of app?.foils ?? []) {
    ps.push(...f.polygon);
    if (f.bulb) ps.push(f.bulb.nose, f.bulb.tail, [f.bulb.centre[0], f.bulb.bottomZ]);
  }
  if (hull.form) {
    const { min, max } = hull.form.bounds;
    ps.push([min[0], min[2]], [max[0], max[2]]);
  }
  const xs = ps.map((p) => p[0]).filter(Number.isFinite);
  const zs = ps.map((p) => p[1]).filter(Number.isFinite);
  if (!xs.length) return [-1, -1, 1, 1];
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

/** The viewBox [x, y, w, h] for a set of numbers (SVG y = −z); `minBelow`: room under the foils for the lead and helm labels (m). */
export function viewBoxOf(n, { minBelow = 0 } = {}) {
  const [x0, z0, x1, z1] = drawingBounds(n.hull, n.plan, n.analysis?.app);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, z1 - z0);
  const pad = 0.06 * Math.max(w, h);
  // below: room for the lead's dimension line and its label; above: the hull's label
  const below = n.analysis?.balance?.clrLE ? Math.max(0.1 * Math.max(w, h), minBelow) : 0;
  const above = 0.04 * Math.max(w, h);
  return [x0 - pad, -(z1 + pad + above), w + 2 * pad, h + 2 * pad + below + above];
}

/**
 * @param {ReturnType<import("./numbers.js").computeNumbers>} n
 * @param {{ viewBox?: number[], handles?: boolean, active?: string, box?: [number, number] }} [opts]
 *   viewBox: hold the drawing still (during a drag); handles: draw the drag handles;
 *   box: the drawing's on-screen width and greatest height, px, so text and
 *   handles keep a least on-screen size however small the drawing is
 * @returns {string} an <svg> element's markup
 */
export const MIN_TEXT_PX = 11;
export const MIN_HANDLE_PX = 6; // visible radius
export const HIT_PX = 14; // touch target radius

export function profileSvg(n, opts = {}) {
  const { hull, plan } = n;
  const a = n.analysis;
  let vb = opts.viewBox ?? viewBoxOf(n);
  const size = Math.max(vb[2], vb[3]) / 1.12;
  const box = opts.box?.[0] > 0 ? opts.box : null;
  const pxPer = (v) => (box ? Math.min(box[0] / v[2], box[1] / v[3]) : 0);
  let k = pxPer(vb);
  let fs = Math.max(0.022 * size, k ? MIN_TEXT_PX / k : 0);
  // text floored at a readable size can outgrow the room left under the foils for the lead and helm labels
  for (let i = 0; i < 2 && !opts.viewBox && fs * 4.4 > 0.1 * size * 1.12; i++) {
    vb = viewBoxOf(n, { minBelow: fs * 4.4 });
    k = pxPer(vb);
    fs = Math.max(0.022 * size, k ? MIN_TEXT_PX / k : 0);
  }
  const r = Math.max(0.012 * size, k ? MIN_HANDLE_PX / 0.9 / k : 0);
  const hit = Math.max(r * 0.9, k ? HIT_PX / k : 0);
  const out = [];
  const label = (p, text, cls = "label", dx = r * 1.6, anchor = "start") =>
    out.push(`<text class="${cls}" x="${p[0] + dx}" y="${-p[1] + fs * 0.35}" font-size="${fs}" text-anchor="${anchor}">${esc(text)}</text>`);

  // the hull
  if (hull.form) {
    const v = hull.form.view;
    const outline = [...v.map((r) => [r.x, r.zMax]), ...[...v].reverse().map((r) => [r.x, r.zMin])];
    out.push(`<polygon class="hull mesh" data-part="hull" points="${poly(outline)}"/>`);
    const lat = hull.form.lateral;
    if (lat.polygon.length >= 3) out.push(`<polygon class="lateral" data-part="lateral-profile" points="${poly(lat.polygon)}"/>`);
    if (lat.centroid) {
      const [cx, cz] = lat.centroid;
      const d = r * 0.9;
      out.push(`<polygon class="clr-canoe" data-mark="lateral-centroid" points="${poly([[cx, cz + d], [cx + d, cz], [cx, cz - d], [cx - d, cz]])}"><title>Canoe body's lateral centre</title></polygon>`);
    }
    if (!hull.hasKeel && hull.draftZ < hull.canoeBottomZ - 1e-6) {
      const x0 = hull.dwl[0] + 0.35 * (hull.dwl[1] - hull.dwl[0]);
      out.push(`<line class="draft" x1="${x0}" y1="${-hull.draftZ}" x2="${x0 + 0.3 * (hull.dwl[1] - hull.dwl[0])}" y2="${-hull.draftZ}"/>`);
    }
    const what = hull.kind === "synthetic" ? "synthetic hull from principal dimensions" : `linked hull: ${hull.form.label}`;
    label([vb[0] + fs * 0.6, -vb[1] - fs * 1.4], fitText(what, vb[2] - fs * 1.2, fs), "label muted", 0);
  } else if (hull.loa > 0) {
    out.push(
      `<rect class="hull" data-part="hull" x="${hull.stern[0]}" y="${-hull.stem[1]}" width="${hull.loa}" height="${hull.stem[1] - hull.canoeBottomZ}"/>`,
    );
    if (!hull.hasKeel && hull.draftZ < hull.canoeBottomZ)
      out.push(`<line class="draft" x1="${hull.stern[0] + 0.3 * hull.loa}" y1="${-hull.draftZ}" x2="${hull.stern[0] + 0.6 * hull.loa}" y2="${-hull.draftZ}"/>`);
    label([vb[0] + fs * 0.6, -vb[1] - fs * 1.4], fitText("box outline from principal dimensions", vb[2] - fs * 1.2, fs), "label muted", 0);
  }

  // keel, bulb, rudder and its stock
  for (const f of a?.app.foils ?? []) {
    out.push(`<polygon class="foil" data-part="${f.id}" points="${poly(f.polygon)}"/>`);
    if (f.bulb) {
      const b = f.bulb;
      out.push(`<ellipse class="foil bulb" data-part="bulb" cx="${b.centre[0]}" cy="${-b.centre[1]}" rx="${b.length / 2}" ry="${b.diameter / 2}"/>`);
    }
    if (f.id === "rudder") {
      const k = n.doc.appendages.rudder.stockFrac;
      const { rootLE, tipLE } = f.corners;
      const top = [rootLE[0] - k * f.rootChord, Math.max(rootLE[1], 0) + 0.15 * f.span];
      const bot = [tipLE[0] - k * f.tipChord, tipLE[1]];
      out.push(`<line class="stock" data-part="rudder-stock" x1="${top[0]}" y1="${-top[1]}" x2="${bot[0]}" y2="${-bot[1]}"/>`);
    }
  }

  // the waterline over the hull, the LWL span heavier
  out.push(`<line class="dwl" x1="${vb[0]}" y1="0" x2="${vb[0] + vb[2]}" y2="0"/>`);
  if (hull.lwl > 0) out.push(`<line class="lwl" x1="${hull.dwl[0]}" y1="0" x2="${hull.dwl[1]}" y2="0"/>`);
  label([vb[0], fs * 0.5], "DWL", "label muted", fs * 0.3);

  // stays, mast, boom
  if (plan.backstay) out.push(`<line class="stay" x1="${plan.backstay.from[0]}" y1="${-plan.backstay.from[1]}" x2="${plan.backstay.to[0]}" y2="${-plan.backstay.to[1]}"/>`);
  if (plan.forestay) out.push(`<line class="stay" data-part="forestay" x1="${plan.forestay.tack[0]}" y1="${-plan.forestay.tack[1]}" x2="${plan.forestay.head[0]}" y2="${-plan.forestay.head[1]}"/>`);
  const stay = plan.sails.find((s) => s.id === "staysail");
  if (stay) out.push(`<line class="stay" x1="${stay.stay.tack[0]}" y1="${-stay.stay.tack[1]}" x2="${stay.stay.head[0]}" y2="${-stay.stay.head[1]}"/>`);
  if (plan.foretriangle) out.push(`<polygon class="foretriangle" points="${poly(plan.foretriangle.polygon)}"/>`);
  for (const s of plan.sails) out.push(`<polygon class="sail" data-sail="${s.id}" points="${poly(s.polygon)}"/>`);
  const main = plan.sails.find((s) => s.id === "main");
  for (const reef of main?.reefs ?? []) {
    // the reef line on the full sail: the reefed polygon's foot, raised back by r·P
    const lift = reef.fraction * plan.P;
    const th = (plan.rakeDeg * Math.PI) / 180;
    const up = [-Math.sin(th) * lift, Math.cos(th) * lift];
    const foot = reef.polygon.filter((p) => Math.abs(p[1] - plan.boom.gooseneck[1]) < 1e-6).map((p) => [p[0] + up[0], p[1] + up[1]]);
    if (foot.length >= 2) out.push(`<line class="reef" x1="${foot[0][0]}" y1="${-foot[0][1]}" x2="${foot[foot.length - 1][0]}" y2="${-foot[foot.length - 1][1]}"/>`);
  }
  out.push(`<line class="mast" data-part="mast" x1="${plan.mast.partners[0]}" y1="${-plan.mast.partners[1]}" x2="${plan.mast.head[0]}" y2="${-plan.mast.head[1]}"/>`);
  if (plan.boom) out.push(`<line class="boom" x1="${plan.boom.gooseneck[0]}" y1="${-plan.boom.gooseneck[1]}" x2="${plan.boom.end[0]}" y2="${-plan.boom.end[1]}"/>`);

  // centres of effort
  for (const s of plan.sails) out.push(`<circle class="ce-sail" cx="${s.ce[0]}" cy="${-s.ce[1]}" r="${r * 0.6}"/>`);
  if (plan.designer.ce) {
    const [cx, cz] = plan.designer.ce;
    out.push(
      `<g class="ce-designer" data-mark="ce-designer"><circle cx="${cx}" cy="${-cz}" r="${r}"/><line x1="${cx - r}" y1="${-cz}" x2="${cx + r}" y2="${-cz}"/><line x1="${cx}" y1="${-cz - r}" x2="${cx}" y2="${-cz + r}"/></g>`,
    );
    // the designer's label to the left, the actual sails' to the right: the two often nearly coincide
    label([plan.designer.ce[0], plan.designer.ce[1] + fs * 0.9], "CE designer's", "label", -r * 1.6, "end");
  }
  if (plan.actual.ce) {
    out.push(`<circle class="ce-actual" data-mark="ce-actual" cx="${plan.actual.ce[0]}" cy="${-plan.actual.ce[1]}" r="${r * 0.8}"/>`);
    label([plan.actual.ce[0], plan.actual.ce[1] - fs * 0.9], "CE actual sails");
  }

  // balance: the lead's CLR and its dimension to the designer's CE, the whole profile's CLR, the foils' centre, CG and CB
  const b = a?.balance;
  const diamond = (p, d) => poly([[p[0], p[1] + d], [p[0] + d, p[1]], [p[0], p[1] - d], [p[0] - d, p[1]]]);
  if (b?.clrLE) {
    out.push(`<polygon class="clr" data-mark="clr-lead" points="${diamond(b.clrLE, r * 1.1)}"><title>CLR for the lead: ${esc(b.clrMethod)}</title></polygon>`);
    if (plan.designer.ce && Number.isFinite(b.lead)) {
      const zDim = Math.min(...(a.app.foils.length ? a.app.foils.map((f) => f.bottomZ) : [hull.draftZ])) - fs * 1.6;
      const xa = b.clrLE[0], xb = plan.designer.ce[0];
      out.push(`<g class="lead-dim" data-mark="lead">`);
      out.push(`<line x1="${xa}" y1="${-b.clrLE[1]}" x2="${xa}" y2="${-zDim}"/><line x1="${xb}" y1="${-plan.designer.ce[1]}" x2="${xb}" y2="${-zDim}"/>`);
      out.push(`<line class="dim" x1="${xa}" y1="${-zDim}" x2="${xb}" y2="${-zDim}"/></g>`);
      label([(xa + xb) / 2, zDim - fs * 1.1], `lead ${(b.lead * 100).toFixed(1)}% LWL${b.leadBand.out ? ` (${b.leadBand.range ? `band ${b.leadBand.range[0]}–${b.leadBand.range[1]}%` : ""})` : ""}`, b.leadBand.out ? "label warn" : "label", 0, "middle");
      // the VPP's helm beside it: the geometric rule and the force model, read together
      const h = n.helm;
      if (h && Number.isFinite(h.deg)) {
        const words = Math.abs(h.deg) < 0.5 ? "helm neutral" : `helm ${h.deg > 0 ? "weather" : "lee"} ${Math.abs(h.deg).toFixed(1)}°${h.out ? (h.id === "lee" ? " (out of band)" : h.id === "cannot" ? " (can't hold)" : " (heavy)") : ""}`;
        label([(xa + xb) / 2, zDim - fs * 2.4], words, h.out ? "label warn" : "label", 0, "middle");
      }
    }
  }
  if (b?.clrWhole) out.push(`<polygon class="clr whole" data-mark="clr-whole" points="${diamond(b.clrWhole, r * 0.8)}"><title>CLR of the whole underwater profile</title></polygon>`);
  if (b?.hc) out.push(`<circle class="hc" data-mark="hc" cx="${b.hc[0]}" cy="${-b.hc[1]}" r="${r * 0.7}"><title>The foils' hydrodynamic centre</title></circle>`);
  if (a?.mass) {
    const [gx, , gz] = a.mass.G;
    const q = r * 0.9;
    out.push(
      `<g class="cg" data-mark="cg"><title>Centre of gravity (mass roll-up)</title><circle cx="${gx}" cy="${-gz}" r="${q}"/><path d="M${gx},${-gz} L${gx + q},${-gz} A${q},${q} 0 0,0 ${gx},${-gz - q} Z M${gx},${-gz} L${gx - q},${-gz} A${q},${q} 0 0,0 ${gx},${-gz + q} Z"/></g>`,
    );
  }
  if (n.form) {
    const h = n.form.hydro;
    out.push(`<circle class="cb" data-mark="cb" cx="${h.lcb}" cy="${-h.vcb}" r="${r * 0.6}"><title>Centre of buoyancy, canoe body</title></circle>`);
  }

  if (opts.handles) {
    // spread so no circle covers another (each still drags its own point)
    const hs = spreadHandles(handlePoints(n), r * 0.9 * 2.2);
    // an invisible finger-sized target under each, then the visible dots on top (a dot wins where targets overlap)
    if (hit > r * 0.9 * 1.05)
      for (const hp of hs) out.push(`<circle class="handle-hit" data-handle="${hp.id}" cx="${hp.at[0]}" cy="${-hp.at[1]}" r="${hit}"><title>${esc(hp.label)}</title></circle>`);
    for (const hp of hs)
      out.push(
        `<circle class="handle" data-handle="${hp.id}"${opts.active === hp.id ? " data-active" : ""} cx="${hp.at[0]}" cy="${-hp.at[1]}" r="${r * 0.9}"><title>${esc(hp.label)}</title></circle>`,
      );
  }

  return `<svg class="profile-svg" viewBox="${vb.join(" ")}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Sail plan profile">${out.join("")}</svg>`;
}
