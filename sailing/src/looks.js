// What each view dresses for itself, from what it shows, with no hold and
// nothing sent (DESIGN.md, "Play"; STAGE.md, "dressing content";
// "Trim feedback" §4): whatever floats bobs and tilts on the waves where
// it's moored, and each ship's sails are drawn as her physics flies them:
// the cloth (cloth.js) bellied, twisted, flogging, reefed or furled by its
// trim (trim.js), the mainsheet and the jib's sheets slack or taut (a rope
// with a body round each line, which stays a pixel wide when that's thinner), the
// telltales streaming or not, the masthead's vane and an optional burgee.
// Every one is a function of the physics' read and the stations' values:
// there's no state here that could disagree with the forces. A rig with no
// cloth (one the rig aid made) keeps the old dressing: scaled across by
// how full it is, lowered toward the boom. Only nodes inside the content of
// objects sailing's own traits mark are touched, and each is put back on
// dispose. The maths is pure and exported; createLooks is the stage side;
// its per-frame path writes into buffers it made when it started dressing.

import { SAIL_LUFF } from "./physics-foils.js";
import { scaleOf, unrotateM } from "./frames.js";
import { FLOAT, SHIP, WINCH } from "./traits.js";
import { bodyOf, frameMatrix, rigContractOf, shipFrame } from "./body.js";
import { burgeeLines, flutterOf, jibSheets, mainsheetSlack, mastheadAir, rigGeometry, ribbon, sheetCurve, telltaleOf, trimOf, vaneLines } from "./trim.js";
import { FLAT, battenCount, battenVertices, clothCount, clothNormals, clothPoint, clothVertices } from "./cloth.js";
import { BUNT_R, JIB_FOIL_R } from "./ship.js";

export { FLAT };

const DEG = Math.PI / 180;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ─── floating (pure) ────────────────────────────────────────────────────────

/** A float's tilt follows this much of the water's slope (it has a keel weight and some inertia). */
export const FLOAT_TILT = 0.6;

/**
 * Where a float rides, in its own frame, for its world matrix `m` on `sea`
 * at `t`: an offset up to the surface over where it's moored, and a tilt
 * [rx, rz] (Euler, radians) toward the water's normal.
 * @returns {{ offset: number[], tilt: number[] }}
 */
export function floatPose(sea, m, t) {
  const [h, nx, ny, nz] = sea.sampleAt(m[12], m[14], t);
  const s = scaleOf(m);
  const n = unrotateM(m, [nx, ny, nz]);
  return {
    offset: unrotateM(m, [0, h, 0]).map((v) => v / s), // straight up by the water's height there
    tilt: [FLOAT_TILT * Math.atan2(n[2], n[1]), -FLOAT_TILT * Math.atan2(n[0], n[1])],
  };
}

// ─── the sail (pure) ────────────────────────────────────────────────────────

/**
 * Is the boom out to port, as drawn: the rig's aft-running axis (local +Z)
 * on the ship's port side (her body's −X)? From the ship's body frame and
 * the rig's world matrix, as displayed.
 */
export function boomToPort(hull, rig) {
  if (!hull || !rig) return false;
  return rig[8] * hull[0] + rig[9] * hull[1] + rig[10] * hull[2] < -1e-9;
}

/**
 * How full the sail is drawn, 0..1 (the rig's scale across), from what the
 * ship reads: flat while the wind runs along the boom (luffing), full once
 * it meets it a few degrees past the luff. A sail crossing the centreline
 * is luffing, so its belly passes through flat rather than snapping across.
 * @param {{ apparentWind?: { angle: number }, boom?: number } | null} read
 */
export function fullness(read) {
  if (!read?.apparentWind || !Number.isFinite(read.boom)) return 1;
  const aoa = Math.abs(Math.abs(read.apparentWind.angle) - Math.abs(read.boom));
  return Math.max(FLAT, smoothstep(SAIL_LUFF, SAIL_LUFF + 8 * DEG, aoa));
}


// ─── the stage side ─────────────────────────────────────────────────────────

/** Cosmetic constants (DESIGN.md "Trim feedback" §4): not thresholds. */
export const LOOK = Object.freeze({
  sheetPoints: 16,
  // a sheet's slack sags no lower than this under its lower end (its lead or traveller: the rest lies on deck)
  slackBelow: 0.05,
  telltale: { luff: 0.25, leech: 0.3, aft: 0.3, heights: [0.25, 0.5, 0.75], off: 0.01, spin: 2 },
  vane: 0.5,
  vaneAbove: 0.12,
  burgeeAbove: 2.5,
  winchTop: [0, 0.19, 0],
  // the sheets' rope: twice a real 12–14 mm sheet so it reads at a boat's length; a warm red shows against the sea, the sky, the sails and the teak
  rope: { radius: 0.015, sides: 6 },
  colors: { sheet: 0xc4452f, telltale: 0xc0392b, vane: 0x1d2226, burgee: 0xc0392b },
});

