/* kb-mesh: other people's meshes, brought in as solids. A mesh is read, fitted to the scene, turned into a signed-distance field on a grid,
   and from there it is a solid like any other: it joins, is carved, casts shadows, breaks and burns, and bakes to splats.
     K.mesh.obj(text, mtlText)          Wavefront OBJ (polygons, negative indices, colours after a vertex, usemtl) with its MTL (Kd)
     K.mesh.gltf(json, buffers)         glTF 2.0: scene graph, indexed or plain triangles, COLOR_0, base colour factors. Buffers given as
                                        data: URIs are read from the file itself; others are passed in, in order
     K.mesh.glb(bytes)                  the same in its binary wrapper
     K.mesh.toObj(mesh)                 back out as OBJ text
     K.mesh.fit(mesh, o)                o: size (largest side), at [x, y, z], ground (rest on at.y), up ('z' for z-up files), turn (about y)
     K.mesh.info(mesh)                  { tris, verts, lo, hi, open (share of edges that do not join two faces), mats }
     K.mesh.field(mesh, o)              o: cells (along the longest side, 56), thick (a sheet is given this thickness; open meshes get one anyway)
                                        -> { sd(x, y, z), tri(x, y, z), lo, hi, h, open }
     K.mesh.look(mesh, o)               the mesh's colours as pixel-art ramps. o: hues (6), shades (4), bg (hex of colour 0), pal (use an
                                        existing palette instead of making one)  -> { pal, ramps, triHue, mat(S, field) }
     K.mesh.solid(S, mesh, mat, o)      add it to a sculpt (also S.mesh(mesh, mat, o) after K.sculpt). mat: a material, or a look
   Textures are not read: colour comes from materials and vertex colours. */
