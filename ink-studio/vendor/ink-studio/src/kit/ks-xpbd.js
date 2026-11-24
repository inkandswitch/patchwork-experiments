/* ks-xpbd: cloth and hair. One solver using extended position-based
   dynamics. Points with a mass; constraints between them, each with a softness ("compliance") that holds whatever the frame rate;
   many small steps a frame, each solving every constraint once. Cloth and hair are presets that make the points and constraints and
   lay the dabs that ride them; anything else can be built on the solver itself.

   K.xpbd.sim(o)           the solver. o: { gravity ([0, -9.8, 0]), damp (0.6 a second), substeps (6), sdf (a field to collide with: the
                           sculpt's own S.sdf; things are kept o.thick (0.02) off it), spheres: [{ c, r }] (moving colliders: change c
                           as they move), friction (0.4), wind(x, y, z, t) -> [vx, vy, vz] }
     .point(p, w, r)       a point: where, how light (1 / mass; 0 holds it where it is put), its radius for collisions -> index
     .link(i, j, comp)     keeps two points as far apart as they are now: comp 0 is stiff, 1e-4 stretches a little, 1e-2 is elastic
     .tie(i, target, comp) pulls a point toward target() (a function giving where it should be): hair keeping its shape, a sail held
     .pin(i, at)           holds a point at at() exactly (a hem nailed to a pole, a root in the skin)
     .face(a, b, c, k)     a triangle the wind pushes on (k how much): what makes a flag fly
     .step(dt, t)
   K.xpbd.gust(base, o)    a wind that comes and goes: base [vx, vy, vz], o: { gust (0.6: how much stronger it gets), turn (0.35:
                           how much it swings), freq (0.35 gusts a second), scale (0.4: how far across a gust is felt) }

   K.cloth(B, o)           a rectangle of cloth, and its dabs. o: { at (the top-left corner), u (its top edge, a vector with the
                           cloth's width), v (its side, with its height), nu, nv (points across and down: 22, 14), pins: (i, j) => true
                           for points that are held (default: the left edge, a flag on a pole), pinAt(i, j, p0) -> where they are held
                           (moving pins: a cape on shoulders), pattern(u, v) -> a ramp (palette indices dark to light) for the cloth there,
                           stretch (1e-6), shear (1e-5), bend (2e-3: higher is softer), air (1.2: how much the wind pushes it), mass,
                           dabs (2: across each cell), sim (share one), and the sim options above }
                           -> a stage system: st.add(cloth). It is lit as it moves: its colours step up and down its ramps by
                           how the cloth faces the sun (both sides), its folds shade themselves.
   K.hair(B, o)            strands, and their dabs. o: { roots: [{ p, n, part }] (where they grow and which way; part: a rig part
                           that carries them; len: this one's length, times o.len), len (0.4), lit ([0.08, 0.5, 0.25]: how bright at
                           the root, how much brighter across the light, how much brighter toward the tip), segs (5), width (0.022), ramp (root to tip), shape (8e-3: how firmly a strand
                           keeps the shape it was groomed in; higher is limper), bend (1e-3), and grooming:
                           droop (0.9: how it hangs), tone (0.3: how much locks differ in shade), curl { r, turns }, frizz (0.02), clump { n, k } (strands drawn together at
                           the tips into n clumps, by k), trim (0.3: how much lengths differ), and the sim options }
                           -> a stage system. Moves with its part when the rig moves it; swings, settles, is blown about. */