const DOWN = Object.freeze([0, -1, 0]);

/** A rope's triangles: `sides` quads round each of its n − 1 lengths, wound to face out of it (ropeTube's rings). */
export function ropeIndex(n, sides) {
  const out = [];
  for (let i = 0; i + 1 < n; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + ((j + 1) % sides), c = a + sides, d = b + sides;
      out.push(a, b, c, b, d, c);
    }
  return out;
}

/**
 * A rope of `radius` round the polyline pts (n points, xyz): a ring of `sides`
 * vertices at each point, square to the line there, into pos and its outward
 * normals into nrm. The rings are carried along the line without twisting
 * (each one's start is the last one's, made square to the new tangent), so it
 * reads as a rope however the line bends. Where the line has no length (not
 * drawn yet) it keeps the last tangent: never NaN.
 */
export function ropeTube(pos, nrm, pts, n, radius, sides) {
  let tx = 1, ty = 0, tz = 0; // the tangent
  let ux = 0, uy = 0, uz = 0; // the ring's start, square to it
  for (let i = 0; i < n; i++) {
    const p = 3 * Math.max(0, i - 1), q = 3 * Math.min(n - 1, i + 1);
    const dx = pts[q] - pts[p], dy = pts[q + 1] - pts[p + 1], dz = pts[q + 2] - pts[p + 2];
    const l = Math.hypot(dx, dy, dz);
    if (l > 1e-9) (tx = dx / l), (ty = dy / l), (tz = dz / l);
    // the last ring's start made square to this tangent; a fresh one off the axis least along it when that fails
    let k = ux * tx + uy * ty + uz * tz;
    let vx = ux - k * tx, vy = uy - k * ty, vz = uz - k * tz;
    let m = Math.hypot(vx, vy, vz);
    if (m < 1e-6) {
      const ax = Math.abs(tx), ay = Math.abs(ty), az = Math.abs(tz);
      const ex = ax <= ay && ax <= az ? 1 : 0, ey = ex ? 0 : ay <= az ? 1 : 0, ez = ex || ey ? 0 : 1;
      k = ex * tx + ey * ty + ez * tz;
      (vx = ex - k * tx), (vy = ey - k * ty), (vz = ez - k * tz);
      m = Math.hypot(vx, vy, vz);
    }
    (ux = vx / m), (uy = vy / m), (uz = vz / m);
    // w = t × u: a quarter turn on from u
    const wx = ty * uz - tz * uy, wy = tz * ux - tx * uz, wz = tx * uy - ty * ux;
    for (let j = 0; j < sides; j++) {
      const a = (2 * Math.PI * j) / sides, c = Math.cos(a), s = Math.sin(a);
      const nx = c * ux + s * wx, ny = c * uy + s * wy, nz = c * uz + s * wz;
      const o = 3 * (i * sides + j);
      nrm[o] = nx;
      nrm[o + 1] = ny;
      nrm[o + 2] = nz;
      pos[o] = pts[3 * i] + radius * nx;
      pos[o + 1] = pts[3 * i + 1] + radius * ny;
      pos[o + 2] = pts[3 * i + 2] + radius * nz;
    }
  }
  return pos;
}

/** a·b for column-major 4×4s, into out. */
function mul4(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[4 * c], b1 = b[4 * c + 1], b2 = b[4 * c + 2], b3 = b[4 * c + 3];
    for (let r = 0; r < 4; r++) out[4 * c + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
  }
  return out;
}

