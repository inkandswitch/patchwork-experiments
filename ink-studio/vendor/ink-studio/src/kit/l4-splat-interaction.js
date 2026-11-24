/* A display-only density plan. Every representative is an original sample,
   so selection, surface edits and the full bake keep their original indices. */
(function (K) {
  const indexBits = 25, indexLimit = 2 ** indexBits, scaleUnits = 16, maxCode = 31;

  function compile(world, cell, { preserveOwners = [] } = {}) {
    const { count, data, renderMetadata: meta, fine, surfaceData, materialAlbedo, materialPixelStyles } = world;
    const owners = world.owners ?? meta?.objectIds, materials = world.materialIds ?? meta?.materialIds;
    const surfaceNormals = world.surfaceNormals ?? meta?.normals;
    if (!(cell > 0) || !Number.isFinite(cell)) throw new Error('Invalid splat interaction cell');
    if (!Number.isSafeInteger(count) || count < 0 || !data || data.length < count * 16)
      throw new Error('Invalid splat interaction world');
    if (count >= indexLimit) return null;
    const protectedOwners = new Set(preserveOwners), protectedSlots = (world.ownerIds ?? meta?.objects ?? []).map(id => protectedOwners.has(id));
    const representative = new Int32Array(count), next = new Int32Array(count).fill(-1),
      scale = new Uint8Array(count), groups = new Map(), back = new Set(world.back || []);
    const unit = 1 / cell, ordered = new Uint8Array(count);
    for (const range of world.sortRanges || []) if (range.bias) ordered.fill(1, range.start, range.end);
    for (let i = 0; i < count; i++) {
      representative[i] = i;
      const at = i * 16, flags = Math.round(data[at + 11]), normal = i * 3;
      const x = data[at], y = data[at + 1], z = data[at + 2], owner = owners?.[i] || 0;
      // Preserve transparent, animated, fine-tiled and explicitly ordered
      // samples. They can overlap nearby opaque samples with different roles.
      if ((flags & 15) || data[at + 3] < 1 || y < -30 ||
          protectedSlots[owner] || fine?.[i * 12 + 11] > .5 ||
          (materialPixelStyles?.[i * 4 + 1] & MaterialPixelStyle.PAIR) || ordered[i] || back.has(i)) continue;
      const nx = Math.round((surfaceNormals?.[normal] || 0) * 2),
        ny = Math.round((surfaceNormals?.[normal + 1] || 0) * 2),
        nz = Math.round((surfaceNormals?.[normal + 2] || 0) * 2);
      const key = [owner, materials?.[i] || 0, meta?.targetIds?.[i] || 0,
        surfaceData?.[i * 8] || 0, materialAlbedo?.[i] || 0, materialPixelStyles?.[i * 4] || 0, flags,
        Math.floor(x * unit), Math.floor(y * unit), Math.floor(z * unit), nx, ny, nz].join('/');
      const group = groups.get(key);
      if (group) {
        next[group.last] = i;
        group.last = i;
        group.size++;
        group.x += x;
        group.y += y;
        group.z += z;
        group.square += x*x + y*y + z*z;
      } else {
        groups.set(key, { first:i, last:i, size:1, x, y, z, square:x*x + y*y + z*z });
      }
    }
    for (const { first, size, x, y, z, square } of groups.values()) {
      if (size < 2) continue;
      const cx = x / size, cy = y / size, cz = z / size;
      let sample = first, best = Infinity;
      for (let j = first; j >= 0; j = next[j]) {
        const at = j * 16, dx = data[at] - cx, dy = data[at + 1] - cy, dz = data[at + 2] - cz;
        const distance = dx*dx + dy*dy + dz*dz;
        if (distance < best) { best = distance; sample = j; }
      }
      const at = sample * 16;
      const variance = data[at + 4] + data[at + 8] + data[at + 10];
      if (variance <= 0) {
        for (let j = first; j >= 0;) {
          const following = next[j];
          next[j] = -1;
          j = following;
        }
        continue;
      }
      const spread = Math.max(0, square / size - cx*cx - cy*cy - cz*cz) + best;
      const wanted = Math.sqrt(1 + spread / variance);
      // Thin features can still share a representative at a distance.
      // Bound growth so a small dab never becomes a broad opaque patch.
      scale[sample] = Math.min(maxCode, Math.round((wanted - 1) * scaleUnits));
      let head = -1;
      for (let j = first; j >= 0;) {
        const following = next[j];
        representative[j] = sample;
        if (j !== sample) { next[j] = head; head = j; }
        j = following;
      }
      next[sample] = head;
    }
    const indices = new Int32Array(count);
    let length = 0;
    for (let i = 0; i < count; i++) if (representative[i] === i) indices[length++] = i;
    return { cell, indices:indices.slice(0, length), representative, next, scale };
  }

  function restore(level, edited, hidden, isHidden = () => false) {
    const representatives = new Set(), extras = [];
    for (const list of [edited, hidden]) for (const i of list) {
      const sample = level.representative[i];
      if (level.next[sample] >= 0) representatives.add(sample);
    }
    for (const sample of representatives) for (let j = level.next[sample]; j >= 0; j = level.next[j]) {
      if (!isHidden(j)) extras.push(j);
    }
    return { representatives, extras:Int32Array.from(extras.sort((a,b) => a-b)) };
  }

  K.splatInteractionDetail = Object.freeze({ compile, restore, indexBits, indexLimit, scaleUnits });
})(KIT);
