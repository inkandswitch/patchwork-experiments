// How each sail is trimmed, read off the physics' own numbers (DESIGN.md,
// "Trim feedback" §4, "The thresholds"): whether it's luffing, drawing,
// stalled, backed, goose-winged or down, how hard it flogs, how much of its
// flow has separated, and which way it bellies. Pure: a function of one
// sail as physics.js read().sails gives it (or sim.js published()'s rounded
// copy, which carries the fields used here) and its family's constants from
// the rig contract. The HUD's words and the looks' cloth are both this, so
// they can't disagree with each other or with the forces.

const DEG = Math.PI / 180;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
/** §6.2's S: 0 at lo, 1 at hi, t²(3 − 2t) between; the physics' own (rigSailCoeffs' σ). */
const smooth = (lo, hi, x) => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Where the luff starts to lift and where the sail draws fully, as fractions
 * of its stall angle above its zero-lift angle (DESIGN.md, "Trim feedback"
 * §4, "The thresholds"): luffing below alpha0 + LUFF·stall, soft
 * (under-trimmed, the windward telltale lifting) up to alpha0 +
 * DRAW·stall, drawing above. For the 12 m sloop's families the luff's onset
 * is at CL ≈ 0.55·clMax and the sail's best lift (α ≈ alpha0 + 21°) is in
 * the drawing band, both telltales streaming (trim.test.js).
 */
export const LUFF = 0.5;
export const DRAW = 0.75;

/** How far the windward telltale is lifted (0..1) when it is past `STREAM` it's not streaming; the leeward one is streaming below CURL. */
export const STREAM = Object.freeze({ lift: 0.05, curl: 0.25 });

/**
 * A sail's thresholds from its contract entry (a rig contract's sail, its
 * `model` the family's constants, its `sheeting.wing` the goose-winged
 * travel, its `sheeting.maxDeg` the most its sheet lets it out): alpha0,
 * stall and width (deg), luffAt and drawAt (deg: alpha0 + LUFF·stall,
 * alpha0 + DRAW·stall), maxDeg, and wingFrom (β_e, deg; null for a sail
 * that can't be winged).
 */
export function trimModelOf(sail) {
  const m = sail?.model ?? {};
  const wing = sail?.sheeting?.wing ?? m.wing ?? null;
  const alpha0 = Number(m.alpha0) || 0, stall = Number(m.stall) || 18;
  const maxDeg = Number.isFinite(sail?.sheeting?.maxDeg) ? sail.sheeting.maxDeg : Number.isFinite(m.sheet?.[1]) ? m.sheet[1] : 85;
  return { alpha0, stall, width: Number(m.width) || 20, luffAt: alpha0 + LUFF * stall, drawAt: alpha0 + DRAW * stall, maxDeg, wingFrom: Number.isFinite(wing?.fromBeta) ? wing.fromBeta : null };
}

/**
 * Is a made-fast headsail backed on either side? Its air (`from`, rad) within
 * its zero-lift angle (`alpha0`, deg) of dead ahead: its air can't say which
 * side is leeward, so whichever side it's held on, it's backed (physics.js,
 * P2). Outside it, only held to windward. B at the helm chooses the side by
 * the wheel only here, so the side it chooses always backs (stations.js).
 */
export const heldEitherSide = (from, alpha0) => Math.abs(Number(from) || 0) < Math.abs(Number(alpha0) || 0) * DEG;

/** The states a sail's trim is in, in the order they're tested. */
export const STATES = Object.freeze(["down", "wing", "backed", "luffing", "soft", "stalled", "drawing"]);