(function (K) {
  const norm = v => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const validPose = (positions, length) => (Array.isArray(positions) || ArrayBuffer.isView(positions)) &&
    positions.length === length && (Array.isArray(positions) ? Array.from(positions) : positions).every(Number.isFinite);
  const vn = (x, y, z) => {
    // a little smooth noise for gusts
    const s = Math.sin(x * 1.7 + y * 0.3) * Math.sin(z * 1.3 + 0.7 * x) + Math.sin(x * 0.61 + z * 0.93 + y * 0.2) * 0.6;
    return s / 1.6;
  };
  K.xpbd = {
    gust(base, o) {
      o = o || {};
      const g = o.gust === undefined ? 0.6 : o.gust,
        tn = o.turn === undefined ? 0.35 : o.turn,
        f = o.freq === undefined ? 0.35 : o.freq,
        sc = o.scale === undefined ? 0.4 : o.scale,
        sp = Math.hypot(base[0], base[1], base[2]) || 1;
      return (x, y, z, t) => {
        const ph = t * f * 6.283 - (x * base[0] + z * base[2]) * 0.15,
          k = 1 + g * (0.5 + 0.5 * Math.sin(ph)) * (0.6 + 0.4 * vn(x * sc + t * 0.7, y * sc, z * sc)),
          a = tn * vn(x * sc * 0.5 + t * 0.4, 3.1, z * sc * 0.5 - t * 0.3),
          ca = Math.cos(a),
          sa = Math.sin(a);
        return [
          (base[0] * ca - base[2] * sa) * k,
          base[1] * k + sp * 0.12 * vn(t * 1.3 + x, y, z),
          (base[0] * sa + base[2] * ca) * k
        ];
      };
    },
    sim(o) {
      o = o || {};
      let cap = 256,
        n = 0,
        X = new Float32Array(cap * 3),
        P = new Float32Array(cap * 3),
        V = new Float32Array(cap * 3),
        W = new Float32Array(cap),
        RAD = new Float32Array(cap),
        DRAG = new Float32Array(cap);
      const links = [],
        ties = [],
        pins = [],
        faces = [],
        grav = o.gravity || [0, -9.8, 0],
        damp = o.damp === undefined ? 0.6 : o.damp,
        subs = o.substeps || 6,
        fric = o.friction === undefined ? 0.4 : o.friction,
        thick = o.thick === undefined ? 0.02 : o.thick;
      const grow = () => {
        cap *= 2;
        for (const [k, w] of [
          ['X', 3],
          ['P', 3],
          ['V', 3],
          ['W', 1],
          ['RAD', 1],
          ['DRAG', 1]
        ]) {
          const a = new Float32Array(cap * w);
          a.set({ X, P, V, W, RAD, DRAG }[k]);
          if (k === 'X') X = a;
          else if (k === 'P') P = a;
          else if (k === 'V') V = a;
          else if (k === 'W') W = a;
          else if (k === 'RAD') RAD = a;
          else DRAG = a;
        }
      };
      let near = null,
        nearAge = 99;
      const sim = {
        o,
        spheres: o.spheres || [],
        wind: o.wind || null,
        get n() {
          return n;
        },
        get X() {
          return X;
        },
        resetPose(positions) {
          if (!validPose(positions, n * 3))
            throw new TypeError('An XPBD pose needs one finite XYZ position per point');
          X.set(positions);
          P.set(positions);
          V.fill(0);
          near = null;
          nearAge = 99;
        },
        motion() {
          return {positions:Array.from(X.subarray(0,n*3)),velocities:Array.from(V.subarray(0,n*3)),
            broken:links.map(link=>Boolean(link[5]))};
        },
        restoreMotion({positions,velocities,broken}) {
          if(!validPose(velocities,n*3)||!Array.isArray(broken)||broken.length!==links.length||
            !broken.every(value=>typeof value==='boolean'))throw new TypeError('Invalid XPBD motion');
          sim.resetPose(positions);
          V.set(velocities);
          sim.torn=0;
          links.forEach((link,i)=>{link[5]=Number(broken[i]);sim.torn+=link[5];});
        },
        point(p, w, r) {
          if (n === cap) grow();
          X[n * 3] = P[n * 3] = p[0];
          X[n * 3 + 1] = P[n * 3 + 1] = p[1];
          X[n * 3 + 2] = P[n * 3 + 2] = p[2];
          W[n] = w === undefined ? 1 : w;
          RAD[n] = r === undefined ? 0.03 : r;
          return n++;
        },
        /* tear: if given, the link breaks for good when it is stretched past tear times its length (cloth that rips, a rope that
           snaps); sim.torn counts the broken, and o.onTear(index) hears of each. Gives back the link's index */
        link(i, j, comp, tear, guards) {
          links.push([
            i,
            j,
            Math.hypot(X[i * 3] - X[j * 3], X[i * 3 + 1] - X[j * 3 + 1], X[i * 3 + 2] - X[j * 3 + 2]),
            comp || 0,
            tear || 0,
            0,
            guards
          ]);
          return links.length - 1;
        },
        broken: k => links[k][5] === 1,
        breakLink(k, ratio) {
          if(links[k][5])return false;
          links[k][5]=1;
          sim.torn++;
          o.onTear?.(k,ratio);
          return true;
        },
        // break every link that has a point within r of p (a cut, a blow)
        cut(p, r) {
          let m = 0;
          for (let k = 0; k < links.length; k++) {
            const L = links[k];
            if (L[5]) continue;
            for (const q of [L[0], L[1]])
              if (Math.hypot(X[q * 3] - p[0], X[q * 3 + 1] - p[1], X[q * 3 + 2] - p[2]) < r) {
                sim.breakLink(k);
                m++;
                break;
              }
          }
          return m;
        },
        torn: 0,
        // the air drags this point toward the wind's speed, k of the difference a second (hair, a loose thread)
        drag(i, k) {
          DRAG[i] = k;
        },
        tie(i, target, comp) {
          ties.push([i, target, comp || 0]);
        },
        pin(i, at) {
          pins.push([i, at]);
          W[i] = 0;
        },
        face(a, b, c, k, guards) {
          faces.push([a, b, c, k === undefined ? 1 : k, guards]);
        },
        step(dt, t) {
          if (dt <= 0) return;
          if(!o.fixedStep)dt = Math.min(dt, 1 / 30);
          const h = dt / subs,
            h2 = h * h;
          // which points are near enough the field to need it this frame (the field is the dear part)
          if (o.sdf && ++nearAge > 6) {
            nearAge = 0;
            near = [];
            for (let i = 0; i < n; i++) if (W[i] > 0 && o.sdf(X[i * 3], X[i * 3 + 1], X[i * 3 + 2]) < 0.6) near.push(i);
          }
          for (const [i, at] of pins) {
            if(o.substepPins)continue;
            const q = at(t);
            V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0;
            P[i * 3] = X[i * 3];
            P[i * 3 + 1] = X[i * 3 + 1];
            P[i * 3 + 2] = X[i * 3 + 2];
            X[i * 3] = q[0];
            X[i * 3 + 1] = q[1];
            X[i * 3 + 2] = q[2];
          }
          for (let s = 0; s < subs; s++) {
            const ts = t - dt + (s + 1) * h;
            if(o.substepPins)for(const [i,at] of pins){
              const k=i*3, q=at(ts);
              for(let axis=0;axis<3;axis++){
                P[k+axis]=X[k+axis];
                X[k+axis]=q[axis];
                V[k+axis]=(X[k+axis]-P[k+axis])/h;
              }
            }
            // the wind on each face: pushes it along the way it faces, by how squarely the air meets it
            if (sim.wind && faces.length) {
              for (const f of faces) {
                if(f[4]?.some(sim.broken))continue;
                const a = f[0] * 3,
                  b = f[1] * 3,
                  c = f[2] * 3,
                  e1 = [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]],
                  e2 = [X[c] - X[a], X[c + 1] - X[a + 1], X[c + 2] - X[a + 2]],
                  cr = cross(e1, e2),
                  area2 = Math.hypot(cr[0], cr[1], cr[2]) || 1e-9,
                  nn = [cr[0] / area2, cr[1] / area2, cr[2] / area2],
                  mx = (X[a] + X[b] + X[c]) / 3,
                  my = (X[a + 1] + X[b + 1] + X[c + 1]) / 3,
                  mz = (X[a + 2] + X[b + 2] + X[c + 2]) / 3,
                  wv = sim.wind(mx, my, mz, ts),
                  rv = [
                    wv[0] - (V[a] + V[b] + V[c]) / 3,
                    wv[1] - (V[a + 1] + V[b + 1] + V[c + 1]) / 3,
                    wv[2] - (V[a + 2] + V[b + 2] + V[c + 2]) / 3
                  ],
                  pn = rv[0] * nn[0] + rv[1] * nn[1] + rv[2] * nn[2],
                  sp = Math.hypot(rv[0], rv[1], rv[2]),
                  // air pressing on a face: hard along the way it faces, a little along it (what streams a flag out); in newtons,
                  // shared by its three corners. 0.5 rho |v| area (cn (v.n) n + ct (v - (v.n) n))
                  q0 = (0.5 * 1.2 * sp * area2 * 0.5 * f[3] * h) / 3,
                  fx = (1.4 * pn * nn[0] + 0.12 * (rv[0] - pn * nn[0])) * q0,
                  fy = (1.4 * pn * nn[1] + 0.12 * (rv[1] - pn * nn[1])) * q0,
                  fz = (1.4 * pn * nn[2] + 0.12 * (rv[2] - pn * nn[2])) * q0;
                for (const q of [a, b, c]) {
                  const w = W[q / 3];
                  if (!w) continue;
                  V[q] += fx * w;
                  V[q + 1] += fy * w;
                  V[q + 2] += fz * w;
                }
              }
            }
            const dk = Math.exp(-damp * h);
            for (let i = 0; i < n; i++) {
              if (!W[i]) continue;
              const k = i * 3;
              if (DRAG[i] && sim.wind) {
                const wv = sim.wind(X[k], X[k + 1], X[k + 2], ts),
                  a = Math.min(1, DRAG[i] * h);
                V[k] += (wv[0] - V[k]) * a;
                V[k + 1] += (wv[1] - V[k + 1]) * a;
                V[k + 2] += (wv[2] - V[k + 2]) * a;
              }
              V[k] = (V[k] + grav[0] * h) * dk;
              V[k + 1] = (V[k + 1] + grav[1] * h) * dk;
              V[k + 2] = (V[k + 2] + grav[2] * h) * dk;
              if(o.acceleration){
                const force=o.acceleration(i,ts);
                if(force)for(let axis=0;axis<3;axis++)V[k+axis]+=force[axis]*h;
              }
              P[k] = X[k];
              P[k + 1] = X[k + 1];
              P[k + 2] = X[k + 2];
              X[k] += V[k] * h;
              X[k + 1] += V[k + 1] * h;
              X[k + 2] += V[k + 2] * h;
            }
            // constraints: each once, with its softness (small steps, so the multiplier starts again every step)
            for (let c = 0; c < links.length; c++) {
              const L = links[c],
                i = L[0] * 3,
                j = L[1] * 3,
                wi = W[L[0]],
                wj = W[L[1]],
                ws = wi + wj;
              if (L[5]||L[6]?.some(sim.broken)||!ws&&!o.substepPins) continue;
              const dx = X[i] - X[j],
                dy = X[i + 1] - X[j + 1],
                dz = X[i + 2] - X[j + 2],
                d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
              if (L[4] && d > L[2] * L[4]) {
                sim.breakLink(c,d/L[2]);
                continue;
              }
              if(!ws)continue;
              const C = d - L[2],
                dl = -C / (ws + L[3] / h2),
                gx = dx / d,
                gy = dy / d,
                gz = dz / d;
              X[i] += wi * dl * gx;
              X[i + 1] += wi * dl * gy;
              X[i + 2] += wi * dl * gz;
              X[j] -= wj * dl * gx;
              X[j + 1] -= wj * dl * gy;
              X[j + 2] -= wj * dl * gz;
            }
            for (const T of ties) {
              const i = T[0] * 3,
                w = W[T[0]];
              if (!w) continue;
              const q = T[1](ts),
                dx = X[i] - q[0],
                dy = X[i + 1] - q[1],
                dz = X[i + 2] - q[2],
                k = w / (w + T[2] / h2);
              X[i] -= dx * k;
              X[i + 1] -= dy * k;
              X[i + 2] -= dz * k;
            }
            // collisions: moving spheres, then the field
            for (const sp of sim.spheres)
              for (let i = 0; i < n; i++) {
                if (!W[i]) continue;
                const k = i * 3,
                  dx = X[k] - sp.c[0],
                  dy = X[k + 1] - sp.c[1],
                  dz = X[k + 2] - sp.c[2],
                  r = sp.r + RAD[i],
                  d2 = dx * dx + dy * dy + dz * dz;
                if (d2 >= r * r) continue;
                const d = Math.sqrt(d2) || 1e-6,
                  push = r - d;
                X[k] += (dx / d) * push;
                X[k + 1] += (dy / d) * push;
                X[k + 2] += (dz / d) * push;
                // friction: what it slid along the sphere this step is partly taken back
                X[k] -= (X[k] - P[k]) * fric * 0.5;
                X[k + 1] -= (X[k + 1] - P[k + 1]) * fric * 0.5;
                X[k + 2] -= (X[k + 2] - P[k + 2]) * fric * 0.5;
              }
            if (o.sdf && near && s % 2 === 1)
              for (const i of near) {
                const k = i * 3,
                  d = o.sdf(X[k], X[k + 1], X[k + 2]) - RAD[i] - thick;
                if (d >= 0) continue;
                const e = 0.01,
                  gx = o.sdf(X[k] + e, X[k + 1], X[k + 2]) - o.sdf(X[k] - e, X[k + 1], X[k + 2]),
                  gy = o.sdf(X[k], X[k + 1] + e, X[k + 2]) - o.sdf(X[k], X[k + 1] - e, X[k + 2]),
                  gz = o.sdf(X[k], X[k + 1], X[k + 2] + e) - o.sdf(X[k], X[k + 1], X[k + 2] - e),
                  gl = Math.hypot(gx, gy, gz) || 1;
                X[k] -= (gx / gl) * d;
                X[k + 1] -= (gy / gl) * d;
                X[k + 2] -= (gz / gl) * d;
                X[k] -= (X[k] - P[k]) * fric;
                X[k + 2] -= (X[k + 2] - P[k + 2]) * fric;
              }
            for (let i = 0; i < n; i++) {
              if (!W[i]) continue;
              const k = i * 3;
              if(o.project){
                const point=o.project(i,[X[k],X[k+1],X[k+2]],[P[k],P[k+1],P[k+2]],RAD[i],ts);
                if(point)X.set(point,k);
              }
              V[k] = (X[k] - P[k]) / h;
              V[k + 1] = (X[k + 1] - P[k + 1]) / h;
              V[k + 2] = (X[k + 2] - P[k + 2]) / h;
            }
          }
        }
      };
      return sim;
    }
  };

  K.xpbd.clothGrid = ({nu,nv,at,u,v,stretch=1e-6,shear=1e-5,bend=2e-3,tear=0}) => {
    const points=[], links=[], faces=[], horizontal=[], vertical=[];
    const link=(a,b,compliance,ratio,kind)=>links.push({a,b,compliance,ratio,kind})-1;
    for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
      const x=i/(nu-1), y=j/(nv-1), a=j*nu+i, b=a+1, c=a+nu, d=c+1;
      points.push(at.map((value,axis)=>value+u[axis]*x+v[axis]*y));
      const ratio=typeof tear==='function'?tear(x,y):tear;
      if(i<nu-1)horizontal[a]=link(a,b,stretch,ratio,'stretch');
      if(j<nv-1)vertical[a]=link(a,c,stretch,ratio,'stretch');
      if(i<nu-1&&j<nv-1){
        link(a,d,shear,ratio*1.3,'shear');
        const diagonal=link(b,c,shear,ratio*1.3,'shear');
        faces.push({nodes:[a,b,c],diagonal},{nodes:[b,d,c],diagonal});
      }
      if(i<nu-2)link(a,a+2,bend,ratio*1.1,'bend');
      if(j<nv-2)link(a,a+2*nu,bend,ratio*1.1,'bend');
    }
    return {points,links,faces,horizontal,vertical};
  };

  // shared: write a disc or a stick into the stage, and the colour (into the base too, so painters start from it)
  const pack = (B, c) => B.P[c][0] + B.P[c][1] * 256 + B.P[c][2] * 65536;
  const put = (st, i, x, y, z, nv, r, thin, col, ax, len) => {
    const D = st.D,
      o = i * 16;
    D[o] = x;
    D[o + 1] = y;
    D[o + 2] = z;
    if (ax) {
      const p = r * r,
        d = len * len - p;
      D[o + 4] = p + d * ax[0] * ax[0];
      D[o + 5] = d * ax[0] * ax[1];
      D[o + 6] = d * ax[0] * ax[2];
      D[o + 8] = p + d * ax[1] * ax[1];
      D[o + 9] = d * ax[1] * ax[2];
      D[o + 10] = p + d * ax[2] * ax[2];
    } else {
      const p = r * r,
        d = thin * thin - p;
      D[o + 4] = p + d * nv[0] * nv[0];
      D[o + 5] = d * nv[0] * nv[1];
      D[o + 6] = d * nv[0] * nv[2];
      D[o + 8] = p + d * nv[1] * nv[1];
      D[o + 9] = d * nv[1] * nv[2];
      D[o + 10] = p + d * nv[2] * nv[2];
    }
    D[o + 7] = col;
    st.base[o + 7] = col;
    st.rows[i >> 9] = 1;
  };

  K.cloth = (B, o) => {
    o = o || {};
    const sceneWind = o.wind === 'scene';
    if (sceneWind) o = { ...o, wind: undefined };
    const nu = o.nu || 22,
      nv = o.nv || 14,
      at = o.at || [0, 2, 0],
      U = o.u || [2, 0, 0],
      Vv = o.v || [0, -1.3, 0],
      per = o.dabs || 2,
      sim = o.sim || K.xpbd.sim(o),
      pins = o.pins || ((i, j) => i === 0),
      pattern = o.pattern || (() => [1, 2, 3]),
      sun = norm(o.sun || [-0.5, 0.7, 0.5]),
      cell = Math.max(Math.hypot(...U) / (nu - 1), Math.hypot(...Vv) / (nv - 1)),
      // what each point weighs: its share of the cloth, by o.density (kg a square metre: 0.25 a light flag, 0.6 a heavy blanket)
      mass =
        o.mass !== undefined
          ? o.mass
          : ((o.density === undefined ? 0.25 : o.density) * Math.hypot(...U) * Math.hypot(...Vv)) / (nu * nv);
    if (!sim.wind && o.wind) sim.wind = o.wind;
    const grid = tear => K.xpbd.clothGrid({...o,nu,nv,at,u:U,v:Vv,tear:tear||0});
    const topology=grid(o.tear), {points:rest}=topology;
    function linkGrid(solver, anchors, anchorAt, layout) {
      const base0 = solver.n;
      for (const p of rest) solver.point(p, 1 / mass, cell * 0.35);
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          if (anchors(i, j)) {
            const p0 = rest[j * nu + i];
            solver.pin(base0+j*nu+i, anchorAt ? t => anchorAt(i, j, p0, t) : () => p0);
          }
        }
      const indices=layout.links.map(({a,b,compliance,ratio})=>solver.link(base0+a,base0+b,compliance,ratio));
      for(const {nodes:[a,b,c]} of layout.faces)solver.face(base0+a,base0+b,base0+c,o.air??1.2);
      return {base0,EH:layout.horizontal.map(i=>indices[i]),EV:layout.vertical.map(i=>indices[i])};
    }
    const { base0, EH, EV } = linkGrid(sim, pins, o.pinAt, topology);
    // its dabs: per x per in every cell, each knowing where in the cell it sits and what colours it takes
    const first = B.count(),
      dabs = [];
    for (let j = 0; j < nv - 1; j++)
      for (let i = 0; i < nu - 1; i++)
        for (let b = 0; b < per; b++)
          for (let a = 0; a < per; a++) {
            const fu = (a + 0.5) / per,
              fv = (b + 0.5) / per,
              ramp = pattern((i + fu) / (nu - 1), (j + fv) / (nv - 1));
            if (!ramp) continue;
            dabs.push([i, j, fu, fv, ramp.map(c => pack(B, c))]);
            B.iso(0, -99, 0, 0.05, B.P[ramp[0]], 3, { nd: true });
          }
    const R = (cell / per) * 0.72,
      thin = Math.min(0.015, R * 0.3),
      amb = o.amb === undefined ? 0.3 : o.amb,
      k = o.sunK === undefined ? 0.75 : o.sunK,
      NRM = new Float32Array(nu * nv * 3);
    function draw(st, X, offset, torn) {
      const id = (i, j) => offset + j * nu + i;
      // a normal at every point, from its neighbours
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const a = id(Math.max(0, i - 1), j) * 3,
            b = id(Math.min(nu - 1, i + 1), j) * 3,
            c = id(i, Math.max(0, j - 1)) * 3,
            d = id(i, Math.min(nv - 1, j + 1)) * 3,
            du = [X[b] - X[a], X[b + 1] - X[a + 1], X[b + 2] - X[a + 2]],
            dv = [X[d] - X[c], X[d + 1] - X[c + 1], X[d + 2] - X[c + 2]],
            nn = norm(cross(du, dv)),
            q = (j * nu + i) * 3;
          NRM[q] = nn[0];
          NRM[q + 1] = nn[1];
          NRM[q + 2] = nn[2];
        }
      for (let m = 0; m < dabs.length; m++) {
        const [i, j, fu, fv, cols] = dabs[m],
          c00 = id(i, j) * 3,
          c10 = id(i + 1, j) * 3,
          c01 = id(i, j + 1) * 3,
          c11 = id(i + 1, j + 1) * 3,
          n00 = (j * nu + i) * 3,
          n10 = n00 + 3,
          n01 = n00 + nu * 3,
          n11 = n01 + 3;
        let w00 = (1 - fu) * (1 - fv),
          w10 = fu * (1 - fv),
          w01 = (1 - fu) * fv,
          w11 = fu * fv;
        /* torn: a corner on the far side of a broken thread from the dab's own corner no longer carries it, so the cell parts along
           the tear instead of stretching across it */
        if (torn) {
          const top = sim.broken(EH[j * nu + i]),
            bot = sim.broken(EH[(j + 1) * nu + i]),
            lef = sim.broken(EV[j * nu + i]),
            rig = sim.broken(EV[j * nu + i + 1]);
          if (top || bot || lef || rig) {
            // the corners 0 (top left), 1 (top right), 2 (bottom left), 3 (bottom right), and which edges still join them: walk
            // from the dab's own corner along the edges that are whole
            const own = (fu < 0.5 ? 0 : 1) + (fv < 0.5 ? 0 : 2),
              E = [
                [0, 1, !top],
                [2, 3, !bot],
                [0, 2, !lef],
                [1, 3, !rig]
              ],
              seen = [false, false, false, false];
            seen[own] = true;
            for (let it = 0; it < 3; it++)
              for (const [a, b, ok] of E) if (ok && seen[a] !== seen[b]) seen[a] = seen[b] = true;
            const joined = (a, b) => seen[a + b * 2];
            if (!joined(0, 0)) w00 = 0;
            if (!joined(1, 0)) w10 = 0;
            if (!joined(0, 1)) w01 = 0;
            if (!joined(1, 1)) w11 = 0;
            const ws = w00 + w10 + w01 + w11 || 1;
            w00 /= ws;
            w10 /= ws;
            w01 /= ws;
            w11 /= ws;
          }
        }
        const nn = norm(
            [0, 1, 2].map(q => NRM[n00 + q] * w00 + NRM[n10 + q] * w10 + NRM[n01 + q] * w01 + NRM[n11 + q] * w11)
          ),
          x = X[c00] * w00 + X[c10] * w10 + X[c01] * w01 + X[c11] * w11,
          y = X[c00 + 1] * w00 + X[c10 + 1] * w10 + X[c01 + 1] * w01 + X[c11 + 1] * w11,
          z = X[c00 + 2] * w00 + X[c10 + 2] * w10 + X[c01 + 2] * w01 + X[c11 + 2] * w11,
          nl = nn[0] * sun[0] + nn[1] * sun[1] + nn[2] * sun[2],
          // both faces of cloth are lit; the one turned from the sun a little less (light comes through it)
          l = amb + k * (nl > 0 ? nl : -nl * 0.75),
          ci = Math.max(0, Math.min(cols.length - 1, Math.floor(l * cols.length)));
        put(st, first + m, x, y, z, nn, R, thin, cols[ci]);
      }
    }
    let presented, windOptions, hasSceneWind;
    const sys = {
      sim,
      first,
      nu,
      nv,
      shared: !!o.sim,
      independentCloth: !o.sim,
      count: dabs.length,
      restPose: () => Float32Array.from(rest.flat()),
      makeProxy({ pins = () => false, pinAt, ...options } = {}) {
        const solver = K.xpbd.sim({ ...o, ...(sceneWind && {wind:sim.wind}), ...options });
        linkGrid(solver, pins, pinAt, grid(0));
        return solver;
      },
      drawPose(st, positions) {
        if (!validPose(positions, rest.length * 3))
          throw new TypeError('A cloth pose needs one finite XYZ position per point');
        draw(st, positions, 0, false);
      },
      bind(st) { if (sceneWind) st.usesSceneWind = true; },
      update(dt, t, st) {
        if (sceneWind && st.sceneWind && (!hasSceneWind || windOptions !== st.motionEnvironment)) {
          windOptions = st.motionEnvironment;
          sim.wind = st.sceneWind();
          hasSceneWind = true;
        }
        if (!sys.shared) sim.step(dt, t);
        const settings = st.motionSettings?.(), rate = settings?.cadence.cloth;
        const sample = ArtDirection.time(settings, t, 'cloth');
        if (rate && sample === presented) return;
        presented = sample;
        draw(st, sim.X, base0, sim.torn);
      }
    };
    return sys;
  };

  K.hair = (B, o) => {
    o = o || {};
    const roots = o.roots || [],
      segs = o.segs || 5,
      len0 = o.len || 0.4,
      sim = o.sim || K.xpbd.sim(o),
      sun = norm(o.sun || [-0.5, 0.7, 0.5]),
      ramp0 = o.ramp || [1, 2, 3],
      ramp = ramp0.map(c => pack(B, c)),
      wid = o.width || 0.022,
      hl = o.lit || [0.08, 0.5, 0.25],
      droop = o.droop === undefined ? 0.9 : o.droop,
      frizz = o.frizz === undefined ? 0.02 : o.frizz,
      trim = o.trim === undefined ? 0.3 : o.trim,
      rnd = K.grow ? K.grow.dice(o.seed || 41) : Math.random;
    if (!sim.wind && o.wind) sim.wind = o.wind;
    // clump centres: strands near each other are drawn together toward the tip
    const clumps = [];
    if (o.clump)
      for (let c = 0; c < o.clump.n; c++) {
        const r = roots[Math.floor(rnd() * roots.length)];
        if (r) clumps.push(r);
      }
    const strands = [];
    for (const r of roots) {
      const n0 = norm(r.n),
        len1 = len0 * (r.len || 1),
        side = norm(Math.abs(n0[1]) < 0.95 ? cross(n0, [0, 1, 0]) : cross(n0, [1, 0, 0])),
        fwd = cross(side, n0),
        L = len1 * (1 - trim * 0.5 + trim * rnd()),
        sl = L / segs,
        idx = [],
        restL = [];
      let cl = null,
        cd = 1e9;
      for (const c of clumps) {
        const d = Math.hypot(c.p[0] - r.p[0], c.p[1] - r.p[1], c.p[2] - r.p[2]);
        if (d < cd) ((cd = d), (cl = c));
      }
      // groomed: out along the normal, bending down as it goes (droop), curled, frizzed, drawn into its clump
      let p = r.p.slice(),
        dir = n0.slice();
      const ph = rnd() * 6.283;
      for (let k = 0; k <= segs; k++) {
        if (k > 0) {
          const t = k / segs;
          dir = norm([dir[0], dir[1] - droop * 0.9 * (1 / segs) * 2.2, dir[2]]);
          if (o.curl) {
            const a = ph + t * o.curl.turns * 6.283,
              rr = o.curl.r * t;
            dir = norm([
              dir[0] + (side[0] * Math.cos(a) + fwd[0] * Math.sin(a)) * rr * 4,
              dir[1] + (side[1] * Math.cos(a) + fwd[1] * Math.sin(a)) * rr * 4,
              dir[2] + (side[2] * Math.cos(a) + fwd[2] * Math.sin(a)) * rr * 4
            ]);
          }
          p = [
            p[0] + dir[0] * sl + (rnd() - 0.5) * frizz * t,
            p[1] + dir[1] * sl + (rnd() - 0.5) * frizz * t,
            p[2] + dir[2] * sl + (rnd() - 0.5) * frizz * t
          ];
          if (cl && cl !== r) {
            const kk = (o.clump.k || 0.4) * t * t,
              tip = [
                cl.p[0] + norm(cl.n)[0] * L * t,
                cl.p[1] + norm(cl.n)[1] * L * t - droop * L * t * t * 0.5,
                cl.p[2] + norm(cl.n)[2] * L * t
              ];
            p = [
              p[0] + (tip[0] - p[0]) * kk * 0.3,
              p[1] + (tip[1] - p[1]) * kk * 0.3,
              p[2] + (tip[2] - p[2]) * kk * 0.3
            ];
          }
        }
        const pi = sim.point(p, k === 0 ? 0 : 1, wid * 0.8);
        if (k) sim.drag(pi, o.air === undefined ? 1.5 : o.air);
        idx.push(pi);
        restL.push(p.slice());
      }
      // its shade: the lock it belongs to sets most of it (so locks read apart), a little is its own (o.tone: how much, 0.3)
      const ci = cl ? clumps.indexOf(cl) : -1,
        tone =
          (o.tone === undefined ? 0.3 : o.tone) *
          ((ci >= 0 ? (Math.sin(ci * 12.9898) * 43758.5453) % 1 : rnd()) - 0.5 + (rnd() - 0.5) * 0.4);
      strands.push({ r, idx, restL, L, tone: Math.abs(tone) > 1 ? 0 : tone });
    }
    // where each strand's root and its groomed shape are now: the rig part's matrix applied to the rest pose
    let Mx = null;
    const now = (s, v) => {
      if (!s.r.part || !Mx) return v;
      const k = s.part * 12;
      return [
        Mx[k] * v[0] + Mx[k + 1] * v[1] + Mx[k + 2] * v[2] + Mx[k + 9],
        Mx[k + 3] * v[0] + Mx[k + 4] * v[1] + Mx[k + 5] * v[2] + Mx[k + 10],
        Mx[k + 6] * v[0] + Mx[k + 7] * v[1] + Mx[k + 8] * v[2] + Mx[k + 11]
      ];
    };
    for (const s of strands) {
      sim.pin(s.idx[0], () => now(s, s.restL[0]));
      for (let k = 1; k <= segs; k++) {
        sim.link(s.idx[k - 1], s.idx[k], o.stretch || 0);
        if (k >= 2) sim.link(s.idx[k - 2], s.idx[k], o.bend === undefined ? 1e-3 : o.bend);
        // the groomed shape holds firmest at the root and is let go toward the tip
        const tk = k / segs;
        sim.tie(s.idx[k], () => now(s, s.restL[k]), (o.shape === undefined ? 8e-3 : o.shape) * (0.3 + 2.5 * tk * tk));
      }
    }
    const first = B.count(),
      per = 2;
    for (const s of strands)
      for (let k = 0; k < segs * per; k++) B.iso(0, -99, 0, 0.02, B.P[ramp0[0]], 3, { nd: true });
    const sys = {
      sim,
      first,
      shared: !!o.sim,
      strands,
      bind(st) {
        for (const s of strands) if (s.r.part && st.rig) s.part = st.rig.part(s.r.part);
      },
      update(dt, t, st) {
        Mx = st.rig ? st.rig.M : null;
        if (!sys.shared) sim.step(dt, t);
        const X = sim.X;
        let m = first;
        for (const s of strands) {
          for (let k = 1; k <= segs; k++) {
            const a = s.idx[k - 1] * 3,
              b = s.idx[k] * 3,
              dx = X[b] - X[a],
              dy = X[b + 1] - X[a + 1],
              dz = X[b + 2] - X[a + 2],
              l = Math.hypot(dx, dy, dz) || 1e-6,
              T = [dx / l, dy / l, dz / l],
              // lit as hair is: brightest where it lies across the light, not along it
              tl = T[0] * sun[0] + T[1] * sun[1] + T[2] * sun[2],
              sh = Math.sqrt(Math.max(0, 1 - tl * tl)),
              tk = k / segs,
              // darker at the root (the coat shades itself), brighter toward the tip and where it lies across the light
              lv = hl[0] + hl[1] * sh * (0.4 + 0.6 * tk) + hl[2] * tk + s.tone,
              col = ramp[Math.max(0, Math.min(ramp.length - 1, Math.floor(lv * ramp.length)))],
              w = wid * (1.1 - 0.6 * tk);
            for (let q = 0; q < per; q++) {
              const f = (q + 0.5) / per;
              put(st, m++, X[a] + dx * f, X[a + 1] + dy * f, X[a + 2] + dz * f, null, w, 0, col, T, (l / per) * 0.75);
            }
          }
        }
      }
    };
    return sys;
  };
})(KIT);
