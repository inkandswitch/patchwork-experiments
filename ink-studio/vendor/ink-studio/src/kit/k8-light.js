/* k8-light: lights that move after the bake.
   While a diorama is sculpted, K.light.capture(B, S) notes for every plain splat which colour ramp it was shaded on, how bright it came out,
   and which way its surface faces. Afterwards a light can be carried about and each splat it reaches steps up its own ramp: still only the
   palette's colours, never a tint. A splat on a rigged part turns its normal with the part.
     const cap = K.light.capture(B, S)        (before S.bake())
     const lamp = { p: [x, y, z], r: 6, s: 0.9 }
     const lit = st.add(K.light.system(st, cap, [lamp]))   (add it BEFORE soot, frost and artwork, which paint over it)
     lamp.p = [...]; lit.touch()              move it, then say so.   lit.flash(0.5, 0.15) brightens everything for a moment (lightning)
   A lamp that stays where it is can have more, each of it optional:
     K.light.shadow(st, cap, lamp, S.sdf)     works out once what the lamp can and cannot see, so it casts shadows; after that it can be
                                              dimmed, switched (lamp.off) and recoloured as often as wanted, at no cost. Move it and call again.
     lamp.ramp = [12, 13, 16]                 its own colours, dark to bright: where it is the main light on a splat, the splat is painted
                                              from this ramp, not its own (a fire's orange on stone)
     st.add(K.light.flicker(lit, lamp, { rate: 9, depth: 0.3 }))   it gutters: its strength wanders, and what it lights follows */