/**
 * One sail's trim. `s`: { angle, limit, from (rad), sheet, alpha (deg),
 * area } as read().sails gives them; `k`: trimModelOf's (luffAt, drawAt
 * and maxDeg optional: LUFF's and DRAW's by default, no stop). Writes into and
 * returns `out` (no allocation when it's given):
 * - beta: β_e (deg), |from|
 * - upwash: ε (deg), β_e − δ_s − α (the main's; 0 for a headsail)
 * - alphaSheet: the α the sheet asks for, if the sail stood at it: β_e − limit − ε
 * - free: its sheet is eased past where its air puts it (alphaSheet <
 *   alpha0): it lies at zero lift, its sheet slack (physics.js P1)
 * - ask: the α it's at, or the sheet's ask when free (below alpha0): in
 *   a steady state max(alphaSheet, alpha0) = α, so continuous in the sheet
 * - flog: 0..1, how far below its luff's onset: clamp((luffAt − ask) /
 *   (luffAt − alpha0 + stall), 0, 1); 0 backed or winged (pressed by its air)
 * - luff: 0..1, how far its luff has lifted (the windward telltale):
 *   1 − S(ask; luffAt, drawAt); 0 backed or winged
 * - sigma: §6.2's separation weight at its α, S(|α − alpha0|; stall, stall + width)
 * - belly: −1..1, the side its cloth is pushed to (+ starboard): to leeward
 *   by sin(α − alpha0)/sin|alpha0| (flat at zero lift); backed or winged,
 *   its air's way across its chord
 * - atStop: stalled with its sheet all the way out (nothing the sheet can do)
 * - state: "down" | "wing" | "backed" | "luffing" | "soft" | "stalled" | "drawing"
 */
export function trimOf(s, k, out = {}) {
  const from = Number(s.from) || 0;
  const beta = Math.abs(from) / DEG;
  const sheet = Number(s.sheet) || 0;
  const alpha = Number(s.alpha) || 0;
  const limit = Number(s.limit) || 0;
  const upwash = beta - sheet - alpha;
  const alphaSheet = beta - limit / DEG - upwash;
  const back = sheet < 0;
  const free = !back && alphaSheet < k.alpha0;
  const ask = free ? alphaSheet : alpha;
  const luffAt = k.luffAt ?? k.alpha0 + LUFF * k.stall, drawAt = k.drawAt ?? k.alpha0 + DRAW * k.stall;
  out.beta = beta;
  out.upwash = upwash;
  out.alphaSheet = alphaSheet;
  out.free = free;
  out.ask = ask;
  out.flog = back ? 0 : clamp((luffAt - ask) / (luffAt - k.alpha0 + k.stall), 0, 1);
  out.luff = back ? 0 : 1 - smooth(luffAt, drawAt, ask);
  out.sigma = smooth(k.stall, k.stall + k.width, Math.abs(alpha - k.alpha0));
  if (back) {
    const across = Math.sin(-from - (Number(s.angle) || 0));
    out.belly = clamp(across / Math.sin(Math.abs(k.alpha0 * DEG) || 1e-9), -1, 1);
  } else {
    const side = from < 0 ? -1 : 1;
    out.belly = -side * clamp(Math.sin((alpha - k.alpha0) * DEG) / Math.sin(Math.abs(k.alpha0 * DEG) || 1e-9), -1, 1);
  }
  out.state = !(s.area > 0)
    ? "down"
    : back && k.wingFrom != null && beta >= k.wingFrom
      ? "wing"
      : back
        ? "backed"
        : ask < luffAt
          ? "luffing"
          : ask < drawAt
            ? "soft"
            : out.sigma >= 0.5
              ? "stalled"
              : "drawing";
  out.atStop = out.state === "stalled" && Number.isFinite(k.maxDeg) && limit / DEG >= k.maxDeg - 0.25;
  return out;
}

/** Each sail of a read with its trim: [{ sail, trim }] for read.sails, the models by sail id (trimModelOf). */
export function trimsOf(sails, models) {
  if (!Array.isArray(sails)) return [];
  return sails.map((s) => ({ sail: s, trim: trimOf(s, models?.[s.id] ?? trimModelOf(null)) }));
}

// ─── the rig's geometry, for the sheets and the vane (pure) ────────────────

/** A contract point (its frame: x forward, y to port, z up) in the body frame (x starboard, y up, z aft): rig-contract.js toBody. */
const bodyOf = (p) => [-p[1] + 0, p[2] + 0, -p[0] + 0];

const geoMemo = new WeakMap();

/**
 * What the trim visuals need of a rig contract, in the body frame (memoised
 * per contract): each sail's pivot (its tack) and luff axis, which is what
 * the physics swings it about (rig-sails.js rigSails), its foot's length;
 * the main's sheet point on the boom and the traveller's car (the track's
 * middle); the jib's tack, head and clew, its leads per side (by furl) and
 * the most it travels either side (rad: its sheeting's maxDeg or its
 * goose-winged travel); the masthead and the backstay. null without sails.
 */