/** m·p (a point), into out at o. */
function apply4(out, o, m, x, y, z) {
  out[o] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

/** The meshes under a node (itself, if it is one), in order. */
function meshesOf(node) {
  const out = [];
  const visit = (n) => {
    if (!n) return;
    if (n.isMesh || n.geometry) out.push(n);
    for (const c of Array.isArray(n.children) ? n.children : []) visit(c);
  };
  visit(node);
  return out;
}

/** A mesh whose geometry has `count` vertices, with its own copy of the geometry (two sloops share a GLB). */
function ownGeometry(node, count) {
  if (!(count > 0)) return null;
  const mesh = meshesOf(node).find((m) => m.geometry?.attributes?.position?.count === count || m.geometry?.attributes?.position?.array?.length === count * 3);
  if (!mesh) return null;
  const original = mesh.geometry;
  const geometry = typeof original.clone === "function" ? original.clone() : original;
  mesh.geometry = geometry;
  // its bounds were the neutral cloth's; bellied the other way or flogging it goes outside them
  const culled = mesh.frustumCulled;
  mesh.frustumCulled = false;
  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal ?? null;
  // A one-sided sheet seen from both sides: three's shadow normal bias goes
  // along the normal without flipping it for the back face, so the side the
  // normals point away from would shade itself. It casts, and doesn't take
  // shadows (the stage keeps userData.receiveShadow: false across a toggle);
  // its own lighting already darkens the side away from the sun.
  const ud = mesh.userData ?? (mesh.userData = {});
  const received = { flag: ud.receiveShadow, on: mesh.receiveShadow };
  ud.receiveShadow = false;
  mesh.receiveShadow = false;
  return { mesh, original, geometry, pos, nrm, culled, received };
}

/**
 * @param {any} api
 * @param {{ sea, sim }} ctx
 */
export function createLooks(api, ctx) {
  const floatsOf = (scene) => (scene?.ids ?? []).filter((id) => scene.objects[id]?.traits?.[FLOAT]);
  let floats = floatsOf(api.scene?.());
  const moved = new Set(); // float roots this view has moved
  const THREE = api.THREE;
  const world = typeof api.world === "function" ? api.world() : null;
  const materials = THREE?.LineBasicMaterial
    ? {
        sheet: new THREE.LineBasicMaterial({ color: LOOK.colors.sheet }),
        telltale: new THREE.LineBasicMaterial({ color: LOOK.colors.telltale }),
        vane: new THREE.LineBasicMaterial({ color: LOOK.colors.vane }),
        burgee: new THREE.LineBasicMaterial({ color: LOOK.colors.burgee }),
        rope: THREE.MeshStandardMaterial ? new THREE.MeshStandardMaterial({ color: LOOK.colors.sheet, roughness: 0.8 }) : null,
      }
    : null;

  let scene = null; // the snapshot `rigs` was made for
  let rigs = []; // per ship: what's dressed
  const plain = new Map(); // rig root → its sail node, dressed the old way (no cloth)

  /** A line of n points (THREE.Line, or LineSegments), never picked, never culled; added under `parent`. */
  function lineOf(n, material, parent, segments = false) {
    if (!THREE?.BufferGeometry || !material || !parent) return null;
    const array = new Float32Array(3 * n);
    const geometry = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(array, 3);
    geometry.setAttribute("position", attr);
    const Kind = segments ? THREE.LineSegments : THREE.Line;
    if (!Kind) return null;
    const line = new Kind(geometry, material);
    line.frustumCulled = false;
    line.userData = { ...(line.userData ?? {}), noPick: true };
    line.raycast = () => {};
    parent.add?.(line);
    return { line, geometry, attr, array, parent };
  }

  /** A sheet: a line of n points with a rope round it (a child of the line, so it shows and goes with it). */
  function sheetOf(n, parent) {
    const l = lineOf(n, materials?.sheet, parent);
    if (!l || !materials?.rope || !THREE.Mesh) return l;
    const { sides } = LOOK.rope;
    const geometry = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(3 * n * sides), 3);
    const nrm = new THREE.BufferAttribute(new Float32Array(3 * n * sides), 3);
    geometry.setAttribute("position", pos);
    geometry.setAttribute("normal", nrm);
    geometry.setIndex(ropeIndex(n, sides));
    const mesh = new THREE.Mesh(geometry, materials.rope);
    mesh.frustumCulled = false;
    mesh.userData = { ...(mesh.userData ?? {}), noPick: true };
    mesh.raycast = () => {};
    l.line.add?.(mesh);
    l.rope = { mesh, geometry, pos, nrm, n };
    return l;
  }

  /** A sheet's line has moved: its rope follows. */
  function laid(l) {
    l.attr.needsUpdate = true;
    if (!l.rope) return;
    ropeTube(l.rope.pos.array, l.rope.nrm.array, l.array, l.rope.n, LOOK.rope.radius, LOOK.rope.sides);
    l.rope.pos.needsUpdate = l.rope.nrm.needsUpdate = true;
  }

  /** Everything one ship's dressing needs, made once (null parts where she has no such thing). */
  function setup(ship) {
    const st = ctx.sim.stationsOf(ship);
    const rec = { ship, rigId: st.sail, jibId: st.jib, winches: { port: null, starboard: null }, pending: false, lines: [], restore: [] };
    for (const w of st.winches ?? []) {
      const side = scene.objects[w]?.traits?.[WINCH]?.side;
      if ((side === "port" || side === "starboard") && !rec.winches[side]) rec.winches[side] = w;
    }
    const rigC = st.sail ? api.content(st.sail) : null;
    const jibC = st.jib ? api.content(st.jib) : null;
    if ((st.sail && !rigC?.root) || (st.jib && !jibC?.root)) rec.pending = true;
    rec.rigRoot = rigC?.root ?? null;
    rec.burgee = !!scene.objects[ship]?.traits?.[SHIP]?.burgee;
    // the contract's geometry, in the body frame, and the body → hull-object matrix
    const contract = st.sail ? rigContractOf(api, ship) : null;
    rec.geo = rigGeometry(contract);
    rec.F = rec.geo ? frameMatrix(shipFrame(api, ship)) : null;
    const at = rigC?.extras?.sail?.at?.position;
    rec.rigAt = Array.isArray(at) ? at : [0, 0, 0];
    rec.bodyM = new Float64Array(16);
    rec.trim = { main: {}, jib: {} };
    rec.look = { belly: 1, flog: 0, luff: 0, sigma: 0, reef: 0, furl: 0, flat: 1, amp: 0, freq: 1 };
    rec.flutter = {};
    rec.tt = {};
    rec.sheets = {};
    // the main's cloth
    const mainCloth = rigC?.extras?.sail?.cloth;
    const sailNode = rec.rigRoot?.getObjectByName?.("Sail") ?? null;
    if (mainCloth?.rows > 0 && sailNode) {
      const g = ownGeometry(sailNode, clothCount(mainCloth));
      if (g) {
        const b = mainCloth.battens ? ownGeometry(sailNode, battenCount(mainCloth)) : null;
        const n = mainCloth.battens ? mainCloth.battens.rows.length : 0;
        rec.main = { cloth: mainCloth, node: sailNode, g, b, bunt: rec.rigRoot.getObjectByName?.("Bunt") ?? null, normals: g.nrm ? null : new Float32Array(clothCount(mainCloth) * 3), tell: lineOf(4 * n, materials?.telltale, sailNode, true) };
        if (rec.main.tell) rec.lines.push(rec.main.tell);
      }
    }
    // the jib's
    const jibCloth = jibC?.extras?.sail?.cloth;
    const jibNode = jibC?.root?.getObjectByName?.("Jib") ?? null;
    if (jibC?.root) rec.roll = jibC.root.getObjectByName?.("Roll") ?? null;
    if (jibCloth?.rows > 0 && jibNode) {
      const g = ownGeometry(jibNode, clothCount(jibCloth));
      if (g) {
        rec.jib = { cloth: jibCloth, node: jibNode, g, normals: g.nrm ? null : new Float32Array(clothCount(jibCloth) * 3), tell: lineOf(4 * 2 * LOOK.telltale.heights.length, materials?.telltale, jibNode, true) };
        if (rec.jib.tell) rec.lines.push(rec.jib.tell);
      }
    }
    // the hull's points (body → her object's frame)
    const G = rec.geo;
    if (G) {
      const toHull = (p, up = 0) => (p ? apply4(new Float64Array(3), 0, rec.F, p[0], p[1] + up, p[2]) : null);
      rec.traveller = toHull(G.main?.traveller);
      // the boom's sheet point in the rig's own frame (the rig GLB sits at extras.sail.at on her hull)
      const bh = toHull(G.main?.boom);
      rec.boomLocal = bh ? [bh[0] - rec.rigAt[0], bh[1] - rec.rigAt[1], bh[2] - rec.rigAt[2]] : null;
      rec.masthead = toHull(G.masthead, LOOK.vaneAbove);
      if (G.backstay) {
        const { from, to } = G.backstay;
        const k = Math.min(1, LOOK.burgeeAbove / Math.max(1e-6, from[1] - to[1]));
        rec.burgeeAt = toHull([to[0] + (from[0] - to[0]) * k, to[1] + (from[1] - to[1]) * k, to[2] + (from[2] - to[2]) * k]);
      }
      if (world && THREE?.Group) {
        rec.group = new THREE.Group();
        rec.group.userData = { ...(rec.group.userData ?? {}), noPick: true };
        world.add(rec.group);
        if (G.main?.traveller && st.sail) rec.mainsheet = sheetOf(LOOK.sheetPoints, rec.group);
        if (G.jib?.leads && st.jib) {
          rec.jibPort = sheetOf(LOOK.sheetPoints + 1, rec.group);
          rec.jibStbd = sheetOf(LOOK.sheetPoints + 1, rec.group);
        }
        if (rec.masthead) rec.vane = lineOf(6, materials?.vane, rec.group, true);
        if (rec.burgeeAt) rec.burgeeLine = lineOf(4, materials?.burgee, rec.group, true);
        for (const l of [rec.mainsheet, rec.jibPort, rec.jibStbd, rec.vane, rec.burgeeLine]) if (l) rec.lines.push(l);
      }
    }
    rec.clew = new Float64Array(3);
    rec.lead = new Float64Array(3);
    rec.a = new Float64Array(3);
    rec.b = new Float64Array(3);
    rec.tw = [0, 0];
    rec.air = new Float64Array(3);
    rec.r = new Float64Array(3);
    rec.scratch = new Float64Array(9);
    rec.v3 = { p: new Float64Array(3), a: new Float64Array(3), n: new Float64Array(3), c: new Float64Array(3) };
    return rec;
  }

  function teardown(rec) {
    for (const part of [rec.main, rec.jib]) {
      if (!part) continue;
      for (const g of [part.g, part.b]) {
        if (!g) continue;
        if (g.geometry !== g.original) g.geometry.dispose?.();
        g.mesh.geometry = g.original;
        g.mesh.frustumCulled = g.culled;
        if (g.received.flag === undefined) delete g.mesh.userData.receiveShadow;
        else g.mesh.userData.receiveShadow = g.received.flag;
        g.mesh.receiveShadow = g.received.on;
      }
      part.node.visible = true;
    }
    if (rec.main?.bunt) {
      rec.main.bunt.visible = true;
      rec.main.bunt.scale.set?.(1, 1, 1);
      rec.main.bunt.position.set?.(0, 0, 0);
    }
    if (rec.roll) rec.roll.scale.x = rec.roll.scale.z = 1;
    for (const l of rec.lines) {
      l.parent.remove?.(l.line);
      l.geometry.dispose?.();
      l.rope?.geometry.dispose?.();
    }
    if (rec.group) world?.remove?.(rec.group);
  }

  const rootIds = new WeakMap();
  let rootN = 0;
  const rootId = (root) => (root ? (rootIds.get(root) ?? (rootIds.set(root, ++rootN), rootN)) : 0);
  let signature = "";

  /**
   * The dressing for the scene as it is. On a new snapshot its ships, their
   * parts, their content and the burgee are compared with what's dressed,
   * and it is made again only when they differ (or a ship's content was
   * still loading); every other frame this is one comparison.
   */
  function refresh() {
    const sc = api.scene?.();
    let pending = false;
    for (let i = 0; i < rigs.length; i++) pending ||= rigs[i].pending;
    if (sc === scene && !pending) return;
    scene = sc;
    const ships = sc ? ctx.sim.ships() : [];
    const sig = ships
      .map((id) => {
        const st = ctx.sim.stationsOf(id);
        const parts = [st.sail, st.jib, ...(st.winches ?? [])];
        return [id, !!sc.objects[id]?.traits?.[SHIP]?.burgee, ...parts.map((p) => `${p}:${rootId(p ? api.content(p)?.root : null)}`)].join(",");
      })
      .join(";");
    if (sig === signature && !pending) return;
    signature = sig;
    for (const r of rigs) teardown(r);
    rigs = ships.map(setup);
  }

  function bob(t) {
    if (!ctx.sea.ocean) return;
    for (const id of floats) {
      const root = api.content(id)?.root;
      const m = api.worldOf(id);
      if (!root || !m) continue;
      const { offset, tilt } = floatPose(ctx.sea.ocean, m, t);
      // the content node, not the object: where it's moored stays the doc's
      root.position.set(offset[0], offset[1], offset[2]);
      root.rotation.set(tilt[0], 0, tilt[1]);
      moved.add(root);
    }
  }

  /** A rig with no cloth (the rig aid's): scaled across by how full it is, mirrored to the boom's side, lowered as it's taken in. */
  function dressPlain(rec, read) {
    const root = rec.rigRoot;
    if (!root) return;
    const side = boomToPort(bodyOf(api, rec.ship), api.worldOf(rec.rigId)) ? -1 : 1;
    const x = side * fullness(read);
    if (root.scale.x !== x) root.scale.x = x;
    const sail = root.getObjectByName?.("Sail") ?? null;
    plain.set(root, sail);
    if (!sail) return;
    const raised = clamp(Number(fieldOf(rec.rigId, "raised")) || 0, 0, 1);
    sail.scale.y = Math.max(raised, 1e-3);
    sail.visible = raised > 0.02;
  }

  /** The read's sail entry that is (or isn't) the main. */
  const sailIn = (read, main) => {
    const list = read?.sails;
    if (!Array.isArray(list)) return null;
    for (let i = 0; i < list.length; i++) if (!!list[i].main === main) return list[i];
    return null;
  };

  /** Write a cloth's vertices, normals and (the main's) battens for a look; flag them for upload. */
  function writeCloth(part, look, t) {
    const pos = part.g.pos.array;
    clothVertices(pos, part.cloth, look, t);
    clothNormals(part.g.nrm ? part.g.nrm.array : part.normals, pos, part.cloth);
    part.g.pos.needsUpdate = true;
    if (part.g.nrm) part.g.nrm.needsUpdate = true;
    if (part.b) {
      battenVertices(part.b.pos.array, pos, part.cloth);
      part.b.pos.needsUpdate = true;
    }
  }

  /** A telltale's ribbon into a LineSegments' array at segment pair k (from the polyline in rec.scratch). */
  function putRibbon(arr, k, src) {
    const o = 12 * k;
    for (let j = 0; j < 3; j++) {
      arr[o + j] = src[j];
      arr[o + 3 + j] = arr[o + 6 + j] = src[3 + j];
      arr[o + 9 + j] = src[6 + j];
    }
  }

  /**
   * Row r's frame on a cloth at chord fraction u (into rec.v3): the point,
   * aft along the row, its +x-side normal (the grid's faces point to −x at
   * neutral) and up the sail.
   */
  function frameAt(rec, part, r, u) {
    const pos = part.g.pos.array, nrm = part.g.nrm ? part.g.nrm.array : part.normals;
    const C = part.cloth.cols, W = C + 1, R = part.cloth.rows;
    const { p, a, n, c } = rec.v3;
    clothPoint(p, 0, pos, part.cloth, r, u);
    const col = Math.min(C - 1, Math.floor(Math.min(1, Math.max(0, u)) * C));
    const i0 = 3 * (r * W + col), i1 = 3 * (r * W + col + 1);
    a[0] = pos[i1] - pos[i0];
    a[1] = pos[i1 + 1] - pos[i0 + 1];
    a[2] = pos[i1 + 2] - pos[i0 + 2];
    let l = Math.hypot(a[0], a[1], a[2]) || 1;
    a[0] /= l;
    a[1] /= l;
    a[2] /= l;
    const k = 3 * (r * W + Math.min(C, Math.round(u * C)));
    n[0] = -nrm[k];
    n[1] = -nrm[k + 1];
    n[2] = -nrm[k + 2];
    const up = 3 * (Math.min(R, r + 1) * W + col), dn = 3 * (Math.max(0, r - 1) * W + col);
    c[0] = pos[up] - pos[dn];
    c[1] = pos[up + 1] - pos[dn + 1];
    c[2] = pos[up + 2] - pos[dn + 2];
    l = Math.hypot(c[0], c[1], c[2]) || 1;
    c[0] /= l;
    c[1] /= l;
    c[2] /= l;
  }

  function dressMain(rec, read, t, raisedIn) {
    const part = rec.main;
    const s = sailIn(read, true);
    const model = s ? ctx.sim.sailModels?.(rec.ship)?.[s.id] : null;
    const look = rec.look;
    const raised = clamp(Number(raisedIn) || 0, 0, 1);
    look.reef = 1 - raised;
    look.furl = 0;
    look.flat = 1;
    let slack = 0;
    if (s && model) {
      const tr = trimOf(s, model, rec.trim.main);
      slack = rec.geo?.main ? mainsheetSlack(rec.geo.main, Number(read.boom) || 0, Number(s.limit) || 0) : 0;
      flutterOf(rec.flutter, rec.geo?.main?.foot ?? 4, Number(s.q) || 0, slack);
      look.belly = tr.belly;
      look.flog = tr.flog;
      look.luff = tr.luff;
      look.sigma = tr.sigma;
      look.amp = rec.flutter.amp;
      look.freq = rec.flutter.freq;
    } else {
      // no contract flown: bellied to the boom's leeward side, as full as the old dressing says
      look.belly = (Number(read?.boom) < 0 ? -1 : 1) * fullness(read);
      look.flog = look.luff = look.sigma = look.amp = 0;
    }
    if (rec.rigRoot && rec.rigRoot.scale.x !== 1) rec.rigRoot.scale.x = 1;
    const shown = look.reef < 1 - 1e-3;
    part.node.visible = shown;
    if (shown) writeCloth(part, look, t);
    if (part.bunt) {
      const f = look.reef;
      part.bunt.visible = f > 1e-3;
      const k = (0.02 + 0.08 * Math.sqrt(f)) / BUNT_R;
      part.bunt.scale.x = part.bunt.scale.y = k;
      part.bunt.position.y = 0.065 + k * BUNT_R;
    }
    // the leech's telltales: streaming aft off it by 1 − σ, curled round to leeward by σ, flapping as it flogs
    if (part.tell && shown && part.cloth.battens) {
      const tr = rec.trim.main;
      const lee = (s ? tr.belly : look.belly) < 0 ? -1 : 1;
      const rows = part.cloth.battens.rows;
      for (let k = 0; k < rows.length; k++) {
        frameAt(rec, part, rows[k], 1);
        const { p, a, n } = rec.v3;
        for (let j = 0; j < 3; j++) n[j] *= lee;
        ribbon(rec.scratch, 0, p, a, n, n, LOOK.telltale.leech, s ? tr.flog * 0.8 : 0, s ? tr.sigma : 0, 2 * Math.PI * LOOK.telltale.spin * t + 1.3 * k);
        putRibbon(part.tell.array, k, rec.scratch);
      }
      part.tell.attr.needsUpdate = true;
    }
  }

  function dressJib(rec, read, t, furlIn, raisedIn) {
    const part = rec.jib;
    const s = Number.isFinite(read?.jib) ? sailIn(read, false) : null;
    const model = s ? ctx.sim.sailModels?.(rec.ship)?.[s.id] : null;
    // the physics' furl: the piece's, else the contract's or more as the main comes down; rolled away when her physics flies no jib
    const raised = clamp(Number(raisedIn) || 0, 0, 1);
    const furl = !s ? 1 : furlIn != null && Number.isFinite(Number(furlIn)) ? clamp(Number(furlIn), 0, 1) : Math.max(0, 1 - raised);
    const look = rec.look;
    look.reef = 0;
    look.furl = furl;
    look.flat = 1;
    let slack = 0;
    if (s && model) {
      const tr = trimOf(s, model, rec.trim.jib);
      if (rec.geo?.jib?.leads) {
        jibSheets(rec.sheets, rec.geo.jib, read.jib, Number(s.limit) || 0, furl);
        slack = rec.sheets.working < 0 ? rec.sheets.port.s : rec.sheets.starboard.s;
      }
      flutterOf(rec.flutter, rec.geo?.jib?.foot ?? 4, Number(s.q) || 0, slack);
      look.belly = tr.belly;
      look.flog = tr.flog;
      look.luff = tr.luff;
      look.sigma = tr.sigma;
      look.amp = rec.flutter.amp;
      look.freq = rec.flutter.freq;
    } else {
      look.belly = 1;
      look.flog = look.luff = look.sigma = look.amp = 0;
    }
    const shown = furl < 1 - 1e-3;
    part.node.visible = shown;
    if (shown) writeCloth(part, look, t);
    if (rec.roll) rec.roll.scale.x = rec.roll.scale.z = (0.02 + 0.06 * Math.sqrt(furl)) / JIB_FOIL_R;
    // the luff's telltales: three pairs; the windward one lifts as it flogs, the leeward one curls as it stalls
    if (part.tell && shown && s && model) {
      const tr = rec.trim.jib;
      const windward = Number(s.from) < 0 ? -1 : 1;
      const H = LOOK.telltale.heights;
      const pos = part.g.pos.array, W = part.cloth.cols + 1;
      for (let k = 0; k < H.length; k++) {
        const r = Math.round(H[k] * part.cloth.rows);
        const i0 = 3 * r * W, i1 = 3 * (r * W + W - 1);
        const chord = Math.hypot(pos[i1] - pos[i0], pos[i1 + 1] - pos[i0 + 1], pos[i1 + 2] - pos[i0 + 2]) || 1;
        for (let side = -1; side <= 1; side += 2) {
          frameAt(rec, part, r, LOOK.telltale.aft / chord);
          const { p, a, n, c } = rec.v3;
          for (let j = 0; j < 3; j++) {
            n[j] *= side;
            p[j] += LOOK.telltale.off * n[j];
            c[j] = -c[j]; // curls down
          }
          telltaleOf(rec.tt, tr, side === windward);
          ribbon(rec.scratch, 0, p, a, n, c, LOOK.telltale.luff, rec.tt.lift, rec.tt.curl, 2 * Math.PI * LOOK.telltale.spin * t + 1.3 * k + (side > 0 ? 0.5 : 0));
          putRibbon(part.tell.array, 2 * k + (side > 0 ? 1 : 0), rec.scratch);
        }
      }
      part.tell.attr.needsUpdate = true;
    } else if (part.tell) part.tell.array.fill(0);
  }

  /** The sheets, the vane and the burgee, in the world (rec.group). */
  function dressLines(rec, read, t) {
    const hull = api.worldOf(rec.ship);
    if (!hull) return;
    const B = mul4(rec.bodyM, hull, rec.F);
    // the mainsheet: the boom's sheet point as drawn → the traveller's car
    if (rec.mainsheet) {
      const rigW = api.worldOf(rec.rigId);
      const s = sailIn(read, true);
      const shown = !!rigW && !!s;
      rec.mainsheet.line.visible = shown;
      if (shown) {
        rec.mainSlack = mainsheetSlack(rec.geo.main, Number(read.boom) || 0, Number(s.limit) || 0);
        const bl = rec.boomLocal;
        apply4(rec.a, 0, rigW, bl[0], bl[1], bl[2]);
        apply4(rec.b, 0, hull, rec.traveller[0], rec.traveller[1], rec.traveller[2]);
        sheetCurve(rec.mainsheet.array, 0, rec.a, rec.b, rec.mainSlack ?? 0, DOWN, LOOK.sheetPoints, Math.min(rec.a[1], rec.b[1]) - LOOK.slackBelow);
        laid(rec.mainsheet);
      }
    }
    // the jib's sheets: the clew as drawn → each lead (slack or taut) → its winch (on the drum)
    if (rec.jibPort) {
      const jibW = rec.jibId ? api.worldOf(rec.jibId) : null;
      const s = Number.isFinite(read?.jib) ? sailIn(read, false) : null;
      const shown = !!jibW && !!s && !!rec.jib && rec.sheets.port != null;
      rec.jibPort.line.visible = rec.jibStbd.line.visible = shown;
      if (shown) {
        const pos = rec.jib.g.pos.array;
        const k = 3 * rec.jib.cloth.cols; // row 0's last column: the clew
        apply4(rec.a, 0, jibW, pos[k], pos[k + 1], pos[k + 2]);
        for (let side = -1; side <= 1; side += 2) {
          const sheet = side < 0 ? rec.sheets.port : rec.sheets.starboard;
          const line = side < 0 ? rec.jibPort : rec.jibStbd;
          const L = sheet.lead;
          const h = apply4(rec.r, 0, rec.F, L[0], L[1], L[2]);
          apply4(rec.b, 0, hull, h[0], h[1], h[2]);
          sheetCurve(line.array, 0, rec.a, rec.b, sheet.s, DOWN, LOOK.sheetPoints, Math.min(rec.a[1], rec.b[1]) - LOOK.slackBelow);
          const w = side < 0 ? rec.winches.port : rec.winches.starboard;
          const ww = w ? api.worldOf(w) : null;
          const o = 3 * LOOK.sheetPoints;
          if (ww) apply4(line.array, o, ww, LOOK.winchTop[0], LOOK.winchTop[1], LOOK.winchTop[2]);
          else (line.array[o] = rec.b[0]), (line.array[o + 1] = rec.b[1]), (line.array[o + 2] = rec.b[2]);
          laid(line);
        }
      }
    }
    // the vane: into the air at the masthead, across her mast
    if (rec.vane) {
      const m = rec.masthead;
      apply4(rec.a, 0, hull, m[0], m[1], m[2]);
      const wind = ctx.sea.wind;
      const tw = wind?.at ? wind.at(rec.a[0], rec.a[2], t, rec.tw) : ((rec.tw[0] = rec.tw[1] = 0), rec.tw);
      const v = Array.isArray(read?.velocity) ? read.velocity : null;
      const w = Array.isArray(read?.spin) ? read.spin : null;
      rec.r[0] = rec.a[0] - hull[12];
      rec.r[1] = rec.a[1] - hull[13];
      rec.r[2] = rec.a[2] - hull[14];
      if (v && w) mastheadAir(rec.air, tw, v, w, rec.r);
      else (rec.air[0] = tw[0]), (rec.air[1] = 0), (rec.air[2] = tw[1]);
      vaneLines(rec.vane.array, 0, rec.a, rec.air, B, LOOK.vane);
      rec.vane.attr.needsUpdate = true;
    }
    if (rec.burgeeLine) {
      rec.burgeeLine.line.visible = rec.burgee;
      if (rec.burgee) {
        const p = rec.burgeeAt;
        apply4(rec.a, 0, hull, p[0], p[1], p[2]);
        const wind = ctx.sea.wind;
        const tw = wind?.at ? wind.at(rec.a[0], rec.a[2], t, rec.tw) : ((rec.tw[0] = rec.tw[1] = 0), rec.tw);
        burgeeLines(rec.burgeeLine.array, 0, rec.a, tw);
        rec.burgeeLine.attr.needsUpdate = true;
      }
    }
  }

  /** A station's live field: ctx.sim.field where it has one, else off its value. */
  const fieldOf = (id, key) => (ctx.sim.field ? ctx.sim.field(id, key) : ctx.sim.value(id)?.[key]);

  function dress(t) {
    refresh();
    for (let i = 0; i < rigs.length; i++) {
      const rec = rigs[i];
      const read = ctx.sim.read(rec.ship);
      // the stations' fields read one by one (no value object built each frame)
      const raised = rec.rigId ? fieldOf(rec.rigId, "raised") : undefined;
      if (rec.rigId && !rec.main) dressPlain(rec, read);
      if (rec.main) dressMain(rec, read, t, raised);
      if (rec.jib) dressJib(rec, read, t, rec.jibId ? fieldOf(rec.jibId, "furl") : undefined, raised);
      else if (rec.roll) rec.roll.scale.x = rec.roll.scale.z = (Number.isFinite(read?.jib) ? 0.02 : 0.08) / JIB_FOIL_R;
      if (rec.group) dressLines(rec, read, t);
    }
  }

  return {
    update(sc) {
      floats = floatsOf(sc);
    },
    tick() {
      const t = ctx.sea.clock();
      bob(t);
      dress(t);
    },
    dispose() {
      for (const root of moved) {
        root.position.set(0, 0, 0);
        root.rotation.set(0, 0, 0);
      }
      for (const [root, sail] of plain) {
        root.scale.x = 1;
        if (sail) {
          sail.scale.y = 1;
          sail.visible = true;
        }
      }
      for (const r of rigs) teardown(r);
      rigs = [];
      scene = null;
      for (const m of Object.values(materials ?? {})) m?.dispose?.();
      moved.clear();
      plain.clear();
    },
  };
}