(function (K) {
  const M = (K.mesh = {}),
    TAU = Math.PI * 2;
  const hueOfName = name => {
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
    const a = (((h >>> 0) % 360) / 360) * TAU;
    return [0.6 + 0.25 * Math.cos(a), 0.6 + 0.25 * Math.cos(a - 2.094), 0.6 + 0.25 * Math.cos(a + 2.094)];
  };
  /* pos: xyz per vertex; tri: three vertex numbers per face; vcol: rgb per vertex or null; tmat: a material number per face; mats: [{ name, rgb }] */
  M.make = (pos, tri, vcol, tmat, mats) => ({
    pos: Float32Array.from(pos),
    tri: Uint32Array.from(tri),
    vcol: vcol ? Float32Array.from(vcol) : null,
    tmat: tmat ? Uint16Array.from(tmat) : new Uint16Array(tri.length / 3),
    mats: mats && mats.length ? mats : [{ name: 'default', rgb: [0.7, 0.7, 0.7] }]
  });

  // ---------------- reading ----------------
  M.mtl = text => {
    const out = {};
    let cur = null;
    for (const raw of text.split('\n')) {
      const w = raw.trim().split(/\s+/);
      if (w[0] === 'newmtl') {
        cur = w.slice(1).join(' ');
        out[cur] = [0.7, 0.7, 0.7];
      } else if (w[0] === 'Kd' && cur !== null) out[cur] = [+w[1], +w[2], +w[3]];
    }
    return out;
  };
  M.obj = (text, mtlText, { attributes = false } = {}) => {
    const P = [],
      C = [],
      T = [],
      TM = [],
      uv = [], n = [], uvFaces = [], normalFaces = [],
      mats = [{ name: 'default', rgb: [0.7, 0.7, 0.7] }],
      lib = mtlText ? M.mtl(mtlText) : {};
    let cur = 0,
      anyCol = false;
    for (const raw of text.split('\n')) {
      const ln = raw.trim();
      if (!ln || ln[0] === '#') continue;
      const w = ln.split(/\s+/);
      if (w[0] === 'v') {
        P.push(+w[1], +w[2], +w[3]);
        if (w.length >= 7) {
          C.push(+w[4], +w[5], +w[6]);
          anyCol = true;
        } else C.push(0.7, 0.7, 0.7);
      } else if (attributes && w[0] === 'vt') uv.push([+w[1], 1 - +w[2]]);
      else if (attributes && w[0] === 'vn') n.push([+w[1], +w[2], +w[3]]);
      else if (w[0] === 'f') {
        const index = (value, size) => {
          const i = parseInt(value, 10);
          return i < 0 ? size + i : i - 1;
        };
        const tokens = w.slice(1), ix = tokens.map(s => index(s, P.length / 3));
        const corners = attributes ? tokens.map(s => s.split('/')) : null;
        let triplets = ix.slice(2).map((_, i) => [0, i + 1, i + 2]);
        if (attributes && ix.length > 3) {
          const points = ix.map(i => P.slice(i * 3, i * 3 + 3)), first = points[0];
          let normal = [0, 0, 0];
          for (const [i, p] of points.entries())
            normal = K.V.add(normal, K.V.cross(K.V.sub(p, first), K.V.sub(points[(i + 1) % points.length], first)));
          const axis = [0, 1, 2].reduce((a, b) => Math.abs(normal[b]) > Math.abs(normal[a]) ? b : a);
          const flat = points.map(p => [p[(axis + 1) % 3], p[(axis + 2) % 3]]);
          triplets = K.procedural.geometry.triangulate2D(flat);
          if (normal[axis] < 0) triplets = triplets.map(tri => tri.slice().reverse());
        }
        for (const ids of triplets) {
          T.push(...ids.map(i => ix[i]));
          TM.push(cur);
          if (corners) {
            uvFaces.push(ids.map(i => uv[index(corners[i][1], uv.length)]));
            normalFaces.push(ids.map(i => n[index(corners[i][2], n.length)]));
          }
        }
      } else if (w[0] === 'usemtl') {
        const name = w.slice(1).join(' ');
        cur = mats.findIndex(m => m.name === name);
        if (cur < 0) {
          cur = mats.length;
          mats.push({ name, rgb: lib[name] || hueOfName(name) });
        }
      }
    }
    const mesh = M.make(P, T, anyCol ? C : null, TM, mats);
    if (attributes && T.length) {
      if (uvFaces.every(face => face.every(Boolean))) mesh.uvs = uvFaces;
      if (normalFaces.every(face => face.every(Boolean))) mesh.cornerNormals = normalFaces;
    }
    return mesh;
  };
  M.toObj = mesh => {
    const out = [],
      p = mesh.pos,
      t = mesh.tri,
      c = mesh.vcol,
      f = v => +v.toFixed(5);
    for (let i = 0; i < p.length; i += 3)
      out.push(
        'v ' +
          f(p[i]) +
          ' ' +
          f(p[i + 1]) +
          ' ' +
          f(p[i + 2]) +
          (c ? ' ' + f(c[i]) + ' ' + f(c[i + 1]) + ' ' + f(c[i + 2]) : '')
      );
    let cur = -1;
    for (let i = 0; i < t.length; i += 3) {
      const m = mesh.tmat[i / 3];
      if (m !== cur) {
        cur = m;
        out.push('usemtl ' + mesh.mats[m].name);
      }
      out.push('f ' + (t[i] + 1) + ' ' + (t[i + 1] + 1) + ' ' + (t[i + 2] + 1));
    }
    return out.join('\n') + '\n';
  };
  const bytesOf = b =>
      b instanceof Uint8Array ? b : new Uint8Array(b.buffer ? b.buffer : b, b.byteOffset || 0, b.byteLength),
    unb64 = s => {
      const bin = atob(s),
        u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    };
  const mat4 = {
    mul: (a, b) => {
      const o = new Array(16);
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 4; r++)
          o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      return o;
    },
    trs: n => {
      if (n.matrix) return n.matrix;
      const t = n.translation || [0, 0, 0],
        q = n.rotation || [0, 0, 0, 1],
        s = n.scale || [1, 1, 1],
        x = q[0],
        y = q[1],
        z = q[2],
        w = q[3];
      return [
        (1 - 2 * (y * y + z * z)) * s[0],
        2 * (x * y + z * w) * s[0],
        2 * (x * z - y * w) * s[0],
        0,
        2 * (x * y - z * w) * s[1],
        (1 - 2 * (x * x + z * z)) * s[1],
        2 * (y * z + x * w) * s[1],
        0,
        2 * (x * z + y * w) * s[2],
        2 * (y * z - x * w) * s[2],
        (1 - 2 * (x * x + y * y)) * s[2],
        0,
        t[0],
        t[1],
        t[2],
        1
      ];
    }
  };
  const COMP = {
      5120: [1, 'getInt8', 127],
      5121: [1, 'getUint8', 255],
      5122: [2, 'getInt16', 32767],
      5123: [2, 'getUint16', 65535],
      5125: [4, 'getUint32', 4294967295],
      5126: [4, 'getFloat32', 1]
    },
    WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  M.gltfTransforms = Object.freeze(mat4);
  M.gltf = (json, bins, { visitNode, visitPrimitive } = {}) => {
    const g = typeof json === 'string' ? JSON.parse(json) : json,
      bufs = (g.buffers || []).map((b, i) =>
        bins && bins[i]
          ? bytesOf(bins[i])
          : b.uri && b.uri.startsWith('data:')
            ? unb64(b.uri.slice(b.uri.indexOf(',') + 1))
            : null
      );
    const acc = i => {
      const a = g.accessors[i],
        bv = g.bufferViews[a.bufferView],
        buf = bufs[bv.buffer];
      if (!buf) throw new Error('glTF: buffer ' + bv.buffer + ' was not given');
      const [sz, fn, top] = COMP[a.componentType],
        w = WIDTH[a.type],
        stride = bv.byteStride || sz * w,
        dv = new DataView(buf.buffer, buf.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0)),
        k = a.normalized ? 1 / top : 1;
      return {
        n: a.count,
        w,
        get: (e, c) => dv[fn](e * stride + c * sz, true) * k,
        ints: a.componentType !== 5126 && !a.normalized,
        top
      };
    };
    const P = [],
      C = [],
      T = [],
      TM = [],
      mats = [{ name: 'default', rgb: [0.7, 0.7, 0.7] }],
      matOf = new Map();
    let anyCol = false,
      skipped = 0;
    const useMat = i => {
      if (i === undefined) return 0;
      if (!matOf.has(i)) {
        const m = g.materials[i],
          f = (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorFactor) || [0.7, 0.7, 0.7];
        matOf.set(i, mats.length);
        mats.push({ name: m.name || 'material ' + i, rgb: [f[0], f[1], f[2]].map(v => Math.pow(v, 1 / 2.2)) });
      }
      return matOf.get(i);
    };
    const walk = (ni, parent) => {
      const n = g.nodes[ni],
        m = mat4.mul(parent, mat4.trs(n));
      if (visitNode && n.name !== undefined) visitNode(n.name, m.slice());
      if (n.mesh !== undefined)
        for (const pr of g.meshes[n.mesh].primitives) {
          if (pr.mode !== undefined && pr.mode !== 4) {
            skipped++;
            continue;
          }
          const pa = acc(pr.attributes.POSITION),
            ca = pr.attributes.COLOR_0 !== undefined ? acc(pr.attributes.COLOR_0) : null,
            base = P.length / 3,
            firstFace = TM.length,
            mi = useMat(pr.material),
            mrgb = mats[mi].rgb;
          for (let e = 0; e < pa.n; e++) {
            const x = pa.get(e, 0),
              y = pa.get(e, 1),
              z = pa.get(e, 2);
            P.push(
              m[0] * x + m[4] * y + m[8] * z + m[12],
              m[1] * x + m[5] * y + m[9] * z + m[13],
              m[2] * x + m[6] * y + m[10] * z + m[14]
            );
            if (ca) {
              const k = ca.ints ? 1 / ca.top : 1,
                tint = pr.material === undefined ? [1, 1, 1] : mrgb;
              C.push(
                Math.pow(ca.get(e, 0) * k, 1 / 2.2) * tint[0],
                Math.pow(ca.get(e, 1) * k, 1 / 2.2) * tint[1],
                Math.pow(ca.get(e, 2) * k, 1 / 2.2) * tint[2]
              );
              anyCol = true;
            } else C.push(mrgb[0], mrgb[1], mrgb[2]);
          }
          if (pr.indices !== undefined) {
            const ia = acc(pr.indices);
            for (let e = 0; e + 2 < ia.n; e += 3) {
              T.push(base + ia.get(e, 0), base + ia.get(e + 1, 0), base + ia.get(e + 2, 0));
              TM.push(mi);
            }
          } else
            for (let e = 0; e + 2 < pa.n; e += 3) {
              T.push(base + e, base + e + 1, base + e + 2);
              TM.push(mi);
            }
          if (visitPrimitive) visitPrimitive(pr, { firstVertex:base, vertexCount:pa.n,
            firstFace, faceCount:TM.length-firstFace, accessor:acc, matrix:m.slice() });
        }
      for (const c of n.children || []) walk(c, m);
    };
    const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      roots =
        g.scenes && g.scenes.length
          ? g.scenes[g.scene || 0].nodes
          : (g.nodes || []).map((n, i) => i).filter(i => !(g.nodes || []).some(n => (n.children || []).includes(i)));
    for (const r of roots) walk(r, ID);
    const mesh = M.make(P, T, anyCol ? C : null, TM, mats);
    mesh.skipped = skipped;
    return mesh;
  };
  M.glbParts = bytes => {
    const u = bytesOf(bytes),
      dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
    let o = 12,
      json = null;
    const bins = [];
    while (o + 8 <= u.byteLength) {
      const len = dv.getUint32(o, true),
        kind = dv.getUint32(o + 4, true),
        body = u.subarray(o + 8, o + 8 + len);
      if (kind === 0x4e4f534a) {
        let s = '';
        for (let i = 0; i < body.length; i += 8192) s += String.fromCharCode.apply(null, body.subarray(i, i + 8192));
        json = JSON.parse(decodeURIComponent(escape(s)));
      } else if (kind === 0x004e4942) bins.push(body);
      o += 8 + len;
    }
    return { json, bins };
  };
  M.glb = bytes => {
    const { json, bins } = M.glbParts(bytes);
    return M.gltf(json, bins);
  };

  // ---------------- fitting ----------------
  M.box = mesh => {
    const lo = [1e9, 1e9, 1e9],
      hi = [-1e9, -1e9, -1e9],
      p = mesh.pos;
    for (let i = 0; i < p.length; i++) {
      const a = i % 3;
      if (p[i] < lo[a]) lo[a] = p[i];
      if (p[i] > hi[a]) hi[a] = p[i];
    }
    return { lo, hi };
  };
  M.fit = (mesh, o) => {
    o = o || {};
    const p = Float32Array.from(mesh.pos),
      at = o.at || [0, 0, 0],
      c = Math.cos(o.turn || 0),
      s = Math.sin(o.turn || 0);
    for (let i = 0; i < p.length; i += 3) {
      let x = p[i],
        y = p[i + 1],
        z = p[i + 2];
      if (o.up === 'z') {
        const t = y;
        y = z;
        z = -t;
      }
      p[i] = x * c + z * s;
      p[i + 1] = y;
      p[i + 2] = -x * s + z * c;
    }
    const out = Object.assign({}, mesh, { pos: p }),
      b = M.box(out),
      k = o.size ? o.size / Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2], 1e-9) : 1,
      cx = (b.lo[0] + b.hi[0]) / 2,
      cz = (b.lo[2] + b.hi[2]) / 2,
      y0 = o.ground === false ? (b.lo[1] + b.hi[1]) / 2 : b.lo[1];
    for (let i = 0; i < p.length; i += 3) {
      p[i] = (p[i] - cx) * k + at[0];
      p[i + 1] = (p[i + 1] - y0) * k + at[1];
      p[i + 2] = (p[i + 2] - cz) * k + at[2];
    }
    if (mesh.sockets) {
      const rotate = ([x, y, z]) => {
        if (o.up === 'z') [y, z] = [z, -y];
        return [x * c + z * s, y, -x * s + z * c];
      };
      const center = [cx, y0, cz];
      out.sockets = Object.fromEntries(Object.entries(mesh.sockets).map(([id, socket]) => [
        id, { p: rotate(socket.p).map((value, i) => (value - center[i]) * k + at[i]), dir: rotate(socket.dir) }
      ]));
    }
    return out;
  };
  M.info = mesh => {
    const t = mesh.tri,
      nv = mesh.pos.length / 3,
      edges = new Map();
    for (let i = 0; i < t.length; i += 3)
      for (let e = 0; e < 3; e++) {
        const a = t[i + e],
          b = t[i + ((e + 1) % 3)],
          k = a < b ? a * nv + b : b * nv + a;
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    let odd = 0;
    for (const n of edges.values()) if (n !== 2) odd++;
    const b = M.box(mesh);
    return {
      tris: t.length / 3,
      verts: nv,
      lo: b.lo,
      hi: b.hi,
      open: edges.size ? odd / edges.size : 1,
      mats: mesh.mats.map(m => m.name)
    };
  };

  // ---------------- the field ----------------
  /* nearest point of triangle abc to p: returns the squared distance (Ericson) */
  const triD2 = (px, py, pz, P, a, b, c) => {
    const ax = P[a],
      ay = P[a + 1],
      az = P[a + 2],
      abx = P[b] - ax,
      aby = P[b + 1] - ay,
      abz = P[b + 2] - az,
      acx = P[c] - ax,
      acy = P[c + 1] - ay,
      acz = P[c + 2] - az,
      apx = px - ax,
      apy = py - ay,
      apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz,
      d2 = acx * apx + acy * apy + acz * apz;
    let v, w;
    if (d1 <= 0 && d2 <= 0) {
      v = 0;
      w = 0;
    } else {
      const bpx = apx - abx,
        bpy = apy - aby,
        bpz = apz - abz,
        d3 = abx * bpx + aby * bpy + abz * bpz,
        d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) {
        v = 1;
        w = 0;
      } else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) {
          v = d1 / (d1 - d3);
          w = 0;
        } else {
          const cpx = apx - acx,
            cpy = apy - acy,
            cpz = apz - acz,
            d5 = abx * cpx + aby * cpy + abz * cpz,
            d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) {
            v = 0;
            w = 1;
          } else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) {
              v = 0;
              w = d2 / (d2 - d6);
            } else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
                w = (d4 - d3) / (d4 - d3 + d5 - d6);
                v = 1 - w;
              } else {
                const den = 1 / (va + vb + vc);
                v = vb * den;
                w = vc * den;
              }
            }
          }
        }
      }
    }
    const dx = apx - abx * v - acx * w,
      dy = apy - aby * v - acy * w,
      dz = apz - abz * v - acz * w;
    return dx * dx + dy * dy + dz * dz;
  };
  M.gridSampler = (lo, n, h, D) => {
    const [n0, n1, n2] = n;
    return (x, y, z) => {
      let gx = (x - lo[0]) / h,
        gy = (y - lo[1]) / h,
        gz = (z - lo[2]) / h,
        out = 0;
      if (gx < 0) {
        out += gx * gx;
        gx = 0;
      } else if (gx > n0 - 1) {
        out += (gx - n0 + 1) * (gx - n0 + 1);
        gx = n0 - 1;
      }
      if (gy < 0) {
        out += gy * gy;
        gy = 0;
      } else if (gy > n1 - 1) {
        out += (gy - n1 + 1) * (gy - n1 + 1);
        gy = n1 - 1;
      }
      if (gz < 0) {
        out += gz * gz;
        gz = 0;
      } else if (gz > n2 - 1) {
        out += (gz - n2 + 1) * (gz - n2 + 1);
        gz = n2 - 1;
      }
      const i = Math.min(n0 - 2, gx | 0),
        j = Math.min(n1 - 2, gy | 0),
        k = Math.min(n2 - 2, gz | 0),
        fx = gx - i,
        fy = gy - j,
        fz = gz - k,
        q = i + n0 * (j + n1 * k),
        q2 = q + n0 * n1;
      const c00 = D[q] + (D[q + 1] - D[q]) * fx,
        c10 = D[q + n0] + (D[q + n0 + 1] - D[q + n0]) * fx,
        c01 = D[q2] + (D[q2 + 1] - D[q2]) * fx,
        c11 = D[q2 + n0] + (D[q2 + n0 + 1] - D[q2 + n0]) * fx,
        c0 = c00 + (c10 - c00) * fy,
        c1 = c01 + (c11 - c01) * fy;
      return c0 + (c1 - c0) * fz + (out > 0 ? Math.sqrt(out) * h : 0);
    };
  };
  M.field = (mesh, o) => {
    o = o || {};
    const P = mesh.pos,
      T = mesh.tri,
      NT = T.length / 3,
      b = M.box(mesh),
      ext = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]],
      h = Math.max(ext[0], ext[1], ext[2]) / (o.cells || 56),
      pad = 3;
    const lo = [b.lo[0] - pad * h, b.lo[1] - pad * h, b.lo[2] - pad * h],
      n = ext.map(e => Math.ceil(e / h) + 2 * pad + 1),
      n0 = n[0],
      n1 = n[1],
      n2 = n[2],
      NN = n0 * n1 * n2,
      d2 = new Float32Array(NN).fill(1e18),
      near = new Int32Array(NN).fill(-1);
    // every face writes its own distance into the nodes round it
    for (let t = 0; t < NT; t++) {
      const a = T[t * 3] * 3,
        bb = T[t * 3 + 1] * 3,
        c = T[t * 3 + 2] * 3,
        r = [0, 0, 0, 0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const mn = Math.min(P[a + k], P[bb + k], P[c + k]),
          mx = Math.max(P[a + k], P[bb + k], P[c + k]);
        r[k] = Math.max(0, Math.floor((mn - lo[k]) / h) - 1);
        r[k + 3] = Math.min(n[k] - 1, Math.ceil((mx - lo[k]) / h) + 1);
      }
      for (let z = r[2]; z <= r[5]; z++)
        for (let y = r[1]; y <= r[4]; y++)
          for (let x = r[0]; x <= r[3]; x++) {
            const i = x + n0 * (y + n1 * z),
              d = triD2(lo[0] + x * h, lo[1] + y * h, lo[2] + z * h, P, a, bb, c);
            if (d < d2[i]) {
              d2[i] = d;
              near[i] = t;
            }
          }
    }
    // and the rest learn theirs from their neighbours: the face nearest the node next door is tried here too, sweeping every way across the grid
    for (let round = 0; round < 2; round++)
      for (let dir = 0; dir < 8; dir++) {
        const sx = dir & 1 ? 1 : -1,
          sy = dir & 2 ? 1 : -1,
          sz = dir & 4 ? 1 : -1;
        for (let zz = 0; zz < n2; zz++) {
          const z = sz > 0 ? zz : n2 - 1 - zz;
          for (let yy = 0; yy < n1; yy++) {
            const y = sy > 0 ? yy : n1 - 1 - yy;
            for (let xx = 0; xx < n0; xx++) {
              const x = sx > 0 ? xx : n0 - 1 - xx,
                i = x + n0 * (y + n1 * z);
              for (let q = 0; q < 3; q++) {
                const X = x - (q === 0 ? sx : 0),
                  Y = y - (q === 1 ? sy : 0),
                  Z = z - (q === 2 ? sz : 0);
                if (X < 0 || Y < 0 || Z < 0 || X >= n0 || Y >= n1 || Z >= n2) continue;
                const t = near[X + n0 * (Y + n1 * Z)];
                if (t < 0 || t === near[i]) continue;
                const d = triD2(
                  lo[0] + x * h,
                  lo[1] + y * h,
                  lo[2] + z * h,
                  P,
                  T[t * 3] * 3,
                  T[t * 3 + 1] * 3,
                  T[t * 3 + 2] * 3
                );
                if (d < d2[i]) {
                  d2[i] = d;
                  near[i] = t;
                }
              }
            }
          }
        }
      }
    // inside or out: a line through the grid along each axis in turn counts the faces it has crossed; two of the three have to agree
    const votes = new Uint8Array(NN),
      JIT = [0.000137, 0.000291, 0.000213];
    for (let ax = 0; ax < 3; ax++) {
      const u = (ax + 1) % 3,
        v = (ax + 2) % 3,
        nu = n[u],
        nv = n[v],
        cols = new Array(nu * nv);
      for (let t = 0; t < NT; t++) {
        const a = T[t * 3] * 3,
          bb = T[t * 3 + 1] * 3,
          c = T[t * 3 + 2] * 3,
          au = P[a + u],
          av = P[a + v],
          bu = P[bb + u],
          bv = P[bb + v],
          cu = P[c + u],
          cv = P[c + v],
          den = (bu - au) * (cv - av) - (cu - au) * (bv - av);
        if (Math.abs(den) < 1e-14) continue;
        const u0 = Math.max(0, Math.ceil((Math.min(au, bu, cu) - lo[u]) / h - 1)),
          u1 = Math.min(nu - 1, Math.floor((Math.max(au, bu, cu) - lo[u]) / h + 1)),
          v0 = Math.max(0, Math.ceil((Math.min(av, bv, cv) - lo[v]) / h - 1)),
          v1 = Math.min(nv - 1, Math.floor((Math.max(av, bv, cv) - lo[v]) / h + 1));
        for (let j = v0; j <= v1; j++)
          for (let i = u0; i <= u1; i++) {
            const pu = lo[u] + (i + JIT[u]) * h,
              pv = lo[v] + (j + JIT[v]) * h,
              s = ((pu - au) * (cv - av) - (cu - au) * (pv - av)) / den,
              r = ((bu - au) * (pv - av) - (pu - au) * (bv - av)) / den;
            if (s < 0 || r < 0 || s + r > 1) continue;
            (cols[i + nu * j] || (cols[i + nu * j] = [])).push(
              P[a + ax] + (P[bb + ax] - P[a + ax]) * s + (P[c + ax] - P[a + ax]) * r
            );
          }
      }
      const idx = [0, 0, 0];
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const hits = cols[i + nu * j];
          if (!hits) continue;
          hits.sort((p, q) => p - q);
          let k = 0;
          idx[u] = i;
          idx[v] = j;
          for (let w = 0; w < n[ax]; w++) {
            const pw = lo[ax] + (w + JIT[ax]) * h;
            while (k < hits.length && hits[k] < pw) k++;
            if (k & 1) {
              idx[ax] = w;
              votes[idx[0] + n0 * (idx[1] + n1 * idx[2])]++;
            }
          }
        }
    }
    const info = M.info(mesh),
      open = info.open > 0.02,
      thick = o.thick !== undefined ? o.thick : open ? 1.6 * h : 0,
      D = new Float32Array(NN);
    for (let i = 0; i < NN; i++) {
      const d = Math.sqrt(d2[i]);
      let s = votes[i] >= 2 ? -d : d;
      if (thick > 0) s = Math.min(s, d - thick / 2);
      D[i] = s;
    }
    const hi = [lo[0] + (n0 - 1) * h, lo[1] + (n1 - 1) * h, lo[2] + (n2 - 1) * h];
    return M.fieldFromData({ lo, hi, h, n, open, thick, D, near });
  };
  M.fieldFromData = ({ lo, hi, h, n, open, thick, D, near }) => {
    const [n0, n1, n2] = n;
    const sd = M.gridSampler(lo, n, h, D);
    const tri = (x, y, z) =>
      near[
        Math.max(0, Math.min(n0 - 1, Math.round((x - lo[0]) / h))) +
          n0 *
            (Math.max(0, Math.min(n1 - 1, Math.round((y - lo[1]) / h))) +
              n1 * Math.max(0, Math.min(n2 - 1, Math.round((z - lo[2]) / h))))
      ];
    return { sd, tri, lo, hi, h, n, open, thick, D, near };
  };

  // ---------------- colour ----------------
  const hexOf = c =>
      (Math.round(K.clamp(c[0], 0, 1) * 255) << 16) |
      (Math.round(K.clamp(c[1], 0, 1) * 255) << 8) |
      Math.round(K.clamp(c[2], 0, 1) * 255),
    rgbOf = hx => [((hx >> 16) & 255) / 255, ((hx >> 8) & 255) / 255, (hx & 255) / 255];
  /* a colour in `shades` steps from shadow to light: shadows lean to blue and lose a little colour, lights lean warm, the way a pixel artist would shift them */
  M.ramp = (rgb, shades) => {
    const out = [];
    for (let s = 0; s < shades; s++) {
      const u = shades > 1 ? s / (shades - 1) : 0.6,
        f = 0.36 + 0.82 * u,
        cool = Math.max(0, 0.62 - u) * 0.5,
        warm = Math.max(0, u - 0.7) * 0.9;
      out.push(
        [
          rgb[0] * f * (1 - cool) + 0.07 * cool + (1.0 - rgb[0] * f) * warm * 0.5,
          rgb[1] * f * (1 - cool) + 0.06 * cool + (0.95 - rgb[1] * f) * warm * 0.45,
          rgb[2] * f * (1 - cool) + 0.2 * cool + (0.8 - rgb[2] * f) * warm * 0.3
        ].map(v => K.clamp(v, 0, 1))
      );
    }
    return out;
  };
  M.look = (mesh, o) => {
    o = o || {};
    const T = mesh.tri,
      P = mesh.pos,
      NT = T.length / 3,
      shades = o.shades || 4,
      col = new Float32Array(NT * 3),
      wgt = new Float32Array(NT);
    for (let t = 0; t < NT; t++) {
      const a = T[t * 3] * 3,
        b = T[t * 3 + 1] * 3,
        c = T[t * 3 + 2] * 3,
        ux = P[b] - P[a],
        uy = P[b + 1] - P[a + 1],
        uz = P[b + 2] - P[a + 2],
        vx = P[c] - P[a],
        vy = P[c + 1] - P[a + 1],
        vz = P[c + 2] - P[a + 2];
      wgt[t] = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) + 1e-12;
      if (mesh.vcol)
        for (let k = 0; k < 3; k++) col[t * 3 + k] = (mesh.vcol[a + k] + mesh.vcol[b + k] + mesh.vcol[c + k]) / 3;
      else {
        const m = mesh.mats[mesh.tmat[t]].rgb;
        col[t * 3] = m[0];
        col[t * 3 + 1] = m[1];
        col[t * 3 + 2] = m[2];
      }
    }
    // gather the colours that are really different, then settle on a few of them: first the heaviest, then whichever is furthest from those already taken
    const bins = new Map();
    for (let t = 0; t < NT; t++) {
      const k =
        (Math.round(col[t * 3] * 31) << 10) | (Math.round(col[t * 3 + 1] * 31) << 5) | Math.round(col[t * 3 + 2] * 31);
      let e = bins.get(k);
      if (!e) bins.set(k, (e = [0, 0, 0, 0]));
      e[0] += col[t * 3] * wgt[t];
      e[1] += col[t * 3 + 1] * wgt[t];
      e[2] += col[t * 3 + 2] * wgt[t];
      e[3] += wgt[t];
    }
    const pts = [...bins.values()].map(e => [e[0] / e[3], e[1] / e[3], e[2] / e[3], e[3]]).sort((p, q) => q[3] - p[3]),
      want = Math.min(o.hues || 6, pts.length, Math.floor(47 / shades)),
      dist = (p, q) =>
        (p[0] - q[0]) * (p[0] - q[0]) * 0.3 +
        (p[1] - q[1]) * (p[1] - q[1]) * 0.59 +
        (p[2] - q[2]) * (p[2] - q[2]) * 0.11;
    let cen = [pts[0].slice(0, 3)];
    while (cen.length < want) {
      let best = null,
        bd = -1;
      for (const p of pts) {
        let d = 1e9;
        for (const c of cen) d = Math.min(d, dist(p, c));
        d *= Math.sqrt(p[3]);
        if (d > bd) {
          bd = d;
          best = p;
        }
      }
      cen.push(best.slice(0, 3));
    }
    for (let it = 0; it < 8; it++) {
      const sum = cen.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0,
          bd = 1e9;
        cen.forEach((c, i) => {
          const d = dist(p, c);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        });
        const s = sum[bi];
        s[0] += p[0] * p[3];
        s[1] += p[1] * p[3];
        s[2] += p[2] * p[3];
        s[3] += p[3];
      }
      cen = cen.map((c, i) =>
        sum[i][3] > 0 ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c
      );
    }
    const triHue = new Uint8Array(NT);
    for (let t = 0; t < NT; t++) {
      let bi = 0,
        bd = 1e9;
      const p = [col[t * 3], col[t * 3 + 1], col[t * 3 + 2]];
      cen.forEach((c, i) => {
        const d = dist(p, c);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      triHue[t] = bi;
    }
    let pal, ramps;
    if (o.pal) {
      pal = o.pal;
      const prgb = pal.map(rgbOf);
      ramps = cen.map(c =>
        M.ramp(c, shades).map(s => {
          let bi = 1,
            bd = 1e9;
          for (let i = 1; i < prgb.length; i++) {
            const d = dist(s, prgb[i]);
            if (d < bd) {
              bd = d;
              bi = i;
            }
          }
          return bi;
        })
      );
    } else {
      pal = [o.bg === undefined ? 0x07080b : o.bg];
      ramps = cen.map(c => M.ramp(c, shades).map(s => pal.push(hexOf(s)) - 1));
    }
    const look = {
      pal,
      ramps,
      triHue,
      hues: cen,
      mat: (S, field, extra) =>
        Object.assign(
          {
            r: ramps[0],
            tex: (x, y, z, ny, t) => {
              const ti = field.tri(x, y, z),
                r = ramps[ti < 0 ? 0 : triHue[ti]];
              return r[K.clamp(Math.floor(t * r.length), 0, r.length - 1)];
            }
          },
          extra
        )
    };
    return look;
  };

  // ---------------- the solid ----------------
  M.solid = (S, mesh, mat, o) => {
    o = o || {};
    const field = o.field || M.field(mesh, { cells: o.cells, thick: o.thick }),
      b = M.box(mesh),
      bc = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2],
      P = mesh.pos,
      T = mesh.tri,
      NT = T.length / 3,
      sheet = field.thick > 0 && field.open;
    const p = {
      bc,
      br: Math.hypot(b.hi[0] - bc[0], b.hi[1] - bc[1], b.hi[2] - bc[2]) + field.thick,
      sd: field.sd,
      field,
      mesh,
      sample(f) {
        const unit = this.res * this.res * 0.8;
        let carry = 0.5,
          k = 0;
        for (let t = 0; t < NT; t++) {
          const a = T[t * 3] * 3,
            bb = T[t * 3 + 1] * 3,
            c = T[t * 3 + 2] * 3,
            ux = P[bb] - P[a],
            uy = P[bb + 1] - P[a + 1],
            uz = P[bb + 2] - P[a + 2],
            vx = P[c] - P[a],
            vy = P[c + 1] - P[a + 1],
            vz = P[c + 2] - P[a + 2],
            nx = uy * vz - uz * vy,
            ny = uz * vx - ux * vz,
            nz = ux * vy - uy * vx,
            nl = Math.hypot(nx, ny, nz);
          carry += (0.5 * nl) / unit;
          const cnt = Math.floor(carry);
          carry -= cnt;
          for (let q = 0; q < cnt; q++) {
            k++;
            let r1 = (k * 0.7548776662466927) % 1,
              r2 = (k * 0.5698402909980532) % 1;
            if (r1 + r2 > 1) {
              r1 = 1 - r1;
              r2 = 1 - r2;
            }
            const x = P[a] + ux * r1 + vx * r2,
              y = P[a + 1] + uy * r1 + vy * r2,
              z = P[a + 2] + uz * r1 + vz * r2;
            if (sheet && nl > 0) {
              const e = field.thick / 2 / nl;
              f(x + nx * e, y + ny * e, z + nz * e);
              f(x - nx * e, y - ny * e, z - nz * e);
            } else f(x, y, z);
          }
        }
      }
    };
    return S.add(p, mat && mat.triHue ? mat.mat(S, field) : mat, o);
  };
  const sculpt0 = K.sculpt;
  K.sculpt = S => {
    const out = sculpt0(S) || S;
    out.mesh = (mesh, mat, o) => M.solid(out, mesh, mat, o);
    return out;
  };
})(KIT);
