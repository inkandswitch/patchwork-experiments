/* Unit quaternions [x,y,z,w], compatible with K.M row-major rotation matrices. */
(function (K) {
  const { V, M } = K,
    freeze = K.procedural.data.freeze;
  const check = (ok, message) => {
    if (!ok) throw new TypeError('Quaternion: ' + message);
  };
  const vector = (v, n) =>
    v && v.length === n && (Array.isArray(v) || ArrayBuffer.isView(v)) && Array.from(v).every(Number.isFinite);
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0),
    neg = q => q.map(v => -v),
    align = (q, to) => (dot(q, to) < 0 ? neg(q) : q);
  function normalize(q) {
    check(vector(q, 4), 'expected four finite components');
    const length = Math.hypot(...q);
    check(length > 1e-12 && Number.isFinite(length), 'rotation must have nonzero finite norm');
    return Array.from(q, v => v / length);
  }
  const product = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
  const conjugate = q => [-q[0], -q[1], -q[2], q[3]];
  const coordinate = t => {
    check(Number.isFinite(t), 'interpolation coordinate must be finite');
    return Math.max(0, Math.min(1, t));
  };
  function nlerp(a, b, t) {
    a = normalize(a);
    b = align(normalize(b), a);
    t = coordinate(t);
    return normalize(a.map((v, i) => v * (1 - t) + b[i] * t));
  }
  function slerp(a, b, t) {
    a = normalize(a);
    b = align(normalize(b), a);
    t = coordinate(t);
    const d = Math.max(-1, Math.min(1, dot(a, b)));
    if (d > 0.9995) return nlerp(a, b, t);
    const theta = Math.acos(d),
      s = Math.sin(theta);
    return normalize(a.map((v, i) => (v * Math.sin((1 - t) * theta) + b[i] * Math.sin(t * theta)) / s));
  }
  function toMatrix(q) {
    const [x, y, z, w] = normalize(q);
    return [
      1 - 2 * (y * y + z * z),
      2 * (x * y - z * w),
      2 * (x * z + y * w),
      2 * (x * y + z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z - x * w),
      2 * (x * z - y * w),
      2 * (y * z + x * w),
      1 - 2 * (x * x + y * y)
    ];
  }
  function fromMatrix(m) {
    check(
      vector(m, 9) &&
        Math.abs(M.det(m) - 1) < 1e-4 &&
        M.mul(M.tr(m), m).every((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) < 1e-4),
      'matrix must be a proper orthonormal rotation'
    );
    const trace = m[0] + m[4] + m[8];
    let q;
    if (trace > 0) {
      const s = 2 * Math.sqrt(1 + trace);
      q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4];
    } else {
      const i = [m[0], m[4], m[8]].indexOf(Math.max(m[0], m[4], m[8])),
        j = (i + 1) % 3,
        k = (i + 2) % 3,
        s = 2 * Math.sqrt(1 + m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k]);
      q = [0, 0, 0, 0];
      q[i] = s / 4;
      q[j] = (m[j * 3 + i] + m[i * 3 + j]) / s;
      q[k] = (m[k * 3 + i] + m[i * 3 + k]) / s;
      q[3] = (m[k * 3 + j] - m[j * 3 + k]) / s;
    }
    return normalize(q);
  }
  const log = q => {
    const s = Math.hypot(...q.slice(0, 3)),
      a = Math.atan2(s, q[3]);
    return q.slice(0, 3).map(v => (s > 1e-12 ? (v * a) / s : v));
  };
  const exp = v => {
    const a = V.len(v),
      s = a > 1e-12 ? Math.sin(a) / a : 1;
    return [...V.mul(v, s), Math.cos(a)];
  };
  function spline(input, options = {}) {
    const { closed = false, method = 'squad' } = options;
    check(
      Object.keys(options).every(k => ['closed', 'method'].includes(k)) &&
        typeof closed === 'boolean' &&
        ['squad', 'slerp'].includes(method),
      'invalid spline settings'
    );
    check(
      Array.isArray(input) && input.length >= (closed ? 3 : 2) && input.length <= 4096,
      'spline needs 2–4096 rotations (three for a loop)'
    );
    const keys = Array.from(input, normalize),
      n = keys.length,
      spans = closed ? n : n - 1;
    const controls = keys.map((q, i) => {
      if (!closed && (i === 0 || i === n - 1)) return q;
      const inv = conjugate(q),
        a = log(product(inv, align(keys[(i + n - 1) % n], q))),
        b = log(product(inv, align(keys[(i + 1) % n], q)));
      return normalize(product(q, exp(V.mul(V.add(a, b), -0.25))));
    });
    function sample(u) {
      check(Number.isFinite(u), 'spline coordinate must be finite');
      u = closed ? ((u % 1) + 1) % 1 : Math.max(0, Math.min(1, u));
      const pos = u * spans,
        i = Math.min(spans - 1, Math.floor(pos)),
        j = (i + 1) % n,
        t = pos - i,
        a = keys[i],
        b = keys[j];
      if (method === 'slerp') return slerp(a, b, t);
      return slerp(slerp(a, b, t), slerp(controls[i], controls[j], t), 2 * t * (1 - t));
    }
    return freeze({
      closed,
      method,
      count: n,
      sample,
      matrix: u => toMatrix(sample(u)),
      snapshot: () => ({ rotations: keys.map(q => q.slice()), options: { closed, method } })
    });
  }
  K.Q = freeze({
    id: () => [0, 0, 0, 1],
    normalize,
    nlerp,
    slerp,
    toMatrix,
    fromMatrix,
    spline,
    mul: (a, b) => normalize(product(normalize(a), normalize(b))),
    inverse: q => conjugate(normalize(q)),
    fromAxisAngle(axis, angle) {
      check(
        vector(axis, 3) && V.len(axis) > 1e-12 && Number.isFinite(V.len(axis)) && Number.isFinite(angle),
        'invalid rotation axis or angle'
      );
      const half = angle / 2;
      return [...Array.from(axis, v => (v / V.len(axis)) * Math.sin(half)), Math.cos(half)];
    },
    rotate(q, p) {
      check(vector(p, 3), 'expected a finite XYZ vector');
      return M.app(toMatrix(q), p);
    },
    angle(a, b) {
      const relative = product(conjugate(normalize(a)), normalize(b));
      return 2 * Math.atan2(Math.hypot(...relative.slice(0, 3)), Math.abs(relative[3]));
    }
  });
})(KIT);
