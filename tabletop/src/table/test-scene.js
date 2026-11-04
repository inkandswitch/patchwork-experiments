// For tests: a scene snapshot like the scene extension api's (api.scene()),
// from a plain objects map — world matrices from the transforms (Euler XYZ,
// uniform scale, attachment by `parent`), column-major like the scene's.

function compose(t = {}) {
  const [x, y, z] = t.position ?? [0, 0, 0];
  const [a, b, c] = t.rotation ?? [0, 0, 0];
  const s = Number(t.scale) || 1;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // R = Rx · Ry · Rz (three.js "XYZ")
  const r = [
    cb * cc, ca * sc + sa * sb * cc, sa * sc - ca * sb * cc,
    -cb * sc, ca * cc - sa * sb * sc, sa * cc + ca * sb * sc,
    sb, -sa * cb, ca * cb,
  ];
  return [r[0] * s, r[1] * s, r[2] * s, 0, r[3] * s, r[4] * s, r[5] * s, 0, r[6] * s, r[7] * s, r[8] * s, 0, x, y, z, 1];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** The inverse of a rotation · uniform scale + translation. */
function invertRigid(m) {
  const s2 = m[0] * m[0] + m[1] * m[1] + m[2] * m[2];
  const rt = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1].map((v, i) => (i % 4 === 3 || i >= 12 ? v : v / s2));
  const t = [m[12], m[13], m[14]];
  for (let r = 0; r < 3; r++) rt[12 + r] = -(rt[r] * t[0] + rt[4 + r] * t[1] + rt[8 + r] * t[2]);
  return rt;
}

export function testScene(objects, traits = {}) {
  const world = (id) => {
    const o = objects[id];
    if (!o) return compose();
    const local = compose(o.transform);
    return o.parent && objects[o.parent] ? multiply(world(o.parent), local) : local;
  };
  const toLocal = (id, p) => {
    const inv = invertRigid(world(id));
    return [0, 1, 2].map((r) => inv[r] * p[0] + inv[4 + r] * p[1] + inv[8 + r] * p[2] + inv[12 + r]);
  };
  return { objects, ids: Object.keys(objects), traits, world, toLocal };
}
