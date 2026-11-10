// The rig aid's contract (`extras.rig`, patchwork-rig v1), read into
// sailing's body frame (DESIGN.md, "The rig contract"). Pure.
//
// The contract (naval/contract/v1/specification.md, copied in no part: this
// package reads the JSON it states) is in its own frame: x forward, y port,
// z up, metres, the design waterplane at z = 0, upright. Sailing's body
// frame is x starboard, y up, z aft, about the same origin, so a contract
// point (x, y, z) is the body's (−y, z, −x) (§2). `frame.glbToFrame` takes
// the hull's glTF coordinates (the rig GLB's are the same) into the
// contract's, so the body frame in the hull object's is
// inverse(glbToFrame) · (body → contract).
//
// Everything here is gated on a contract being present: a hull or rig
// without `extras.rig` never reaches this module, and sails as it did.

import { eulerFromQuat, invert, multiply, poseOfMatrix } from "./frames.js";
import { meshVolumeBelow } from "./hull-model.js";

export const RIG_FORMAT = "patchwork-rig";
export const RIG_VERSION = 1;

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const tidy = (x) => Math.round(x * 1e9) / 1e9 + 0;

/** The body → contract rotation, column-major: body x → −y_c, body y → z_c, body z → −x_c. */
const BODY_TO_CONTRACT = Object.freeze([0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1]);

/**
 * A contract point (x forward, y port, z up) in the body frame (x starboard,
 * y up, z aft), times `k`: (−y, z, −x)·k.
 */
export const toBody = (p, k = 1) => [-p[1] * k + 0, p[2] * k + 0, -p[0] * k + 0];

/** A body point back in the contract's frame (toBody's inverse). */
export const toContract = (p, k = 1) => [-p[2] / k + 0, -p[0] / k + 0, p[1] / k + 0];

/**
 * The contract in a GLB's extras, if it is one sailing can read: v1, with a
 * frame matrix, a positive mass and a hull. Else null.
 */
export function rigContract(extrasRig) {
  const c = extrasRig;
  if (!c || c.format !== RIG_FORMAT || c.version !== RIG_VERSION) return null;
  const m = c.frame?.glbToFrame;
  if (!Array.isArray(m) || m.length !== 16 || !m.every(Number.isFinite)) return null;
  if (!(c.loading?.massKg > 0) || !isVec3(c.loading?.cgM) || !c.hull) return null;
  return c;
}

/**
 * Where her body frame sits in her hull object's frame, by the contract
 * ({ position, rotation }, as body.js's frames): inverse(glbToFrame) ·
 * (body → contract). The rig's own placement doesn't move it: the contract
 * states where everything is on the hull, with the rig at the identity.
 */
export function rigFrame(contract) {
  const m = multiply(invert(contract.frame.glbToFrame), BODY_TO_CONTRACT);
  const { position, quaternion } = poseOfMatrix(m);
  return { position: position.map(tidy), rotation: eulerFromQuat(quaternion).map(tidy) };
}

/** A doc URL without its heads. */
export const docOf = (url) => (typeof url === "string" ? url.split("#")[0] : null);

/** A scene file key's family: "sailing/hull@3" → "sailing/hull" (parts.js fileKey). */
export const keyFamily = (key) => (typeof key === "string" ? key.replace(/@[^@/]*$/, "") : null);

/**
 * Does a synthetic-hull contract name the hull family it describes
 * (`source.hull.glbKey`, as the stock sloop's does: "sailing/hull")? Such a
 * contract is that hull's alone.
 */
const namesItsHull = (contract) => contract?.source?.hull?.kind === "synthetic" && typeof contract.source.hull.glbKey === "string" && !!contract.source.hull.glbKey;

/**
 * The contract on a rig, if this ship takes it: `rigContract`, and, for one
 * that names the hull family it describes (namesItsHull: the stock sloop's),
 * only on a hull whose file is of that family (`hullKey`: the scene's
 * doc.assets key for the hull object's file, body.js hullKeyOf). On any
 * other hull it describes someone else's boat, so it isn't taken: the rig
 * is read by its plain `extras.sail.plan`, as before the contract existed.
 * A rig-aid contract (no glbKey) is taken anywhere, with checkSource's warning.
 */
