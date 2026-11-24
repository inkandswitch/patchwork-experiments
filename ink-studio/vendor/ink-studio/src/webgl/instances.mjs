/* Stable authored placements backed by immutable, native baked splats. */
const plans = new WeakMap();
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const zero = [0, 0, 0];
const maxCount = 0xffffff;
const name = value => typeof value === 'string' && /^[\w][\w.-]{0,95}$/.test(value);
const vector = (value, n) => Array.isArray(value) && value.length === n &&
  Array.from(value).every(x => Number.isFinite(x) && Math.abs(x) <= 1e6);
const color = /^#[\da-f]{6}$/i;
const fields = new Set(['id', 'prototype', 'position', 'rotation', 'scale', 'palette', 'damage', 'opacity', 'visible']);
const hex = text => parseInt(text.slice(5) + text.slice(3, 5) + text.slice(1, 3), 16);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function bounds(data, count) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const sortLo = lo.slice(), sortHi = hi.slice();
  let reach = 0;
  for (let i = 0; i < count * 16; i += 16) {
    const x=data[i], y=data[i+1], z=data[i+2], alpha=data[i+3], xx=data[i+4], xy=data[i+5],
      xz=data[i+6], rgb=data[i+7], yy=data[i+8], yz=data[i+9], zz=data[i+10], kind=data[i+11];
    if (![x,y,z,alpha,xx,xy,xz,yy,yz,zz].every(Number.isFinite) || Math.max(Math.abs(x),Math.abs(y),Math.abs(z)) > 1e6 ||
        alpha < 0 || alpha > 1e6 || !Number.isInteger(rgb) || rgb < 0 || rgb > maxCount ||
        !Number.isInteger(kind) || kind < 0 || kind % 16 || (kind & 1536) || xx < 0 || yy < 0 || zz < 0)
      throw new TypeError('Instance prototypes need finite, stationary baked splats');
    sortLo[0] = Math.min(sortLo[0],x); sortHi[0] = Math.max(sortHi[0],x);
    sortLo[1] = Math.min(sortLo[1],y); sortHi[1] = Math.max(sortHi[1],y);
    sortLo[2] = Math.min(sortLo[2],z); sortHi[2] = Math.max(sortHi[2],z);
    if (!alpha || y < -30) continue;
    lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x);
    lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y);
    lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z);
    reach = Math.max(reach, xx + Math.abs(xy) + Math.abs(xz), yy + Math.abs(xy) + Math.abs(yz),
      zz + Math.abs(xz) + Math.abs(yz));
  }
  const empty = lo[0] === Infinity;
  return { center: empty ? zero : lo.map((x, i) => (x + hi[i]) * .5),
    extent: empty ? 0 : Math.hypot(...lo.map((x, i) => (hi[i] - x) * .5)),
    spread: 3 * Math.sqrt(reach), empty, sortLo, sortHi };
}