(function (K) {
  function sunlight(sun, nx, ny, nz) {
    return (
      sun.amb + sun.sky * (0.5 + 0.5 * ny) + sun.k * Math.max(0, nx * sun.dir[0] + ny * sun.dir[1] + nz * sun.dir[2])
    );
  }

  function lampShare(lamp, lx, ly, lz, d2, nx, ny, nz, i) {
    const dist = Math.sqrt(d2) || 1e-3;
    const nd = (nx * lx + ny * ly + nz * lz) / dist;
    const fade = 1 - dist / lamp.r;
    return fade * fade * lamp.s * (0.2 + 0.8 * Math.max(nd, 0)) * (lamp.vis ? lamp.vis[i] / 255 : 1);
  }

  function sampleLamp(lamp, x, y, z, nx, ny, nz, i) {
    if (lamp.off || lamp.r <= 0) return 0;
    const dx = lamp.p[0] - x,
      dy = lamp.p[1] - y,
      dz = lamp.p[2] - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    return d2 <= lamp.r * lamp.r ? lampShare(lamp, dx, dy, dz, d2, nx, ny, nz, i) : 0;
  }

  function surfaceLevel(sun, x, y, z, nx, ny, nz, i) {
    let level = sunlight(sun, nx, ny, nz);
    if (sun.lights) for (const lamp of sun.lights) level += sampleLamp(lamp, x, y, z, nx, ny, nz, i);
    return level;
  }

  function sunSettings(st, sun) {
    const keep = sun?.keep ?? 0.09;
    if (!(keep >= 0) || typeof keep !== 'number') throw new RangeError('Sun keep must be nonnegative');
    const delta = keep === Infinity;
    const parts = new Set();
    if (sun && st.rig) for (const name of sun.parts ?? []) parts.add(st.rig.part(name));
    return { keep, delta, parts };
  }

  function sunReference(st, sun, settings, i, t, nx, ny, nz) {
    const data = st.base ?? st.D,
      row = i * 16;
    const x = data[row],
      y = data[row + 1],
      z = data[row + 2];
    const ambient = surfaceLevel(sun, x, y, z, nx, ny, nz, i);
    if (settings.delta) return Math.fround(ambient * (sun.shade ? sun.shade(x, y, z) : 1));
    return Math.fround(K.clamp(t - ambient, -settings.keep, settings.keep));
  }

  const restEpsilon = 0.000002;
  function surfaceBase(level, shade, baked, reference, delta) {
    return delta ? baked + (level * shade - reference) : (level + reference) * shade;
  }
  function rampStep(level, length) {
    return K.clamp(Math.floor(level * length), 0, length - 1);
  }
  function bakedPalette(st) {
    const indices = new Map();
    for (const [i, rgb] of st.W.pal.entries())
      indices.set(((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >>> 16) & 255), i);
    return indices;
  }
  function bakedIndex(st, palette, i, fallback) {
    return palette.get((st.base ?? st.D)[i * 16 + 7]) ?? fallback;
  }

  function pack(st, cap, { sun = null } = {}) {
    const settings = sunSettings(st, sun);
    const normalLevel = new Float32Array(st.N * 4);
    const rigRamp = new Float32Array(st.N * 4);
    const baked = settings.delta ? new Int32Array(st.N).fill(-1) : null;
    const palette = baked ? bakedPalette(st) : null;
    const partIds = st.rig?.bid;
    for (let i = 0, row = 0; i < st.N; i++, row += 4) {
      const ramp = (cap.ramp[i] || 0) - 1;
      rigRamp[row] = ramp;
      if (ramp < 0) continue;
      const [nx, ny, nz] = cap.n[i];
      normalLevel[row] = nx;
      normalLevel[row + 1] = ny;
      normalLevel[row + 2] = nz;
      const t = (normalLevel[row + 3] = Math.fround(cap.t[i]));
      const part = (rigRamp[row + 1] = partIds?.[i] ?? 0);
      if (settings.parts.has(part)) {
        rigRamp[row + 2] = 1;
        rigRamp[row + 3] = sunReference(
          st,
          sun,
          settings,
          i,
          t,
          normalLevel[row],
          normalLevel[row + 1],
          normalLevel[row + 2]
        );
        if (baked) baked[i] = bakedIndex(st, palette, i, cap.ramps[ramp][rampStep(t, cap.ramps[ramp].length)]);
      }
    }
    return {
      count: st.N,
      normalLevel,
      rigRamp,
      baked,
      ramps: cap.ramps.map(r => Array.from(r)),
      sun,
      delta: settings.delta
    };
  }

  function step(packed, i, [x, y, z], [nx, ny, nz], lights = [], flash = 0) {
    const row = 4 * i;
    const ramp = packed.ramps[packed.rigRamp[row]];
    if (!ramp) return -1;
    const t = packed.normalLevel[row + 3];
    let base = t,
      total = flash,
      best = 0,
      override;
    if (packed.rigRamp[row + 2]) {
      const sun = packed.sun;
      const level = surfaceLevel(sun, x, y, z, nx, ny, nz, i);
      base = surfaceBase(level, sun.shade ? sun.shade(x, y, z) : 1, t, packed.rigRamp[row + 3], packed.delta);
    }
    for (const lamp of lights) {
      const share = sampleLamp(lamp, x, y, z, nx, ny, nz, i);
      total += share;
      if (lamp.ramp && share > best) {
        best = share;
        override = lamp.ramp;
      }
    }
    if (override && best > base * 0.8) return override[rampStep(base + total, override.length)];
    const baked = packed.baked?.[i] ?? -1;
    if (baked >= 0 && Math.abs(base - t + total) <= restEpsilon) return baked;
    return ramp[rampStep(base + total, ramp.length)];
  }

  // Hosts supply their own palette lookup, transforms and light lists.
  const glsl = `
float capturedLampShare(vec3 p, vec3 n, vec4 lamp, float strength, float visibility) {
  vec3 delta = lamp.xyz - p;
  float d2 = dot(delta, delta);
  if (lamp.w <= 0.0 || d2 > lamp.w * lamp.w) return 0.0;
  float dist = d2 > 0.0 ? sqrt(d2) : 0.001;
  float facing = max(dot(n, delta) / dist, 0.0);
  float fade = 1.0 - dist / lamp.w;
  return fade * fade * strength * (0.2 + 0.8 * facing) * visibility;
}
float capturedSun(vec3 n, vec3 direction, vec3 ambientSkyStrength) {
  return ambientSkyStrength.x + ambientSkyStrength.y * (0.5 + 0.5 * n.y)
    + ambientSkyStrength.z * max(dot(n, direction), 0.0);
}
float capturedBase(float baked, float liveLevel, float shade, float reference, bool delta) {
  return delta ? baked + (liveLevel * shade - reference) : (liveLevel + reference) * shade;
}
int capturedStep(float level, int rampLength) {
  return int(clamp(floor(level * float(rampLength)), 0.0, float(rampLength - 1)));
}
bool capturedOverride(float best, float base) {
  return best > base * 0.8;
}
bool capturedAtRest(float baked, float base, float additional) {
  return abs(base - baked + additional) <= 0.000002;
}
`;

  K.light = {
    pack,
    step,
    glsl,
    capture(B, S) {
      const cap = { ramp: [], t: [], n: [], ramps: [], ids: new Map() };
      const prior = S.tap;
      S.tap = function (ramp, t, nx, ny, nz, flat) {
        const i = B.count();
        if (prior) prior.apply(this, arguments);
        if (flat) return;
        let id = cap.ids.get(ramp);
        if (id === undefined) {
          id = cap.ramps.length;
          cap.ramps.push(ramp);
          cap.ids.set(ramp, id);
        }
        cap.ramp[i] = id + 1;
        cap.t[i] = t;
        cap.n[i] = [nx, ny, nz];
      };
      return cap;
    },
    system(st, cap, lights, o) {
      o = o || {};
      const N = st.N,
        D = st.D,
        has = new Uint8Array(N),
        T = new Float32Array(N),
        NR = new Float32Array(N * 3),
        RI = new Uint16Array(N),
        cur = new Int16Array(N).fill(-1),
        over = new Int16Array(N).fill(-1),
        list = [],
        pal = st.W.pal;
      let seen = -1,
        version = 0,
        flash = 0,
        flashT = 0;
      for (let i = 0; i < N; i++)
        if (cap.ramp[i]) {
          has[i] = 1;
          RI[i] = cap.ramp[i] - 1;
          T[i] = cap.t[i];
          NR[i * 3] = cap.n[i][0];
          NR[i * 3 + 1] = cap.n[i][1];
          NR[i * 3 + 2] = cap.n[i][2];
          list.push(i);
          const rp = cap.ramps[RI[i]];
          cur[i] = K.clamp(Math.floor(T[i] * rp.length), 0, rp.length - 1);
        }
      // Only splats a lamp can reach are looked at: those in the cells round each lamp (by where they rest), those on rigged parts (which may have
      // moved into reach), and those that were lit last time (so they go dark again when the lamp leaves). A flash looks at everything.
      const grid = K.grid(st, 1.2),
        movers = [],
        mark = new Uint8Array(N);
      let prev = [],
        work = [],
        wasFlash = false;
      if (st.rig) for (const i of list) if (st.rig.bid[i]) movers.push(i);
      const sun = o.sun || null,
        settings = sunSettings(st, sun),
        live = new Uint8Array(N),
        fine = new Float32Array(N),
        baked = settings.delta ? new Int32Array(N).fill(-1) : null,
        palette = baked ? bakedPalette(st) : null;
      if (sun && st.rig) {
        for (const i of list) {
          if (!settings.parts.has(st.rig.bid[i])) continue;
          live[i] = 1;
          fine[i] = sunReference(st, sun, settings, i, T[i], NR[i * 3], NR[i * 3 + 1], NR[i * 3 + 2]);
          if (baked) {
            baked[i] = bakedIndex(st, palette, i, cap.ramps[RI[i]][cur[i]]);
            over[i] = baked[i];
          }
        }
      }
      const sys = {
        lights,
        count: list.length,
        touch() {
          version++;
        },
        flash(amount, dur) {
          flash = amount;
          flashT = dur || 0.12;
          version++;
        },
        update(dt) {
          if (flashT > 0) {
            flashT -= dt;
            version++;
            if (flashT <= 0) flash = 0;
          }
          if (seen === version && !sys.live) return;
          seen = version;
          const rig = st.rig,
            Mx = rig ? rig.M : null,
            bid = rig ? rig.bid : null;
          if (flash > 0 || wasFlash) work = list;
          else {
            work = [];
            const push = i => {
              if (!mark[i] && has[i]) {
                mark[i] = 1;
                work.push(i);
              }
            };
            for (const L of lights) if (!L.off) grid.near(L.p[0], L.p[1], L.p[2], L.r, push);
            for (const i of movers) push(i);
            for (const i of prev) push(i);
            for (const i of work) mark[i] = 0;
          }
          wasFlash = flash > 0;
          const lit = [];
          for (let m = 0; m < work.length; m++) {
            const i = work[m],
              q = i * 16,
              x = D[q],
              y = D[q + 1],
              z = D[q + 2];
            let add = flash,
              lbest = 0,
              lb = null,
              nx = NR[i * 3],
              ny = NR[i * 3 + 1],
              nz = NR[i * 3 + 2],
              turned = false;
            for (const L of lights) {
              if (L.off || L.r <= 0) continue;
              const lx = L.p[0] - x,
                ly = L.p[1] - y,
                lz = L.p[2] - z,
                d2 = lx * lx + ly * ly + lz * lz;
              if (d2 > L.r * L.r) continue;
              if (!turned && bid && bid[i]) {
                const k = bid[i] * 12,
                  a = Mx[k] * nx + Mx[k + 1] * ny + Mx[k + 2] * nz,
                  b = Mx[k + 3] * nx + Mx[k + 4] * ny + Mx[k + 5] * nz,
                  c = Mx[k + 6] * nx + Mx[k + 7] * ny + Mx[k + 8] * nz,
                  l = Math.hypot(a, b, c) || 1;
                nx = a / l;
                ny = b / l;
                nz = c / l;
                turned = true;
              }
              const share = lampShare(L, lx, ly, lz, d2, nx, ny, nz, i);
              add += share;
              if (L.ramp && share > lbest) ((lbest = share), (lb = L));
            }
            let base = T[i];
            if (live[i]) {
              if (!turned && bid[i]) {
                const k = bid[i] * 12,
                  a = Mx[k] * nx + Mx[k + 1] * ny + Mx[k + 2] * nz,
                  b = Mx[k + 3] * nx + Mx[k + 4] * ny + Mx[k + 5] * nz,
                  c = Mx[k + 6] * nx + Mx[k + 7] * ny + Mx[k + 8] * nz,
                  l = Math.hypot(a, b, c) || 1;
                nx = a / l;
                ny = b / l;
                nz = c / l;
              }
              const level = surfaceLevel(sun, x, y, z, nx, ny, nz, i);
              base = surfaceBase(level, sun.shade ? sun.shade(x, y, z) : 1, T[i], fine[i], settings.delta);
            }
            const rp = cap.ramps[RI[i]],
              idx = rampStep(base + add, rp.length),
              ov =
                lb && lbest > base * 0.8
                  ? lb.ramp[rampStep(base + add, lb.ramp.length)]
                  : baked && baked[i] >= 0 && Math.abs(base - T[i] + add) <= restEpsilon
                    ? baked[i]
                    : -1;
            if (add > 0) lit.push(i);
            if (idx !== cur[i] || ov !== over[i]) {
              cur[i] = idx;
              over[i] = ov;
              st.repaint(i);
            }
          }
          prev = lit;
        },
        paint(i, c) {
          if (!has[i]) return;
          const h = pal[over[i] >= 0 ? over[i] : cap.ramps[RI[i]][cur[i]]];
          c[0] = ((h >> 16) & 255) / 255;
          c[1] = ((h >> 8) & 255) / 255;
          c[2] = (h & 255) / 255;
        }
      };
      return sys;
    },
    /* what a lamp that stays put can see: for every captured splat in its reach, a line is walked through the field toward the lamp, and
       a splat with something in the way gets only a little of it (as a baked lamp's shadow does). Kept on the lamp as lamp.vis. */
    shadow(st, cap, lamp, sdf, o) {
      o = o || {};
      const art = ShadowArt.prepare(st.W?.look?.shadowArt);
      const receives = ShadowArt.bind(art, st.W, 'receive'), distance = sdf.forShadow ?? sdf;
      const N = st.N,
        D = st.base || st.D,
        vis = new Uint8Array(N).fill(255),
        dark = Math.round(255 * ShadowArt.transfer(art, o.dark ?? 0.12));
      let n = 0;
      for (let i = 0; i < N; i++) {
        if (!cap.ramp[i] || receives && !receives(i)) continue;
        const q = i * 16,
          nv = cap.n[i],
          x = D[q] + nv[0] * 0.05,
          y = D[q + 1] + nv[1] * 0.05,
          z = D[q + 2] + nv[2] * 0.05,
          lx = lamp.p[0] - x,
          ly = lamp.p[1] - y,
          lz = lamp.p[2] - z,
          dist = Math.hypot(lx, ly, lz);
        if (dist > lamp.r || dist < 0.2) continue;
        let t = 0.08;
        for (let k = 0; k < 32 && t < dist - 0.12; k++) {
          const h = distance(x + (lx / dist) * t, y + (ly / dist) * t, z + (lz / dist) * t);
          if (h < 0.004) {
            vis[i] = dark;
            n++;
            break;
          }
          t += h < 0.06 ? 0.06 : h;
        }
      }
      lamp.vis = vis;
      return n;
    },
    /* a lamp that gutters: a system to add to the stage. Its strength wanders about what it was given (two slow waves and a quick one,
       never a plain sine), and the light system is told. o: { rate (9), depth (0.3) } */
    flicker(sys, lamp, o) {
      o = o || {};
      const s0 = lamp.s,
        rate = o.rate || 9,
        depth = o.depth === undefined ? 0.3 : o.depth,
        ph = (lamp.p[0] * 12.9898 + lamp.p[2] * 78.233) % 6.28;
      let was = -1;
      return {
        update(dt, t) {
          const w =
              0.5 * Math.sin(t * rate + ph) +
              0.3 * Math.sin(t * rate * 2.31 + ph * 1.7) +
              0.2 * Math.sin(t * rate * 0.43 + ph * 0.6),
            s = s0 * (1 - depth * (0.5 + 0.5 * w)),
            q = Math.round(s * 24);
          lamp.s = s;
          if (q !== was) {
            was = q;
            sys.touch();
          }
        }
      };
    }
  };
})(KIT);