export function rigGeometry(contract) {
  if (!contract || typeof contract !== "object") return null;
  let g = geoMemo.get(contract);
  if (g !== undefined) return g;
  const sails = Array.isArray(contract.sails) ? contract.sails : [];
  const hp = contract.hardpoints ?? {};
  const sailOf = (s) => {
    const tack = bodyOf(s.tackM), head = bodyOf(s.headM), clew = bodyOf(s.clewM);
    const l = Math.hypot(head[0] - tack[0], head[1] - tack[1], head[2] - tack[2]) || 1;
    return { id: s.id, tack, head, clew, pivot: tack, axis: [(head[0] - tack[0]) / l, (head[1] - tack[1]) / l, (head[2] - tack[2]) / l], foot: Math.hypot(clew[0] - tack[0], clew[1] - tack[1], clew[2] - tack[2]) };
  };
  const mainS = sails.find((s) => (s.model?.family ?? s.kind) === "main" && Array.isArray(s.tackM));
  const jibS = sails.find((s) => (s.model?.family ?? s.kind) !== "main" && Array.isArray(s.tackM));
  let main = null;
  if (mainS) {
    main = sailOf(mainS);
    const tr = hp.mainsheet?.travellerM;
    const boom = hp.mainsheet?.boomM;
    main.boom = Array.isArray(boom) ? bodyOf(boom) : main.clew;
    main.traveller = Array.isArray(tr) && tr.length === 2 ? bodyOf([(tr[0][0] + tr[1][0]) / 2, (tr[0][1] + tr[1][1]) / 2, (tr[0][2] + tr[1][2]) / 2]) : null;
  }
  let jib = null;
  if (jibS) {
    jib = sailOf(jibS);
    const sh = jibS.sheeting ?? {};
    const DEG = Math.PI / 180;
    const maxDeg = Number.isFinite(sh.maxDeg) ? sh.maxDeg : (jibS.model?.sheet?.[1] ?? 85);
    const wing = sh.wing ? Math.abs(sh.wing.sheet?.[0] ?? 0) : 0;
    jib.travel = Math.max(maxDeg, wing) * DEG;
    jib.leads = { port: null, starboard: null };
    for (const L of Array.isArray(hp.jibLeads) ? hp.jibLeads : []) {
      if (L?.sail !== jibS.id || (L.side !== "port" && L.side !== "starboard")) continue;
      const list = Array.isArray(L.leads) && L.leads.length ? L.leads : [{ furl: 0, atM: L.trackFromM }];
      jib.leads[L.side] = list
        .filter((x) => Array.isArray(x?.atM))
        .map((x) => ({ furl: Number(x.furl) || 0, at: bodyOf(x.atM) }))
        .sort((a, b) => a.furl - b.furl);
    }
    if (!jib.leads.port?.length && Array.isArray(sh.lead?.port)) jib.leads.port = [{ furl: 0, at: bodyOf(sh.lead.port) }];
    if (!jib.leads.starboard?.length && Array.isArray(sh.lead?.starboard)) jib.leads.starboard = [{ furl: 0, at: bodyOf(sh.lead.starboard) }];
    if (!jib.leads.port?.length || !jib.leads.starboard?.length) jib.leads = null;
  }
  const masthead = Array.isArray(hp.mastheadM) ? bodyOf(hp.mastheadM) : null;
  const backstay = masthead && Array.isArray(hp.backstayPlateM) ? { from: masthead, to: bodyOf(hp.backstayPlateM) } : null;
  g = main || jib ? { main, jib, masthead, backstay } : null;
  geoMemo.set(contract, g);
  return g;
}

/**
 * A point `p` swung θ about a sail's luff (pivot, unit axis; as rig-sails.js
 * swungCE turns its CE) is at a distance from a fixed point X with
 * |p(θ) − X|² = A + B·cos θ + C·sin θ exactly: into out [A, B, C].
 */
export function swingCoeffs(out, pivot, axis, p, X) {
  const rx = p[0] - pivot[0], ry = p[1] - pivot[1], rz = p[2] - pivot[2];
  const d = rx * axis[0] + ry * axis[1] + rz * axis[2];
  const cx = rx - d * axis[0], cy = ry - d * axis[1], cz = rz - d * axis[2];
  const wx = axis[1] * cz - axis[2] * cy, wy = axis[2] * cx - axis[0] * cz, wz = axis[0] * cy - axis[1] * cx;
  const ex = pivot[0] + d * axis[0] - X[0], ey = pivot[1] + d * axis[1] - X[1], ez = pivot[2] + d * axis[2] - X[2];
  out[0] = ex * ex + ey * ey + ez * ez + cx * cx + cy * cy + cz * cz;
  out[1] = 2 * (ex * cx + ey * cy + ez * cz);
  out[2] = 2 * (ex * wx + ey * wy + ez * wz);
  return out;
}