function placement(raw, prototypes, old) {
  const row = { ...old?.authored, ...raw };
  const { id, prototype, position = zero, rotation = identity, scale = 1, palette = {},
    damage = null, opacity = 1, visible = true } = row;
  if (!name(id) || !prototypes.has(prototype) || Object.keys(row).some(key => !fields.has(key)) ||
      !vector(position, 3) || !vector(rotation, 9) || !Number.isFinite(scale) || scale < 1e-4 || scale > 1e4 ||
      !Number.isFinite(opacity) || opacity < 0 || opacity > 1 || typeof visible !== 'boolean' ||
      !palette || typeof palette !== 'object' || Array.isArray(palette))
    throw new TypeError('Invalid splat instance ' + id);
  const axes = [rotation.slice(0, 3), rotation.slice(3, 6), rotation.slice(6, 9)];
  const [a,b,c] = axes;
  if (axes.some(axis => Math.abs(dot(axis, axis) - 1) > 1e-5) ||
      Math.max(Math.abs(dot(a,b)),Math.abs(dot(a,c)),Math.abs(dot(b,c))) > 1e-5 ||
      dot([a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]], c) < .99999)
    throw new RangeError('Instance rotation must be a right-handed row-major orthonormal matrix');
  const swatches = Object.entries(palette);
  if (swatches.length > 16 || swatches.some(([a,b]) => !color.test(a) || typeof b !== 'string' || !color.test(b)) ||
      new Set(swatches.map(([a])=>hex(a))).size !== swatches.length)
    throw new TypeError('Instance palette needs up to 16 distinct #RRGGBB replacements');
  if (damage !== null && (!vector(damage?.center, 3) || !Number.isFinite(damage.radius) ||
      damage.radius <= 0 || damage.radius > 1e6))
    throw new TypeError('Instance damage needs a local XYZ center and positive radius');
  const asset = prototypes.get(prototype);
  const authored = Object.freeze({ id, prototype, position:Object.freeze(position.slice()),
    rotation:Object.freeze(rotation.slice()), scale, palette:Object.freeze({ ...palette }), opacity, visible,
    damage:damage && Object.freeze({ center:Object.freeze(damage.center.slice()), radius:damage.radius }) });
  const at = Float32Array.from(position), matrix = Float32Array.from(rotation, n => n * scale);
  const diagonal = rotation.every((n,i) => n === identity[i]);
  const center = [
    dot(matrix.subarray(0,3), asset.center) + at[0],
    dot(matrix.subarray(3,6), asset.center) + at[1],
    dot(matrix.subarray(6,9), asset.center) + at[2]
  ];
  return { authored, asset, at, matrix, center, diagonal,
    extent:asset.extent * scale * 1.00002, spread:asset.spread * scale * 1.00002,
    swatches:swatches.map(([a,b])=>[hex(a),hex(b)]), mask:damage&&Float32Array.from([...damage.center,damage.radius ** 2]) };
}

export function instancePlan(group) {
  const plan = plans.get(group);
  if (!plan) throw new TypeError('Expected instances from createSplatInstances');
  return plan;
}

