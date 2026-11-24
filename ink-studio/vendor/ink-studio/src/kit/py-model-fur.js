/* Grow an authored coat as solid locks and crossed, alpha-cutout ribbons. */
(function (K) {
  const V = K.V, clamp = K.clamp;
  function mask() {
    const width = 64, height = 64, pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width, v = (y + 0.5) / height;
      const edge = 2 * Math.abs(u - 0.5);
      const ridges = 0.5 + 0.5 * Math.sin(74 * u + 20 * u * u + 5 * v);
      const tip = 1.04 - 0.56 * edge * edge - ridges * 0.19;
      const alpha = clamp(Math.min((tip - v) * 22, (1 - edge) * 11), 0, 1);
      const offset = 4 * (x + y * width);
      pixels.set([255, 255, 255, Math.round(alpha * 255)], offset);
    }
    return { width, height, pixels };
  }
  const texture = mask();
  function hash(index) {
    let x = index | 0;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
  }
  function groom(mesh, surface, noise, color, { maxLocks = 1000, density = 20 } = {}) {
    if (!Number.isInteger(maxLocks) || maxLocks < 0 || maxLocks > 6000 || !Number.isFinite(density) || density <= 0)
      throw new Error('Invalid model fur budget');
    const candidates = [];
    for (const [index, face] of mesh.faces.entries()) {
      const [a, b, c] = face.map(i => mesh.points[i]);
      const cross = V.cross(V.sub(b, a), V.sub(c, a)), area = V.len(cross) * 0.5, normal = V.norm(cross);
      const mid = V.mul(V.add(V.add(a, b), c), 1 / 3), material = surface.surfaceAt(...mid).material;
      if (!material?.fur || !material.r?.length || !area) continue;
      const length = material.fur.len || 0.3;
      const samples = Math.min(24, density * area / (length * length));
      const n = Math.floor(samples) + Number(hash(index * 607 + 719) < samples % 1);
      for (let j = 0; j < n; j++) {
        const id = index * 29 + j, u = Math.sqrt(hash(id * 7 + 31)), v = hash(id * 19 + 67);
        const root = V.lerp(a, V.lerp(b, c, v), u);
        const { material: source, tag } = surface.surfaceAt(...root);
        if (source?.fur === material.fur) candidates.push({ root, anchor: { indices: face, barycentric: [1 - u, u * (1 - v), u * v] }, normal, material, tag, id, priority: hash(id * 151 + 67) });
      }
    }
    candidates.sort((a, b) => a.priority - b.priority);
    const create = (name, material) => ({
      name, points: [], faces: [], colors: [], partTags: [], skinPoints: [], skinAnchors: [], uvs: [], materials: [material]
    });
    const locks = create('Fur locks', { name: 'Fur locks', color: [1, 1, 1], roughness: 1 });
    const cards = create('Fur cards', {
      name: 'Fur cards', color: [1, 1, 1], roughness: 1, alphaMode: 'MASK', alphaCutoff: 0.48,
      doubleSided: true, texture
    });
    function vertex(out, p, root, anchor, tag, rgb) {
      out.points.push(p); out.colors.push(rgb); out.partTags.push(tag); out.skinPoints.push(root); out.skinAnchors.push(anchor);
      return out.points.length - 1;
    }
    function face(out, ids, uv) { out.faces.push(ids); out.uvs.push(uv); }
    for (const { root, anchor, normal: n, material, tag, id } of candidates.slice(0, maxLocks)) {
      const fur = material.fur, len = (fur.len || 0.3) * (0.7 + 0.7 * hash(id * 51 + 82));
      const lay = fur.lay ?? 0.5, droop = fur.droop ?? 0.35, clump = fur.clump ?? 0.6;
      const cb = fur.comb || [0, -1, 0];
      const comb = V.norm(V.mad(cb, n, -V.dot(n, cb)), V.perp(n));
      const freq = 0.7 / (fur.len || 0.3), [x, y, z] = V.mul(root, freq);
      const sway = [noise(x, y, z) - 0.5, noise(x + 19.1, y + 7.3, z + 3.7) - 0.5,
        noise(x + 5.2, y + 31.7, z + 11.9) - 0.5];
      const direction = V.norm(V.mad(V.lerp(n, comb, lay), sway, clump * 1.6), n);
      const side = V.perp(direction), other = V.cross(direction, side), ramp = material.r;
      const base = color(ramp[Math.floor(ramp.length * 0.32)]);
      const useRim = fur.rim && n[1] < 0.23 && hash(id * 193 + 17) < 0.73;
      const end = color(useRim ? fur.rim[Math.floor(hash(id * 29 + 233) * fur.rim.length)] : ramp.at(-1));
      const center = t => V.mad(V.mad(V.mad(root, n, -len * 0.06), direction, len * t), [0, -1, 0], len * droop * t * t * 0.55);
      const tint = t => V.lerp(base, end, (useRim ? 0.76 : 0.65) * t ** 3.5);
      const width = len * (0.063 + 0.066 * hash(id * 53 + 1)) * (fur.w ? 1.1 : 1);
      for (const across of [side, other]) {
        const rows = [];
        for (const t of [0, 0.3, 0.64, 1.08]) {
          const w = width * (1.2 - t * 0.77), c = center(t), col = tint(t);
          rows.push([-1, 1].map(sign => vertex(cards, V.mad(c, across, sign * w), root, anchor, tag, col)));
        }
        for (let j = 0; j < 3; j++) {
          const a = j / 3, b = (j + 1) / 3;
          face(cards, [rows[j][0], rows[j][1], rows[j + 1][1], rows[j + 1][0]], [[0, a], [1, a], [1, b], [0, b]]);
        }
      }
      if (hash(id * 23 + 79) > 0.45) continue;
      const rows = [];
      for (const t of [0, 0.34, 0.67]) {
        const w = width * (0.92 - t * 0.5), c = center(t);
        rows.push([side, other, V.mul(side, -1), V.mul(other, -1)].map(axis => vertex(locks, V.mad(c, axis, w), root, anchor, tag, tint(t))));
      }
      const top = vertex(locks, center(0.97), root, anchor, tag, tint(0.97));
      face(locks, rows[0].slice().reverse(), [[0, 0], [1, 0], [1, 1], [0, 1]]);
      for (let k = 0; k < 4; k++) {
        const b = (k + 1) % 4;
        for (let j = 0; j < 2; j++)
          face(locks, [rows[j][k], rows[j][b], rows[j + 1][b], rows[j + 1][k]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        face(locks, [rows[2][k], rows[2][b], top], [[0, 0], [1, 0], [0.5, 1]]);
      }
    }
    return [locks, cards].filter(mesh => mesh.faces.length);
  }

  K.procedural.geometry.modelFur = groom;
})(KIT);