/** The distance at θ from swingCoeffs' [A, B, C]. */
export const swingDist = (k, theta) => Math.sqrt(Math.max(0, k[0] + k[1] * Math.cos(theta) + k[2] * Math.sin(theta)));

/** The largest distance over θ ∈ [lo, hi] (exact: the ends, or where B·cos + C·sin peaks, if it's inside). */
export function maxSwingDist(k, lo, hi) {
  let m = Math.max(swingDist(k, lo), swingDist(k, hi));
  const peak = Math.atan2(k[2], k[1]);
  for (let j = -1; j <= 1; j++) {
    const p = peak + 2 * Math.PI * j;
    if (p > lo && p < hi) m = Math.max(m, swingDist(k, p));
  }
  return m;
}

const kS = new Float64Array(3);
const clewAt = new Float64Array(3);

/**
 * A sheet's slack (m) when the sail stands at θ and its sheet lets it go to
 * `limit` (≥ 0) on θ's side: how much the distance from the lead to the
 * sheet's point (swingCoeffs' k) varies between |θ| and limit, its total
 * variation. Where the distance grows steadily from |θ| to limit (the
 * mainsheet always; a jib sheet from its lead's own angle on), that is the
 * spec's L − d(θ), L = d(limit). Inside a lead's angle the distance first
 * shrinks, and L − d would read taut for a jib flogging amidships; the
 * variation counts that stretch too. So s > 0 exactly when |θ| < limit,
 * and s = 0 when it's pressed against its sheet (or past it), by
 * construction.
 */
export function sheetSlack(k, theta, limit) {
  const side = theta < 0 ? -1 : 1;
  const a0 = Math.abs(theta), a1 = Math.abs(limit);
  if (!(a0 < a1)) return 0;
  // where the distance turns (its largest and its least), as angles on this side
  const peak = Math.atan2(k[2], k[1]);
  let c1 = side * peak, c2 = side * (peak + Math.PI);
  c1 = Math.atan2(Math.sin(c1), Math.cos(c1));
  c2 = Math.atan2(Math.sin(c2), Math.cos(c2));
  const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
  let s = 0, at = a0, d = swingDist(k, side * a0);
  for (let j = 0; j < 3; j++) {
    const next = j === 0 ? lo : j === 1 ? hi : a1;
    if (!(next > at) || next > a1) continue;
    const dn = swingDist(k, side * next);
    s += Math.abs(dn - d);
    at = next;
    d = dn;
  }
  return s;
}

/**
 * The mainsheet's slack (m): its length is what reaches from the traveller
 * to the boom's sheet point when the boom is at its sheet's angle on the
 * side it's on (`limit`, rad ≥ 0), so s = L − d(θ) (sheetSlack: d grows
 * with |θ|, the traveller being aft of the mast on the centreline). s > 0
 * exactly when the boom stands inside its sheet (it's free, eased past
 * where its air puts it) and 0 when it's pressed against it.
 */
export function mainsheetSlack(main, theta, limit) {
  if (!main?.traveller) return 0;
  swingCoeffs(kS, main.pivot, main.axis, main.boom, main.traveller);
  return sheetSlack(kS, theta, limit);
}

/** A headsail's clew rolled to `furl` (rig-sails.js furledClew, in the body frame), into out. */
export function furledClewAt(out, jib, furl) {
  const t = jib.tack, h = jib.head, c = jib.clew;
  const lx = h[0] - t[0], ly = h[1] - t[1], lz = h[2] - t[2];
  const ll = lx * lx + ly * ly + lz * lz || 1;
  const s = ((c[0] - t[0]) * lx + (c[1] - t[1]) * ly + (c[2] - t[2]) * lz) / ll;
  const fx = t[0] + s * lx, fy = t[1] + s * ly, fz = t[2] + s * lz;
  out[0] = fx + (c[0] - fx) * (1 - furl);
  out[1] = fy + (c[1] - fy) * (1 - furl);
  out[2] = fz + (c[2] - fz) * (1 - furl);
  return out;
}