export function contractOn(extrasRig, hullKey = null) {
  const c = rigContract(extrasRig);
  if (!c) return null;
  if (namesItsHull(c) && keyFamily(hullKey) !== c.source.hull.glbKey) return null;
  return c;
}

/**
 * The contract's warnings about the hull it's on (§3.2): a rig designed on
 * a linked hull put on another, or one designed on a synthetic hull put on
 * a drawn one. `hullUrl` is the hull object's document (its sourceUrl);
 * nothing to check without it. A synthetic-hull contract that names her
 * hull's family (`hullKey`'s) describes her: nothing to say.
 * @returns {string[]}
 */
export function checkSource(contract, hullUrl, hullKey = null) {
  const h = contract?.source?.hull;
  if (!h || !hullUrl) return [];
  if (h.kind === "linked" && h.url && docOf(h.url) !== docOf(hullUrl)) {
    return [`This rig was designed on another hull (${h.label ?? h.url}), not the one it's on: its physics are that hull's.`];
  }
  if (h.kind === "synthetic") {
    if (namesItsHull(contract) && keyFamily(hullKey) === h.glbKey) return [];
    return ["This rig was designed on a synthetic hull from principal dimensions, not the hull it's on: its physics are the synthetic hull's."];
  }
  return [];
}

/** Is a matrix the identity, to a hair? */
const isIdentityMatrix = (m) => !m || m.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6);

// ─── the contract in the body frame ──────────────────────────────────────

const pts = (list, k) => (Array.isArray(list) ? list.map((p) => toBody(p, k)) : list);

function bodyAppendage(a, k) {
  const c = a.cornersM ?? {};
  return {
    id: a.id,
    kind: a.kind,
    cornersM: Object.fromEntries(Object.entries(c).map(([key, p]) => [key, toBody(p, k)])),
    spanM: a.spanM * k,
    rootChordM: a.rootChordM * k,
    tipChordM: a.tipChordM * k,
    sweepDeg: a.sweepDeg,
    sweepHalfDeg: a.sweepHalfDeg,
    tc: a.tc,
    taper: a.taper,
    areaM2: a.areaM2 * k * k,
    macM: a.macM * k,
    qcM: toBody(a.qcM, k),
    arGeom: a.arGeom,
    endPlateFactor: a.endPlateFactor,
    arEff: a.arEff,
    liftSlope: a.liftSlope,
    clMax: a.clMax,
    stallDeg: a.stallDeg,
    volumeM3: a.volumeM3 * k * k * k,
    volumeCentroidM: toBody(a.volumeCentroidM, k),
    bulb: a.bulb ? { lengthM: a.bulb.lengthM * k, diameterM: a.bulb.diameterM * k, centreM: toBody(a.bulb.centreM, k), volumeM3: a.bulb.volumeM3 * k * k * k } : null,
    maxDeg: a.stock?.maxDeg ?? null,
    stock: a.stock ? { axisM: pts(a.stock.axisM, k), bearingM: toBody(a.stock.bearingM, k), deckM: toBody(a.stock.deckM, k), balanceFrac: a.stock.balanceFrac, maxDeg: a.stock.maxDeg } : null,
  };
}

function bodySail(s, k) {
  const sh = s.sheeting ?? {};
  return {
    id: s.id,
    kind: s.kind,
    model: s.model,
    polygonM: pts(s.polygonM, k),
    areaM2: s.areaM2 * k * k,
    ceM: toBody(s.ceM, k),
    tackM: toBody(s.tackM, k),
    headM: toBody(s.headM, k),
    clewM: toBody(s.clewM, k),
    luffM: s.luffM * k,
    footM: s.footM * k,
    ar: s.ar,
    liftSlope: s.liftSlope,
    reefs: (s.reefs ?? []).map((r) => ({ fraction: r.fraction, polygonM: pts(r.polygonM, k), areaM2: r.areaM2 * k * k, ceM: toBody(r.ceM, k), luffM: r.luffM * k })),
    furl: s.furl,
    sheeting: {
      minDeg: sh.minDeg,
      maxDeg: sh.maxDeg,
      wing: sh.wing ?? null,
      boom: sh.boom ? { gooseneckM: toBody(sh.boom.gooseneckM, k), endM: toBody(sh.boom.endM, k), lengthM: sh.boom.lengthM * k } : null,
      // a contract's port lead (y > 0) is the body's −x
      lead: sh.lead ? { port: toBody(sh.lead.port, k), starboard: toBody(sh.lead.starboard, k) } : null,
    },
    coeffs: s.coeffs,
  };
}