export function createSplatInstances(prototypes, instances) {
  if (!prototypes || typeof prototypes !== 'object' || Array.isArray(prototypes) ||
      !Array.isArray(instances) || instances.length > 65535)
    throw new TypeError('Expected prototype table and authored instance array');
  const assets = new Map(), unique = new Map();
  let sharedCount = 0;
  for (const [id, world] of Object.entries(prototypes)) {
    if (!name(id) || !(world?.data instanceof Float32Array) || !Number.isSafeInteger(world.count) ||
        world.count <= 0 || world.count > maxCount || world.count * 16 > world.data.length ||
        world.moving?.length || world.back?.length || world.anim || world.fine || world.pix ||
        world.surfaceData || world.paintCorrections || world.effectParticles?.length || world.sortRanges?.length)
      throw new TypeError('Expected a stationary baked splat prototype for ' + id);
    let asset = unique.get(world);
    if (!asset) {
      const data = world.data.slice(0, world.count * 16);
      const sourceStyles = world.materialPixelStyles;
      if (sourceStyles != null && (!(sourceStyles instanceof Float32Array) || sourceStyles.length < world.count * 4))
        throw new TypeError('Instance material pixel styles are shorter than their prototype');
      if (world.opticalSplats != null && (!(world.opticalSplats instanceof Float32Array) ||
          world.opticalSplats.length !== world.count * 12))
        throw new TypeError('Instance optical materials must match the prototype splat count');
      asset = { offset:sharedCount, count:world.count, data,
        opticalSplats: world.opticalSplats?.slice(0, world.count * 12),
        normals: world.renderMetadata?.normals?.slice(0, world.count * 3),
        materialPixelStyles: sourceStyles?.slice(0, world.count * 4), ...bounds(data,world.count) };
      sharedCount += asset.count;
      if (sharedCount > maxCount) throw new RangeError('Too many shared splats');
      unique.set(world, asset);
    }
    assets.set(id, asset);
  }
  const ids = new Map(), rows = [];
  let count = 0;
  for (const raw of instances) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Expected an authored splat instance');
    const row = placement(raw, assets);
    if (ids.has(row.authored.id)) throw new TypeError('Duplicate splat instance ' + row.authored.id);
    ids.set(row.authored.id, rows.length);
    rows.push({ ...row, start:count, index:rows.length });
    count += row.asset.count;
    if (count > maxCount) throw new RangeError('Too many logical splats');
  }
  const plan = { rows, assets:[...unique.values()], count, sharedCount, revision:0, orderRevision:0,
    hasOpticalSplats: rows.some(row => row.asset.opticalSplats),
    hasMaterialPixelStyles: rows.some(row => row.asset.materialPixelStyles) };
  const api = Object.freeze({
    count:instances.length, splats:count, sharedSplats:sharedCount,
    get(id) { return rows[ids.get(id)]?.authored; },
    update(id, patch) {
      const i = ids.get(id), old = rows[i];
      if (!old || !patch || typeof patch !== 'object' || Array.isArray(patch) ||
          Object.hasOwn(patch, 'id') || Object.hasOwn(patch, 'prototype'))
        throw new TypeError('Updates need an existing instance and editable placement fields');
      const next = placement(patch, assets, old);
      next.start = old.start;
      next.index = old.index;
      next.version = ++plan.revision;
      if (next.authored.visible !== old.authored.visible || !!next.authored.opacity !== !!old.authored.opacity ||
          next.at.some((n,i)=>n!==old.at[i]) || next.matrix.some((n,i)=>n!==old.matrix[i])) plan.orderRevision++;
      rows[i] = next;
      return next.authored;
    },
    owner(logicalIndex, baseCount = 0) {
      const local = logicalIndex - baseCount;
      if (!Number.isSafeInteger(logicalIndex) || !Number.isSafeInteger(baseCount) || baseCount < 0 || local < 0 || local >= count)
        return undefined;
      let lo = 0, hi = rows.length;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (rows[mid].start <= local) lo = mid;
        else hi = mid;
      }
      const { start, authored } = rows[lo];
      return { id:authored.id, prototype:authored.prototype, splat:local - start };
    },
    flatten(base) { return flattened(base, plan); }
  });
  plans.set(api, plan);
  return api;
}

function transformed(out, row, start) {
  const { asset, matrix:a, at, authored, swatches, mask, diagonal } = row;
  const { opacity, visible } = authored, remap = new Map(swatches);
  for (let i = 0, j = start * 16; i < asset.count * 16; i += 16, j += 16) {
    const d = asset.data, x = d[i], y = d[i+1], z = d[i+2];
    const dx = x - mask?.[0], dy = y - mask?.[1], dz = z - mask?.[2];
    out[j] = a[0]*x + a[1]*y + a[2]*z + at[0];
    out[j+1] = a[3]*x + a[4]*y + a[5]*z + at[1];
    out[j+2] = a[6]*x + a[7]*y + a[8]*z + at[2];
    out[j+3] = !visible || y < -30 || mask && dx*dx + dy*dy + dz*dz <= mask[3] ? 0 : d[i+3] * opacity;
    const xx=d[i+4], xy=d[i+5], xz=d[i+6], yy=d[i+8], yz=d[i+9], zz=d[i+10];
    if (diagonal) {
      const s = a[0] * a[0];
      out[j+4]=xx*s; out[j+5]=xy*s; out[j+6]=xz*s;
      out[j+8]=yy*s; out[j+9]=yz*s; out[j+10]=zz*s;
    } else {
      for (let u=0; u<3; u++) {
        const m=u*3, p=a[m]*xx+a[m+1]*xy+a[m+2]*xz;
        const q=a[m]*xy+a[m+1]*yy+a[m+2]*yz, r=a[m]*xz+a[m+1]*yz+a[m+2]*zz;
        for (let v=u; v<3; v++) {
          const slot=u===0?4+v:u===1?7+v:10, n=v*3;
          out[j+slot]=p*a[n]+q*a[n+1]+r*a[n+2];
        }
      }
    }
    out[j+7] = remap.get(d[i+7]) ?? d[i+7];
    out[j+11] = d[i+11];
  }
}