/** A jib lead on one side ("port" | "starboard") at `furl`: its leads interpolated by furl, clamped to the track's ends; into out. */
export function leadAt(out, jib, side, furl) {
  const list = jib.leads[side];
  let i = 0;
  while (i < list.length - 2 && furl > list[i + 1].furl) i++;
  const a = list[i], b = list[Math.min(i + 1, list.length - 1)];
  const k = b.furl > a.furl ? Math.min(1, Math.max(0, (furl - a.furl) / (b.furl - a.furl))) : 0;
  for (let j = 0; j < 3; j++) out[j] = a.at[j] + (b.at[j] - a.at[j]) * k;
  return out;
}

/**
 * The jib's sheets (into out: { working: −1 | 1, port, starboard }, each
 * side's { lead: [x, y, z], s } in the body frame): the working sheet is on
 * the clew's side (sign θ; starboard at 0), its length what reaches the
 * clew at its sheet's angle (sheetSlack); the lazy sheet's length
 * is the most the clew is ever from its lead over the jib's whole travel at
 * this furl, so its s ≥ 0 by construction.
 */
export function jibSheets(out, jib, theta, limit, furl) {
  const working = theta < 0 ? -1 : 1;
  out.working = working;
  furledClewAt(clewAt, jib, furl);
  for (let side = -1; side <= 1; side += 2) {
    const name = side < 0 ? "port" : "starboard";
    const o = out[name] ?? (out[name] = { lead: [0, 0, 0], s: 0 });
    leadAt(o.lead, jib, name, furl);
    swingCoeffs(kS, jib.pivot, jib.axis, clewAt, o.lead);
    o.s = side === working ? sheetSlack(kS, theta, limit) : Math.max(0, maxSwingDist(kS, -jib.travel, jib.travel) - swingDist(kS, theta));
  }
  return out;
}

/**
 * A parabola's arc length over chord d with sagitta h (exact):
 * ½√(d² + 16h²) + d²/(8h)·asinh(4h/d).
 */
export const arcLength = (d, h) => (h > 0 ? 0.5 * Math.sqrt(d * d + 16 * h * h) + ((d * d) / (8 * h)) * Math.asinh((4 * h) / d) : d);

/**
 * How far a rope of slack `s` over chord `d` sags (the sagitta h of the
 * parabola whose arc is d + s): solved by bisection on arcLength (40
 * steps, so monotone in s), from the small-sag estimate √(3ds/8)'s
 * neighbourhood; capped at (d + s)/2.
 */
