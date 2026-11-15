// For tests only: the water package's evaluator (water/src/surface.js),
// copied (packages don't import each other), so sailing's fakes float things
// on a sea exactly as the water package's reader will at run time. Sailing
// itself evaluates no waves. ocean-golden.test.js pins this copy, bit for
// bit, to the golden file water's own surface is pinned to.

/**
 * The surface for a list of components, each { dir: [dx, dz], k, omega, amp,
 * steep, phase }. Empty: flat, at zero.
 * @param {{ dir: number[], k: number, omega: number, amp: number, steep: number, phase: number }[]} components
 */
export function createSurface(components) {
  const n = components.length;

  // per-component constants, laid out flat for the hot loops below
  const KX = new Float64Array(n), KZ = new Float64Array(n), W = new Float64Array(n), P = new Float64Array(n);
  const K = new Float64Array(n), A = new Float64Array(n), AW = new Float64Array(n), QDX = new Float64Array(n), QDZ = new Float64Array(n);
  const QAX = new Float64Array(n), QAZ = new Float64Array(n), AKX = new Float64Array(n), AKZ = new Float64Array(n);
  const QXX = new Float64Array(n), QZZ = new Float64Array(n), QXZ = new Float64Array(n);
  components.forEach((c, i) => {
    const [dx, dz] = c.dir;
    const qa = c.steep * c.amp;
    KX[i] = c.k * dx;
    KZ[i] = c.k * dz;
    W[i] = c.omega;
    P[i] = c.phase;
    K[i] = c.k;
    A[i] = c.amp;
    AW[i] = c.amp * c.omega;
    QDX[i] = c.steep * dx;
    QDZ[i] = c.steep * dz;
    QAX[i] = qa * dx;
    QAZ[i] = qa * dz;
    AKX[i] = c.amp * c.k * dx;
    AKZ[i] = c.amp * c.k * dz;
    QXX[i] = qa * c.k * dx * dx;
    QZZ[i] = qa * c.k * dz * dz;
    QXZ[i] = qa * c.k * dx * dz;
  });

  // what solve() found: the rest point (x0, z0) whose wave-moved position is
  // the asked (x, z), the height there, and the surface's tangent terms
  const S = new Float64Array(8);
  const X0 = 0, Z0 = 1, H = 2, JXX = 3, JZZ = 4, JXZ = 5, GX = 6, GZ = 7;

  /**
   * Find which rest point the waves carry to (x, z) at t. A Gerstner wave
   * moves the surface sideways toward its crests, so the height at a world
   * point is the height of whatever point landed there. Newton's method on
   * x0 − D(x0) = x: its Jacobian (I − ΣQkA cos θ d dᵀ) is positive definite
   * while Σ QkA < 1, so it converges, in two to four rounds.
   */
  function solve(x, z, t) {
    let x0 = x;
    let z0 = z;
    for (let it = 0; it < 8; it++) {
      let sx = 0, sz = 0, h = 0, jxx = 1, jzz = 1, jxz = 0, gx = 0, gz = 0;
      for (let i = 0; i < n; i++) {
        const th = KX[i] * x0 + KZ[i] * z0 - W[i] * t + P[i];
        const s = Math.sin(th);
        const c = Math.cos(th);
        sx += QAX[i] * s;
        sz += QAZ[i] * s;
        h += A[i] * c;
        jxx -= QXX[i] * c;
        jzz -= QZZ[i] * c;
        jxz -= QXZ[i] * c;
        gx += AKX[i] * s;
        gz += AKZ[i] * s;
      }
      S[X0] = x0;
      S[Z0] = z0;
      S[H] = h;
      S[JXX] = jxx;
      S[JZZ] = jzz;
      S[JXZ] = jxz;
      S[GX] = gx;
      S[GZ] = gz;
      const rx = x0 - sx - x;
      const rz = z0 - sz - z;
      if (rx * rx + rz * rz < 1e-12) break;
      const det = jxx * jzz - jxz * jxz;
      x0 -= (jzz * rx - jxz * rz) / det;
      z0 -= (jxx * rz - jxz * rx) / det;
    }
    return S;
  }

  /** The surface's height above sea level at world (x, z) and time t. */
  function heightAt(x, z, t) {
    if (!n) return 0;
    return solve(x, z, t)[H];
  }

  /** The unit normal from solve()'s tangents, into out at offset o. */
  function normalInto(out, o) {
    // ∂P/∂x0 = (jxx, −gx, jxz) and ∂P/∂z0 = (jxz, −gz, jzz); the normal is ∂P/∂z0 × ∂P/∂x0
    const nx = S[GX] * S[JZZ] - S[GZ] * S[JXZ];
    const ny = S[JXX] * S[JZZ] - S[JXZ] * S[JXZ];
    const nz = S[GZ] * S[JXX] - S[GX] * S[JXZ];
    const l = Math.hypot(nx, ny, nz);
    out[o] = nx / l;
    out[o + 1] = ny / l;
    out[o + 2] = nz / l;
    return out;
  }

  /** The surface's unit normal at world (x, z), t. Writes into `out` when given. */
  function normalAt(x, z, t, out = [0, 1, 0]) {
    if (!n) {
      out[0] = 0;
      out[1] = 1;
      out[2] = 0;
      return out;
    }
    solve(x, z, t);
    return normalInto(out, 0);
  }

  /** Height and normal in one solve, into `out` as [y, nx, ny, nz]: what a buoyancy sample wants. */
  function sampleAt(x, z, t, out = [0, 0, 1, 0]) {
    if (!n) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 1;
      out[3] = 0;
      return out;
    }
    solve(x, z, t);
    out[0] = S[H];
    return normalInto(out, 1);
  }

  /**
   * The water's orbital velocity at a world point, t. Each wave's motion
   * decays as e^{k·depth}, depth measured down from the surface above the
   * point (Wheeler's stretching), so at the surface it is exactly the
   * surface's own motion and a point above the water takes the surface's.
   * Writes into `out` when given.
   */
  function velocityAt(x, y, z, t, out = [0, 0, 0]) {
    out[0] = out[1] = out[2] = 0;
    if (!n) return out;
    solve(x, z, t);
    const x0 = S[X0];
    const z0 = S[Z0];
    const depth = Math.min(0, y - S[H]);
    let vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < n; i++) {
      const th = KX[i] * x0 + KZ[i] * z0 - W[i] * t + P[i];
      const e = AW[i] * Math.exp(K[i] * depth);
      const c = Math.cos(th);
      vx += e * QDX[i] * c;
      vz += e * QDZ[i] * c;
      vy += e * Math.sin(th);
    }
    out[0] = vx;
    out[1] = vy;
    out[2] = vz;
    return out;
  }

  /**
   * Where the rest point (x0, z0) is carried at t, and the horizontal
   * Jacobian there (< 1 where the surface is squeezed into a crest, the
   * foam's measure): [x, y, z, J]. The forward map, the one the shader runs.
   */
  function displaced(x0, z0, t, out = [0, 0, 0, 1]) {
    let sx = 0, sz = 0, h = 0, jxx = 1, jzz = 1, jxz = 0;
    for (let i = 0; i < n; i++) {
      const th = KX[i] * x0 + KZ[i] * z0 - W[i] * t + P[i];
      const s = Math.sin(th);
      const c = Math.cos(th);
      sx += QAX[i] * s;
      sz += QAZ[i] * s;
      h += A[i] * c;
      jxx -= QXX[i] * c;
      jzz -= QZZ[i] * c;
      jxz -= QXZ[i] * c;
    }
    out[0] = x0 - sx;
    out[1] = h;
    out[2] = z0 - sz;
    out[3] = jxx * jzz - jxz * jxz;
    return out;
  }

  return {
    components,
    heightAt,
    normalAt,
    sampleAt,
    velocityAt,
    displaced,
  };
}