/**
 * What hull-model.js needs to build the canoe body the contract describes
 * (§3.3), in the contract's own axes about mid-LWL (x forward, y port, z up)
 * at scale `k`: LWL, BWL, Tc, ∇, Cp, Cm, the LCB as a fraction of LWL from
 * mid-LWL, the stem's and stern's x, the sheer's height, the overall beam,
 * the waterplane's transverse inertia (BM·∇), the wetted skin, and where
 * mid-LWL is (`xMid`, contract x). Null when the contract's hull can't say.
 */
function hullForm(H, k) {
  const need = [H.lwlM, H.bwlM, H.tcM, H.volumeM3, H.cp, H.cm, H.lcbM, H.xFwdM, H.xAftM];
  if (!need.every(Number.isFinite) || !(H.lwlM > 0 && H.bwlM > 0 && H.tcM > 0 && H.volumeM3 > 0 && H.cp > 0 && H.cm > 0)) return null;
  const xMid = (H.xFwdM + H.xAftM) / 2;
  const sheer = [H.stemheadM?.[2], H.sternM?.[2]].filter(Number.isFinite);
  const bm = Number.isFinite(H.zMetacentreM) && Number.isFinite(H.vcbM) ? H.zMetacentreM - H.vcbM : NaN;
  return {
    prov: H.prov ?? "mesh",
    lwl: H.lwlM * k,
    bwl: H.bwlM * k,
    tc: H.tcM * k,
    volume: H.volumeM3 * k * k * k,
    cp: H.cp,
    cm: H.cm,
    lcbFrac: (H.lcbM - xMid) / H.lwlM,
    xMid: xMid * k,
    xStem: (Number.isFinite(H.stemheadM?.[0]) ? H.stemheadM[0] - xMid : H.lwlM / 2) * k,
    xStern: (Number.isFinite(H.sternM?.[0]) ? H.sternM[0] - xMid : -H.lwlM / 2) * k,
    freeboard: (sheer.length ? sheer.reduce((a, b) => a + b, 0) / sheer.length : 0.1 * H.lwlM) * k,
    beam: (H.beamM ?? H.bwlM) * k,
    inertiaT: bm > 0 ? bm * H.volumeM3 * k ** 4 : NaN,
    wsa: (H.wsaM2 ?? NaN) * k * k,
  };
}

/**
 * The contract as the physics reads it: every point in the body frame,
 * lengths, areas, volumes and masses at the hull object's scale `k`
 * (geometry ×k, areas ×k², volumes and masses ×k³). The contract's field
 * names are kept; what isn't geometry (coefficients, the sail model, the
 * trimmed and resistance tables, the righting curve) is the contract's own,
 * by reference. `gyradiiM` is in body axes: [pitch (x), yaw (y), roll (z)].
 * `warnings` says where it can't be trusted as is.
 */