export function sagOf(d, s) {
  if (!(s > 0) || !(d > 0)) return 0;
  const target = d + s;
  let lo = 0, hi = target / 2;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2;
    if (arcLength(d, m) < target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * A sheet from a to b with slack s (m), into out at o (n points, xyz): a
 * parabola in the vertical plane through a–b, sagging toward `down` (unit,
 * world): p(u) = a + u(b − a) + 4h·u(1 − u)·down⊥, down⊥ the part of down
 * square to the chord. s = 0 is a straight line. `floor` (world y, along
 * −down; none by default): the sag stops where any of its points would go
 * below it, as a lazy sheet's slack lies on the deck rather than through
 * her hull. Returns h.
 */
export function sheetCurve(out, o, a, b, s, down, n = 16, floor = -Infinity) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const d = Math.hypot(dx, dy, dz);
  let px = 0, py = 0, pz = 0, h = 0;
  if (d > 1e-9 && s > 0) {
    const along = (down[0] * dx + down[1] * dy + down[2] * dz) / d;
    px = down[0] - (along * dx) / d;
    py = down[1] - (along * dy) / d;
    pz = down[2] - (along * dz) / d;
    const l = Math.hypot(px, py, pz);
    if (l > 1e-6) {
      px /= l;
      py /= l;
      pz /= l;
      h = sagOf(d, s);
      // no lower than the floor: the most sag each point allows (its height above the floor over how far it sags per unit h)
      const fall = -py; // how far a point drops per unit of 4h·u(1 − u)
      if (floor > -Infinity && fall > 1e-9) {
        for (let i = 1; i < n - 1; i++) {
          const u = i / (n - 1);
          const above = a[1] + dy * u - floor;
          h = Math.min(h, Math.max(0, above) / (4 * u * (1 - u) * fall));
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const k = 4 * h * u * (1 - u);
    out[o + 3 * i] = a[0] + dx * u + k * px;
    out[o + 3 * i + 1] = a[1] + dy * u + k * py;
    out[o + 3 * i + 2] = a[2] + dz * u + k * pz;
  }
  return h;
}

// ─── the cloth's flutter and the telltales (pure) ──────────────────────────

/**
 * The flutter's amplitude (m) and frequency (Hz), into out: amp =
 * min(0.08·foot, ½·s + 0.02), as far as the slack sheet lets the clew go;
 * freq = clamp(√(2q/ρ) / (2·foot), 0.5, 4), the air's speed over twice the
 * foot.
 */
export function flutterOf(out, foot, q, s, rho = 1.225) {
  out.amp = Math.min(0.08 * foot, 0.5 * Math.max(0, s) + 0.02);
  out.freq = clamp(Math.sqrt((2 * Math.max(0, q)) / rho) / (2 * Math.max(foot, 1e-3)), 0.5, 4);
  return out;
}

/** How far a telltale lifts off its cloth when its side's flow fails (rad, at flog 1). */
export const TELLTALE_LIFT = 80 * DEG;

/**
 * A telltale's state, into out: `lift` (rad: lifted off the cloth and
 * spinning) and `curl` (0..1: curled forward and down). The windward one
 * lifts by trim.luff·80° (its flow fails as the luff lifts: from fully
 * drawing down to the luff's onset); the leeward one curls by σ (its flow
 * separates). A backed or goose-winged sail's flow on its back is
 * separated, so both sides follow σ.
 */
export function telltaleOf(out, trim, windward) {
  const back = trim.state === "backed" || trim.state === "wing";
  out.lift = windward && !back ? trim.luff * TELLTALE_LIFT : 0;
  out.curl = windward && !back ? 0 : trim.sigma;
  return out;
}

/** Is a telltale (telltaleOf's) streaming: lying along the cloth, neither lifted nor curled? */
export const streaming = (tt) => tt.lift <= STREAM.lift * TELLTALE_LIFT && tt.curl < STREAM.curl;

/**
 * A two-segment telltale ribbon from p, into out at o (3 points): streaming
 * along `a` (unit, aft along the cloth), lifted toward `n` (unit, out from
 * the cloth on its side) by `lift` and spun about `a` by `spin`, curled
 * toward `c` (unit) by `curl` (the first segment a quarter turn at 1, the
 * second half a turn: back the way it came). `len` its length (m).
 */
export function ribbon(out, o, p, a, n, c, len, lift, curl, spin) {
  out[o] = p[0];
  out[o + 1] = p[1];
  out[o + 2] = p[2];
  for (let k = 1; k <= 2; k++) {
    const L = lift * (k === 1 ? 1 : 1.6);
    const C = (curl * Math.PI) / (k === 1 ? 2 : 1);
    const sp = spin + (k === 1 ? 0 : 0.8);
    const cl = Math.cos(L), sl = Math.sin(L), cc = Math.cos(C), sc = Math.sin(C), cs = Math.cos(sp), ss = Math.sin(sp);
    let dx = cl * (cc * a[0] + sc * c[0]) + sl * (cs * n[0] + ss * c[0]);
    let dy = cl * (cc * a[1] + sc * c[1]) + sl * (cs * n[1] + ss * c[1]);
    let dz = cl * (cc * a[2] + sc * c[2]) + sl * (cs * n[2] + ss * c[2]);
    const l = Math.hypot(dx, dy, dz) || 1;
    const q = o + 3 * k, b = o + 3 * (k - 1);
    out[q] = out[b] + ((0.5 * len) / l) * dx;
    out[q + 1] = out[b + 1] + ((0.5 * len) / l) * dy;
    out[q + 2] = out[b + 2] + ((0.5 * len) / l) * dz;
  }
  return out;
}

// ─── the masthead's vane and the burgee (pure) ─────────────────────────────

/**
 * The air at the masthead (world, into out [x, y, z]): the true wind there
 * (`tw`, wind.at's [vx, vz]) less her own motion at it, v + ω × r (v, ω her
 * velocity and spin, world; r the masthead from where v is measured).
 */
export function mastheadAir(out, tw, v, w, r) {
  out[0] = tw[0] - (v[0] + w[1] * r[2] - w[2] * r[1]);
  out[1] = -(v[1] + w[2] * r[0] - w[0] * r[2]);
  out[2] = tw[1] - (v[2] + w[0] * r[1] - w[1] * r[0]);
  return out;
}

/**
 * Where the vane says the air comes from (rad, + from starboard, 0 dead
 * ahead): atan2(−u_x, u_z) of the air in her body's x–z (m: her body's
 * world matrix, column major, any scale), as the sails' `from` is.
 */
export function vaneAngle(air, m) {
  const lx = Math.hypot(m[0], m[1], m[2]) || 1, lz = Math.hypot(m[8], m[9], m[10]) || 1;
  const ux = (air[0] * m[0] + air[1] * m[1] + air[2] * m[2]) / lx;
  const uz = (air[0] * m[8] + air[1] * m[9] + air[2] * m[10]) / lz;
  return Math.atan2(-ux, uz);
}

/**
 * The vane at `at` (world), into out at o: three segments (the shaft, two
 * barbs), pointing into the air across her mast (her body's x–z, so her
 * heel swings it), `len` long. Still air: it lies along her bow.
 */
export function vaneLines(out, o, at, air, m, len = 0.5) {
  const lx = Math.hypot(m[0], m[1], m[2]) || 1, lz = Math.hypot(m[8], m[9], m[10]) || 1;
  const ux = (air[0] * m[0] + air[1] * m[1] + air[2] * m[2]) / lx;
  const uz = (air[0] * m[8] + air[1] * m[9] + air[2] * m[10]) / lz;
  let bx = -ux, bz = -uz;
  const l = Math.hypot(bx, bz);
  if (l > 1e-9) (bx /= l), (bz /= l);
  else (bx = 0), (bz = -1);
  // into the air, in the world: its body x and z axes
  const dx = (bx * m[0]) / lx + (bz * m[8]) / lz, dy = (bx * m[1]) / lx + (bz * m[9]) / lz, dz = (bx * m[2]) / lx + (bz * m[10]) / lz;
  // across it, level in her body (x–z), for the barbs
  const sx = (-bz * m[0]) / lx + (bx * m[8]) / lz, sy = (-bz * m[1]) / lx + (bx * m[9]) / lz, sz = (-bz * m[2]) / lx + (bx * m[10]) / lz;
  const h = 0.5 * len;
  const tipx = at[0] + h * dx, tipy = at[1] + h * dy, tipz = at[2] + h * dz;
  out[o] = at[0] - h * dx;
  out[o + 1] = at[1] - h * dy;
  out[o + 2] = at[2] - h * dz;
  const b = 0.3 * h;
  for (let i = 1; i < 6; i++) {
    const q = o + 3 * i;
    // the shaft's tip, then each barb from the tip back and out to one side
    const s = i === 3 ? 1 : i === 5 ? -1 : 0;
    const back = s === 0 ? 0 : b;
    out[q] = tipx - back * dx + s * b * sx;
    out[q + 1] = tipy - back * dy + s * b * sy;
    out[q + 2] = tipz - back * dz + s * b * sz;
  }
  return Math.atan2(-ux, uz);
}

/**
 * The true-wind burgee at `at` (world), into out at o: two segments
 * streaming down the true wind (`tw`: [vx, vz]) only, drooping a little;
 * hanging straight down in a calm. A reading aid, off unless asked.
 */
export function burgeeLines(out, o, at, tw, len = 0.45) {
  const s = Math.hypot(tw[0], tw[1]);
  const droop = s > 0.2 ? Math.atan2(1, s) * 0.5 : Math.PI / 2;
  const hx = s > 0.2 ? tw[0] / s : 0, hz = s > 0.2 ? tw[1] / s : 0;
  const cx = Math.cos(droop), sy = -Math.sin(droop);
  const seg = 0.5 * len;
  out[o] = at[0];
  out[o + 1] = at[1];
  out[o + 2] = at[2];
  out[o + 3] = out[o + 6] = at[0] + seg * cx * hx;
  out[o + 4] = out[o + 7] = at[1] + seg * sy;
  out[o + 5] = out[o + 8] = at[2] + seg * cx * hz;
  out[o + 9] = out[o + 6] + seg * cx * hx;
  out[o + 10] = out[o + 7] + seg * sy * 1.4;
  out[o + 11] = out[o + 8] + seg * cx * hz;
  return out;
}