function stampInstancePixelStyle(out, row, start) {
  const styles = row.asset.materialPixelStyles;
  if (!out || !styles) return;
  start *= 4;
  out.set(styles, start);
  if (!row.swatches.length) return;
  const remap = new Map(row.swatches);
  for (let i = start + 2; i < start + styles.length; i += 4) {
    out[i] = remap.get(out[i]) ?? out[i];
    out[i + 1] = remap.get(out[i + 1]) ?? out[i + 1];
  }
}

function stampInstanceNormals(out, { asset, authored: { rotation } }, start) {
  if (!out || !asset.normals) return;
  for (let i = 0, j = start * 3; i + 2 < asset.normals.length; i += 3, j += 3) {
    const x = asset.normals[i], y = asset.normals[i + 1], z = asset.normals[i + 2];
    for (let axis = 0; axis < 3; axis++) {
      const k = axis * 3;
      out[j + axis] = rotation[k] * x + rotation[k + 1] * y + rotation[k + 2] * z;
    }
  }
}

function flattened(base, plan) {
  validateSize(base.count, plan);
  const count = base.count + plan.count, data = new Float32Array(count * 16);
  data.set(base.data.subarray(0, base.count * 16));
  for (const row of plan.rows) transformed(data, row, base.count + row.start);
  const metadata = base.renderMetadata ?? {};
  const objects = [...(metadata.objects ?? [null])], targets = [...(metadata.targets ?? [null])];
  const objectIds = new Uint32Array(count), targetIds = new Uint32Array(count);
  if (metadata.objectIds) objectIds.set(metadata.objectIds.subarray(0,base.count));
  if (metadata.targetIds) targetIds.set(metadata.targetIds.subarray(0,base.count));
  for (const row of plan.rows) {
    const { id } = row.authored, start = base.count + row.start, end = start + row.asset.count;
    objectIds.fill(objects.push(id)-1,start,end);
    targetIds.fill(targets.push({ entity:id })-1,start,end);
  }
  const renderMetadata = { ...metadata, objects, targets, objectIds, targetIds };
  if (metadata.normals || plan.assets.some(asset => asset.normals)) {
    const normals = renderMetadata.normals = new Float32Array(count * 3);
    if (metadata.normals) normals.set(metadata.normals.subarray(0, base.count * 3));
    for (const row of plan.rows) stampInstanceNormals(normals, row, base.count + row.start);
  }
  const result = { ...base, count, data, renderMetadata };
  if (base.opticalSplats || plan.hasOpticalSplats) {
    const profiles = result.opticalSplats = new Float32Array(count * 12);
    if (base.opticalSplats) profiles.set(base.opticalSplats.subarray(0, base.count * 12));
    for (const row of plan.rows) if (row.asset.opticalSplats)
      profiles.set(row.asset.opticalSplats, (base.count + row.start) * 12);
  }
  if (base.materialPixelStyles || plan.hasMaterialPixelStyles) {
    const styles = result.materialPixelStyles = new Float32Array(count * 4);
    if (base.materialPixelStyles) styles.set(base.materialPixelStyles.subarray(0, base.count * 4));
    for (const row of plan.rows) stampInstancePixelStyle(styles, row, base.count + row.start);
  }
  for (const [key,stride] of [['fine',12],['pix',8]]) {
    if (!base[key]) continue;
    result[key] = new Float32Array(count * stride);
    result[key].set(base[key].subarray(0,base.count * stride));
  }
  return result;
}

export function validateSize(baseCount, plan) {
  if (baseCount + plan.count > maxCount || baseCount + plan.sharedCount > maxCount)
    throw new RangeError('Instances exceed the 24-bit splat address space');
}

export { transformed, stampInstancePixelStyle, stampInstanceNormals };