export function bodyRig(contract, k = 1, { matrix = null, hullUrl = null, hullKey = null, mesh = null } = {}) {
  const c = contract;
  const L = c.loading;
  const H = c.hull;
  const g = L.gyradiiM;
  const source = checkSource(c, hullUrl, hullKey);
  const warnings = [...source];
  const form = hullForm(H, k);
  const drawn = form && !source.length && c.source?.hull?.kind === "linked" ? drawnHull(c, mesh, k, form, warnings) : null;
  if (Math.abs(k - 1) > 1e-6) warnings.push(`The rig's contract is stated at the hull's drawn size; she is drawn ×${+k.toFixed(4)}, so its tables (forces, moments) don't hold as stated.`);
  if (!isIdentityMatrix(matrix)) warnings.push("The rig isn't where its contract put it (at the identity on her hull): the physics take the contract's places.");
  return {
    name: c.name,
    serial: contractSerial(c),
    scale: k,
    warnings,
    source: c.source?.hull ?? null,
    massKg: L.massKg * k * k * k,
    cgM: toBody(L.cgM, k),
    gyradiiM: isVec3(g) ? [g[1] * k, g[2] * k, g[0] * k] : null,
    crew: L.crew
      ? {
          count: L.crew.count,
          kgEach: L.crew.kgEach * k * k * k,
          mode: L.crew.mode,
          massKg: L.crew.massKg * k * k * k,
          armM: L.crew.armM * k,
          // windward, on the contract's starboard (y > 0); mirrored on the other tack
          stations: (L.crew.stations ?? []).map((s) => ({ side: s.side, atM: toBody(s.atM, k) })),
        }
      : null,
    righting: L.righting,
    heelLimitDeg: L.heelLimitDeg,
    mesh: drawn,
    hull: {
      loaM: H.loaM * k,
      beamM: H.beamM * k,
      lwlM: H.lwlM * k,
      bwlM: H.bwlM * k,
      tcM: H.tcM * k,
      // the waterline's ends: forward is −z
      bowZM: -H.xFwdM * k,
      sternZM: -H.xAftM * k,
      volumeM3: H.volumeM3 * k * k * k,
      wsaM2: H.wsaM2 * k * k,
      lcbM: toBody([H.lcbM, 0, H.vcbM], k),
      stemheadM: toBody(H.stemheadM, k),
      sternM: toBody(H.sternM, k),
      keelYM: H.keelZM * k,
      lateral: H.lateral ? { areaM2: H.lateral.areaM2 * k * k, centroidM: toBody(H.lateral.centroidM, k) } : null,
      sideForce: H.sideForce ? { yv: H.sideForce.yv, nv: H.sideForce.nv, lwlM: H.sideForce.lwlM * k, midZM: -H.sideForce.xMidM * k, atM: toBody(H.sideForce.atM, k) } : null,
      dsyhs: H.dsyhs,
      form,
    },
    appendages: (c.appendages ?? []).map((a) => bodyAppendage(a, k)),
    sails: (c.sails ?? []).map((s) => bodySail(s, k)),
    sailModel: c.sailModel,
    sets: (c.sets ?? []).map((s) => ({ id: s.id, reef: s.reef, sails: s.sails, areaM2: s.areaM2 * k * k, ceM: toBody(s.ceM, k), heM: s.heM * k, are: s.are, trimmed: s.trimmed })),
    resistance: c.resistance,
    lumpedSail: c.lumpedSail ? { tackM: toBody(c.lumpedSail.tackM, k), luffM: c.lumpedSail.luffM * k, footM: c.lumpedSail.footM * k, areaM2: c.lumpedSail.areaM2 * k * k, ceM: toBody(c.lumpedSail.ceM, k) } : null,
  };
}

/**
 * Her drawn hull, for her buoyancy columns (hull-model.js), when the rig was
 * designed on it: `mesh` is the hull object's triangles (9 numbers each) in
 * its GLB's coordinates (sim.js hullTriangles), taken through glbToFrame into
 * the contract's frame and on into the body's at scale `k`. It's used only
 * if below the contract's waterplane it displaces the contract's ∇ to 5%:
 * otherwise it isn't the hull the contract measured (another hull, another
 * scale, an open mesh), which `warnings` says, and she floats on the
 * contract's description of it instead.
 * @returns {{ triangles: Float64Array, volume: number } | null}
 */
function drawnHull(c, mesh, k, form, warnings) {
  if (!mesh || !(mesh.length >= 9)) return null;
  const m = c.frame.glbToFrame;
  const tri = new Float64Array(mesh.length - (mesh.length % 9));
  for (let i = 0; i < tri.length; i += 3) {
    const x = mesh[i], y = mesh[i + 1], z = mesh[i + 2];
    // through glbToFrame (column-major), then (x, y, z) → (−y, z, −x)·k
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
    tri[i] = -cy * k + 0;
    tri[i + 1] = cz * k + 0;
    tri[i + 2] = -cx * k + 0;
  }
  const volume = meshVolumeBelow(tri);
  if (!(Math.abs(volume / form.volume - 1) <= 0.05)) {
    warnings.push(`Her drawn hull displaces ${volume.toFixed(3)} m³ below the contract's waterline, not its ${form.volume.toFixed(3)} m³: she floats on the contract's description of her hull instead.`);
    return null;
  }
  return { triangles: tri, volume };
}

