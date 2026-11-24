// The sun's shadow frame: which sphere one shadow map covers, where the
// light stands for it, and when that changes. Pure maths over plain arrays;
// the two functions at the end set what they decide on the light and the
// meshes they are given.

/** The shadow map's size: the largest every WebGL 2 device takes (its least MAX_TEXTURE_SIZE). */
export const SHADOW_MAP = 2048;

/**
 * The frame's largest radius (m), a step of ladderRadius: one map then
 * spans 32 m at 1.6 cm a texel (across the light; along the ground a low
 * sun stretches it), which caps how coarse shadows get as what's covered
 * grows, and leaves the rest of a large scene unshadowed.
 */
export const SHADOW_CAP = 16;

/**
 * How far from the focus (m) an object may be and still size the frame: a
 * tuning value, about three caps, so what stands around the focus can count
 * and what's far off never widens the frame.
 */
export const SHADOW_REACH = 50;

/**
 * The sun's shadow camera's right and up axes, exactly as three builds them
 * (Matrix4.lookAt from the light toward its target, world up +y), for a unit
 * `direction` toward the sun. The texel grid lies along these.
 * @returns {{ x: number[], y: number[] }}
 */
export function lightBasis(direction) {
  let [zx, zy, zz] = direction;
  // three's lookAt nudges a direction parallel to up the same way
  let xx = zz, xz = -zx; // up (0,1,0) × z
  if (Math.hypot(xx, xz) === 0) {
    zz += 0.0001;
    const n = Math.hypot(zx, zy, zz);
    zx /= n;
    zy /= n;
    zz /= n;
    xx = zz;
    xz = -zx;
  }
  const xl = Math.hypot(xx, xz);
  const x = [xx / xl, 0, xz / xl];
  // y = z × x
  const y = [zy * x[2] - zz * x[1], zz * x[0] - zx * x[2], zx * x[1] - zy * x[0]];
  return { x, y };
}

/**
 * The sphere the sun's shadow map covers: what's within `reach` of `focus`
 * (what the orbit looks at, or the held camera), nearest first, as long as
 * the union stays within `cap`, so what's looked at gets the texels and a
 * neighbour joins only if it fits. A box bigger than `cap` on its own (a
 * ground, a backdrop) takes shadows inside the frame but doesn't size it.
 * Nothing that fits: the `cap` sphere about the focus. No boxes at all: null.
 * @param {{ min: number[], max: number[] }[]} boxes  world boxes
 * @param {number[]} focus
 * @returns {{ center: number[], radius: number } | null}
 */
export function shadowFocus(boxes, focus, { reach = SHADOW_REACH, cap = SHADOW_CAP } = {}) {
  if (!boxes?.length) return null;
  const near = [];
  for (const b of boxes) {
    let d2 = 0;
    for (let i = 0; i < 3; i++) {
      const v = focus[i] < b.min[i] ? b.min[i] - focus[i] : focus[i] > b.max[i] ? focus[i] - b.max[i] : 0;
      d2 += v * v;
    }
    if (d2 <= reach * reach) near.push([d2, b]);
  }
  near.sort((p, q) => p[0] - q[0]);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const nlo = [0, 0, 0];
  const nhi = [0, 0, 0];
  for (const [, b] of near) {
    for (let i = 0; i < 3; i++) {
      nlo[i] = Math.min(lo[i], b.min[i]);
      nhi[i] = Math.max(hi[i], b.max[i]);
    }
    if (0.5 * Math.hypot(nhi[0] - nlo[0], nhi[1] - nlo[1], nhi[2] - nlo[2]) > cap) continue;
    for (let i = 0; i < 3; i++) {
      lo[i] = nlo[i];
      hi[i] = nhi[i];
    }
  }
  if (lo[0] > hi[0]) return { center: [...focus], radius: cap };
  const radius = Math.max(0.5 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 0.05);
  return { center: [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2), radius };
}

/** A radius rounded up onto a ladder of quarter octaves (19% apart), so the texel size holds still while what's covered changes a little. */
export function ladderRadius(r) {
  return 2 ** (Math.ceil(Math.log2(Math.max(r, 0.05)) * 4 - 1e-9) / 4);
}

/**
 * Where a shadow-casting sun stands to cover `sphere`: its centre moved to
 * whole texels along the light's right and up axes (and depth), so a frame
 * that moves only ever moves by whole texels and the shadows' edges don't
 * crawl; the light `direction` (unit, toward the sun) twice the radius out;
 * an orthographic frustum the sphere's size; a depth bias of one texel and a
 * normal bias of a texel and a half, both in world units turned into three's.
 * @param {{ center: number[], radius: number }} sphere  @param {number[]} direction  @param {number} mapSize
 */
export function shadowFrame(sphere, direction, mapSize = SHADOW_MAP) {
  const r = sphere.radius;
  const texel = (2 * r) / mapSize;
  const { x, y } = lightBasis(direction);
  const c = sphere.center;
  // the centre in whole texels along each axis, and back: the same texels, the same point
  const k = [x, y, direction].map((a) => Math.round((a[0] * c[0] + a[1] * c[1] + a[2] * c[2]) / texel));
  const target = [0, 1, 2].map((i) => texel * (k[0] * x[i] + k[1] * y[i] + k[2] * direction[i]));
  const near = r * 0.5;
  const far = r * 3.5;
  return {
    target,
    position: target.map((v, i) => v + direction[i] * 2 * r),
    radius: r,
    texel,
    near,
    far,
    // three's depth for an orthographic shadow is (z - near) / (far - near)
    bias: -texel / (far - near),
    normalBias: texel * 1.5,
  };
}

/**
 * The frame for this moment: shadowFocus about `focus`, its radius on the
 * ladder (`kept`, the last frame's radius, holds until what's needed
 * outgrows it or shrinks under 60% of it), its centre on whole texels. With
 * `key`, which is the same exactly when the frame lands in the same place.
 * null: nothing to cover.
 * @returns {{ frame: ReturnType<typeof shadowFrame>, key: string } | null}
 */
export function fitShadow(boxes, focus, direction, kept = null) {
  const need = shadowFocus(boxes, focus);
  if (!need) return null;
  const radius = kept && need.radius <= kept && need.radius > kept * 0.6 ? kept : Math.min(ladderRadius(need.radius), Math.max(SHADOW_CAP, need.radius));
  const frame = shadowFrame({ center: need.center, radius }, direction, SHADOW_MAP);
  return { frame, key: `${frame.radius}|${frame.target.map((v) => Math.round(v / frame.texel)).join(",")}` };
}

/** Stand a directional light (three's) where a shadowFrame says, its shadow camera and biases with it. */
export function aimShadow(light, f) {
  light.position.set(...f.position);
  light.target.position.set(...f.target);
  light.target.updateMatrixWorld();
  const cam = light.shadow.camera;
  cam.left = cam.bottom = -f.radius;
  cam.right = cam.top = f.radius;
  cam.near = f.near;
  cam.far = f.far;
  cam.updateProjectionMatrix();
  light.shadow.bias = f.bias;
  light.shadow.normalBias = f.normalBias;
}

/**
 * Let every mesh under root cast and receive the sun's shadows (or not). A
 * mesh whose userData (a GLB node's extras) says receiveShadow: false only
 * casts: a one-sided sheet can't be biased right from both sides.
 */
export function castShadows(root, on) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = on;
    o.receiveShadow = on && o.userData?.receiveShadow !== false;
  });
}
