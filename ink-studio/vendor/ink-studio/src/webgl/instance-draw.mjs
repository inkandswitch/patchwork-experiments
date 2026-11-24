import { instancePlan, transformed, stampInstancePixelStyle, stampInstanceNormals } from './instances.mjs';

const rowSamples = 512;
const instanceWidth = 256, instanceStride = 64;
const slotsPerRow = instanceWidth * 4 / instanceStride;

// The same projected 3-sigma footprint as the shader, with three pixels of
// slack for its minimum covariance and pixel snapping. There is no far clip.
function visible(row, camera, sx, sy, padX, padY, scale) {
  const { authored, asset, center, extent, spread } = row;
  if (!authored.visible || !authored.opacity || asset.empty) return false;
  const [x,y,z] = center, m = camera.view, slack = .001 + 1e-6 * (Math.abs(x) + Math.abs(y) + Math.abs(z));
  const depth = -(m[2]*x + m[6]*y + m[10]*z + m[14]);
  const reach = extent + slack;
  if (depth + reach < camera.clipNear) return false;
  const a = Math.abs(m[0]*x + m[4]*y + m[8]*z + m[12]);
  const b = Math.abs(m[1]*x + m[5]*y + m[9]*z + m[13]);
  const dab = spread * Math.abs(scale);
  if (camera.ortho) return a <= sx + padX + reach + dab && b <= sy + padY + reach + dab;
  return a <= (sx + padX) * (depth + reach) + reach + dab * Math.hypot(1, 1.3 * sx) &&
    b <= (sy + padY) * (depth + reach) + reach + dab * Math.hypot(1, 1.3 * sy);
}

function record(target, { index, start, asset, matrix, at, authored, swatches, diagonal, mask }) {
  const o = (index + 1) * instanceStride;
  for (let i = 0; i < 3; i++) {
    const j = i * 3;
    target.set([matrix[j], matrix[j+1], matrix[j+2], at[i]], o + i * 4);
  }
  target.set([asset.offset - start, swatches.length, authored.opacity, +diagonal + 2 * !!mask], o + 12);
  if (diagonal) target.set([at[0],at[1],at[2],matrix[0]],o+52);
  if (mask) target.set(mask, o + 16);
  for (let i = 0; i < swatches.length; i++) target.set(swatches[i], o + 20 + i * 2);
}

export function groupVisibility(plan, camera, width, height, scale) {
  const sx = camera.tangent * camera.aspect, sy = camera.tangent;
  const padX = 6 * sx / width, padY = 6 * sy / height;
  return plan.rows.filter(row => visible(row,camera,sx,sy,padX,padY,scale));
}

function baseDirtyRows(world, rows) {
  return rows ?? Array.from({ length:Math.ceil(world.count / rowSamples) }, (_, i) => i);
}

export function createExpandedInstances() {
  let source, placementGroup, storage, revision;
  let sourceData, sourceCount, sourceFine, sourcePix, sourceMetadata, sourceStyles, sourceOptical;
  let packed;
  return function expand(world, group, changedRows) {
    const plan = instancePlan(group);
    if (world !== source || group !== placementGroup || world.data !== sourceData || world.count !== sourceCount ||
        world.fine !== sourceFine || world.pix !== sourcePix || world.renderMetadata !== sourceMetadata ||
        world.materialPixelStyles !== sourceStyles || world.opticalSplats !== sourceOptical) {
      storage = group.flatten(world);
      const { data, count, fine, pix, renderMetadata, materialPixelStyles, opticalSplats } = storage;
      packed = { data, count, fine, pix, renderMetadata, materialPixelStyles, opticalSplats };
      source = world;
      placementGroup = group;
      sourceData = world.data;
      sourceCount = world.count;
      sourceFine = world.fine;
      sourcePix = world.pix;
      sourceMetadata = world.renderMetadata;
      sourceStyles = world.materialPixelStyles;
      sourceOptical = world.opticalSplats;
      revision = plan.revision;
      return { world:storage };
    }
    Object.assign(storage,world,packed);
    const baseDirty = baseDirtyRows(world,changedRows), dirty = new Set(baseDirty);
    for (const row of baseDirty) {
      const from = row * rowSamples * 16, end = Math.min(from + rowSamples * 16, world.count * 16);
      storage.data.set(world.data.subarray(from,end),from);
      if (sourceOptical) storage.opticalSplats.set(
        sourceOptical.subarray(from / 16 * 12, end / 16 * 12), from / 16 * 12);
      const normals = world.renderMetadata?.normals;
      if (normals) storage.renderMetadata.normals.set(
        normals.subarray(from / 16 * 3, end / 16 * 3), from / 16 * 3);
    }
    if (revision !== plan.revision) {
      for (const row of plan.rows) {
        if (!(row.version > revision)) continue;
        const at = world.count + row.start;
        transformed(storage.data,row,at);
        stampInstancePixelStyle(storage.materialPixelStyles, row, at);
        stampInstanceNormals(storage.renderMetadata.normals, row, at);
        const end = Math.ceil((at + row.asset.count) / rowSamples);
        for (let r=Math.floor(at / rowSamples); r<end; r++) dirty.add(r);
      }
      revision = plan.revision;
    }
    return { world:storage, changedRows:[...dirty] };
  };
}

export function createInstanceDraw(table, geometry, maxSize) {
  const instances = table(instanceWidth, 15, maxSize);
  let previousGroup, atlas, settings, revision;
  let previousBase, previousData, previousCount;
  return {
    bind(group, world, dirtyRows, reload, data = world.data) {
      const plan = instancePlan(group);
      const fresh = previousGroup !== group || previousBase !== world || previousData !== world.data ||
        previousCount !== world.count;
      if (fresh) {
        const count = (world.count + plan.sharedCount) * 16;
        if (Math.ceil(count / (rowSamples * 16)) > maxSize)
          throw new RangeError('Shared splat geometry exceeds the WebGL texture size limit');
        atlas = new Float32Array(count);
        atlas.set(data.subarray(0, world.count * 16));
        for (const asset of plan.assets) atlas.set(asset.data, (world.count + asset.offset) * 16);
      }
      const dirty = baseDirtyRows(world,dirtyRows);
      if (!fresh) {
        for (const row of dirty) {
          const from = row * rowSamples * 16;
          atlas.set(data.subarray(from, Math.min(from + rowSamples * 16, world.count * 16)), from);
        }
      }
      geometry.upload(atlas, atlas.length, fresh || reload ? undefined : dirty);
      if (previousGroup !== group) {
        settings = new Float32Array((plan.rows.length + 1) * instanceStride);
        for (const row of plan.rows) record(settings,row);
        instances.upload(settings);
      } else if (revision !== plan.revision) {
        const dirty = new Set();
        for (const row of plan.rows) {
          if (!(row.version > revision)) continue;
          record(settings,row);
          dirty.add(Math.floor((row.index + 1) / slotsPerRow));
        }
        instances.upload(settings,settings.length,[...dirty]);
      } else instances.bind();
      previousGroup = group;
      previousBase = world;
      previousData = world.data;
      previousCount = world.count;
      revision = plan.revision;
      return plan;
    }
  };
}