/**
 * The parts of a ship's spec (hull-model.js) the contract fills, in the
 * body frame at scale `k`, before the trait's overrides: her waterline's
 * length and her beam, draft and freeboard (the box today's columns are
 * built over), her mass, her centre of gravity's height, her lumped sail
 * (§6.8), the keel's and rudder's areas where their quarter chords are (and
 * the rudder's travel, `maxDeg`), and
 * `rig`, the whole contract in the body frame (bodyRig) for the physics
 * that reads it. The box is the waterline's: from her bow's waterline
 * ending to her stern's, the overall beam across, from the deepest foil to
 * the sheer.
 */
export function rigSpecParts(contract, k = 1, o = {}) {
  // once per contract, scale, placement and hull: sim.js asks every frame
  const key = `${k}|${isIdentityMatrix(o.matrix ?? null)}|${o.hullUrl ?? ""}|${o.hullKey ?? ""}|${o.mesh ? meshSerial(o.mesh) : ""}`;
  let byKey = parts.get(contract);
  if (!byKey) parts.set(contract, (byKey = new Map()));
  let out = byKey.get(key);
  if (!out) {
    if (byKey.size > 8) byKey.clear();
    byKey.set(key, (out = specParts(contract, k, o)));
  }
  return out;
}

const parts = new WeakMap();
const meshes = new WeakMap();
let nextMesh = 0;
/** A drawn hull's triangles' name for the spec's key: the same array, the same name. */
function meshSerial(mesh) {
  let n = meshes.get(mesh);
  if (n == null) meshes.set(mesh, (n = ++nextMesh));
  return n;
}

function specParts(contract, k, o) {
  const rig = bodyRig(contract, k, o);
  const H = rig.hull;
  const keel = rig.appendages.find((a) => a.id === "keel") ?? null;
  const rudder = rig.appendages.find((a) => a.id === "rudder") ?? null;
  let bottom = H.keelYM;
  for (const a of rig.appendages) for (const p of Object.values(a.cornersM)) bottom = Math.min(bottom, p[1]);
  for (const a of rig.appendages) if (a.bulb) bottom = Math.min(bottom, a.bulb.centreM[1] - a.bulb.diameterM / 2);
  const sheer = (H.stemheadM[1] + H.sternM[1]) / 2;
  const box = { min: [-H.beamM / 2, bottom, H.bowZM], max: [H.beamM / 2, Math.max(0.1 * k, sheer), H.sternZM] };
  const own = { mass: rig.massKg, cg: rig.cgM[1], rig };
  const ls = rig.lumpedSail;
  if (ls) own.sail = { area: ls.areaM2, luff: ls.luffM, foot: ls.footM, tack: ls.tackM };
  own.keel = keel ? { area: keel.areaM2, depth: -keel.qcM[1], z: keel.qcM[2] } : { area: 0, depth: 0 };
  own.rudder = rudder ? { area: rudder.areaM2, at: rudder.qcM, ...(Number.isFinite(rudder.maxDeg) ? { maxDeg: rudder.maxDeg } : null) } : { area: 0, at: [0, bottom, H.sternZM] };
  return { box, own };
}

// ─── a key for the spec ─────────────────────────────────────────────────

const serials = new WeakMap();
const byPrint = new Map();
let nextSerial = 0;

/** FNV-1a over a string, 32 bits twice: a fingerprint, not a security. */
function fingerprint(s) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    a = Math.imul(a ^ ch, 0x01000193);
    b = Math.imul(b ^ ch, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}.${s.length}`;
}

/** What a spec's `rig` contributes to sim.js's key for her physics: which contract, at what scale, saying what. */
export const rigKey = (rig) => `rig#${rig.serial}@${rig.scale}${rig.mesh ? `/hull#${meshSerial(rig.mesh)}` : ""}:${rig.warnings.join("|")}`;

/**
 * A short, stable name for a contract: the same object, or an equal one,
 * always gets the same. sim.js keys a ship's physics on her spec, and a
 * contract is too big to stringify every frame.
 */
export function contractSerial(contract) {
  let n = serials.get(contract);
  if (n == null) {
    const fp = fingerprint(JSON.stringify(contract));
    n = byPrint.get(fp);
    if (n == null) byPrint.set(fp, (n = ++nextSerial));
    serials.set(contract, n);
  }
  return n;
}
