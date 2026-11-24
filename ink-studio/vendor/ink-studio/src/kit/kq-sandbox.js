/* kq-sandbox: everything as stuff. A diorama may hand part of itself to a grid of cells, each holding a material and a temperature,
   and the grid is stepped like falling sand: powders fall and slide, liquids fall, spread and settle by weight (oil on water), gases
   rise, or sink if heavier than air, and drift and thin away, heat spreads through what conducts it, and every material melts,
   freezes, boils, condenses, catches fire, burns out, dissolves or blows up as its table says. Pairs that touch may react (water on
   lava: steam and stone). A blast throws what is loose and breaks what is brittle; what is thrown flies and lands where it lands.
   What is in the grid is drawn as splats, one for each cell that can be seen, written into a block of the world's own splats, so it
   sorts, hazes and outlines with everything else. The grid works in chunks of 8 x 8 x 8 cells, and a chunk where nothing has changed
   goes to sleep: a cellar full of still water costs nothing until something stirs it. Only a world that asks for a grid has one.

     K.sandbox.materials       the table, name -> { state: 'solid' | 'powder' | 'liquid' | 'gas' | 'fire', density, flow (cells a step
                               a liquid may run sideways), slow (a share of steps a thick liquid moves at all), slide (how readily a
                               powder rolls off a heap), cond (how well heat goes through it), cap (how much heat it takes to warm),
                               temp (what it is when made; hold: kept at least that hot while it lasts, as fire and embers are),
                               melt / boil { at, to }, freeze / condense { below, to }, ignite { at, to,
                               blast }, life [lo, hi] (steps, then it becomes leaves), leaves, flames (an ember's chance of a flame
                               above it), breaks (what a blast leaves of it), hard (the nearer a blast's middle it must be to break),
                               brittle (a push breaks it too), acid (how readily acid eats it), eats (how hungry an acid
                               is), fumes (what eating gives off), glow, alpha, cols: [dark .. light] (0xrrggbb) }. Change or add to it.
     K.sandbox.reactions       pairs that react on touching: [a, b, a becomes, b becomes, chance] ('' leaves that one as it was)
     K.sandbox.grid(o)         where a grid stands and how fine: o.at (its lowest corner), size [x, y, z], cell (0.1), open (gases
                               that reach its top go on out of it; true). Fill it, then
                               .spec(palette) for the world. .walls(sdf) (what the sculpt has, as fixed walls nothing passes),
                               or .walls(sdf, { as: name | fn(x, y, z) -> name }): the sculpt's solids as real stuff (stone, brick,
                               wood..., 'wall' where nothing may change) that the scene goes on drawing until a blast, a fire or acid
                               gets at them, when the grid takes over there and the scene's own splats there are put away, so a hole
                               has real sides; .baked(lo, hi, name) (or .baked(fn(x, y, z, now) -> name)) says what they are in a box,
                               .fill(fn(x, y, z) -> name), .box(lo, hi, name), .ball(c, r, name), .source(o) (a spring, a spout:
                               { mat, at, r, every, n, v (thrown that fast), temp }), .heater({ at, r, temp, rate }) (a fire under a
                               pot, a cold larder), .sink({ at, r }) (a drain), .colors({ name: [palette indices dark .. light] }),
                               .sun(dir), .tool(name)
     K.sandbox(spec)           the simulation. .step() .cast(spell, p, o) .explode(p, r, power, o) .push(p, r, power, o)
                               .pour(p, name, n, r) .heat(p, r, dT) .dig(p, r) .at(p) -> { name, temp } .count(name)
                               .uncovered() (scene cells handed over since last asked) .blasts() (x, y, z, r, power, push: 6 each)
                               .draw(block, slots) -> rows written. Spells by the game's names: flame, frost, nova, bolt, chain, fist,
                               gulp, venom; and pour tools: water, oil, lava, sand, powder, acid, ice, dig.
     K.sandbox.attach(W, o)    the world gets a block of splats for the grid and a stage system that steps it (here, or in a worker:
                               o.worker() -> Worker), draws it, and casts W.anim.tool where the diorama is tapped. Do it before
                               anything else sets the world moving. W.anim.sandbox: .cast(spell, p) .onBlast(f({ p, r, power, push }))
                               .sim (when stepped here) .stats .steps
     K.sandbox.serve(self)     the worker's side: answers init, run (to a time), cast. */
(function (K) {
  const AIR = 0,
    WALL = 1,
    SOLID = 2,
    POWDER = 3,
    LIQUID = 4,
    GAS = 5,
    FIRE = 6;
  const STATES = { air: AIR, wall: WALL, solid: SOLID, powder: POWDER, liquid: LIQUID, gas: GAS, fire: FIRE };
  const MAT = {
    air: { state: 'air', density: 0, cond: 0.05, cap: 0.4 },
    wall: { state: 'wall', density: 99, cond: 0.2, cap: 1.4 },
    stone: {
      state: 'solid',
      density: 3,
      cond: 0.22,
      cap: 1,
      melt: { at: 1250, to: 'lava' },
      breaks: 'gravel',
      hard: 1.3,
      acid: 0.05,
      cols: [0x2b2a33, 0x45444f, 0x63616b, 0x85828a]
    },
    basalt: {
      state: 'solid',
      density: 3,
      cond: 0.22,
      cap: 1,
      melt: { at: 1250, to: 'lava' },
      breaks: 'gravel',
      hard: 1.1,
      acid: 0.04,
      cols: [0x15111a, 0x241c28, 0x382c3a, 0x4c3e4c]
    },
    // fired brick: what a forge or a kiln is lined with; it takes the heat that melts stone
    brick: {
      state: 'solid',
      density: 2.2,
      cond: 0.16,
      cap: 1,
      melt: { at: 1700, to: 'lava' },
      breaks: 'gravel',
      hard: 1.5,
      acid: 0.03,
      cols: [0x3a2420, 0x5a3428, 0x7a4a36, 0x9a6448]
    },
    shards: {
      state: 'powder',
      density: 2.5,
      slide: 0.25,
      cond: 0.3,
      cap: 0.8,
      melt: { at: 1400, to: 'lava' },
      alpha: 0.8,
      cols: [0x4a7a80, 0x7ab0b4, 0xb8e0e0]
    },
    // what a blast knocks off stone and brick and does not throw: a cloud that hangs, drifts and settles out
    dust: {
      state: 'gas',
      density: -0.08,
      cond: 0.06,
      cap: 0.4,
      life: [50, 140],
      alpha: 0.4,
      cols: [0x34343a, 0x4e4e56, 0x6c6c72]
    },
    gravel: {
      state: 'powder',
      density: 2.4,
      slide: 0.3,
      cond: 0.18,
      cap: 1,
      melt: { at: 1250, to: 'lava' },
      acid: 0.07,
      cols: [0x34323a, 0x524e56, 0x726c72]
    },
    sand: {
      state: 'powder',
      density: 2,
      slide: 0.55,
      cond: 0.18,
      cap: 0.9,
      melt: { at: 1450, to: 'glass' },
      acid: 0.08,
      cols: [0x7a5a32, 0xa8844a, 0xcca660, 0xe6c888]
    },
    dirt: {
      state: 'powder',
      density: 1.8,
      slide: 0.2,
      cond: 0.15,
      cap: 1,
      acid: 0.1,
      cols: [0x2e2016, 0x4a3422, 0x664a30]
    },
    glass: {
      state: 'solid',
      density: 2.5,
      cond: 0.3,
      cap: 0.8,
      melt: { at: 1400, to: 'lava' },
      breaks: 'shards',
      brittle: true,
      hard: 0.3,
      alpha: 0.7,
      cols: [0x4a7a80, 0x7ab0b4, 0xb8e0e0]
    },
    water: {
      state: 'liquid',
      density: 1,
      flow: 5,
      cond: 0.45,
      cap: 1.3,
      boil: { at: 100, to: 'steam' },
      freeze: { below: -1, to: 'ice' },
      cols: [0x123a68, 0x1d5590, 0x2e74b4, 0x6aa8dc, 0xc8e6f6]
    },
    ice: {
      state: 'solid',
      density: 0.92,
      cond: 0.5,
      cap: 1.1,
      temp: -12,
      melt: { at: 1, to: 'water' },
      breaks: 'snow',
      brittle: true,
      hard: 0.4,
      acid: 0.1,
      cols: [0x4c7aa0, 0x7aaed0, 0xb2d8ee, 0xe8f6ff]
    },
    snow: {
      state: 'powder',
      density: 0.4,
      slide: 0.12,
      cond: 0.2,
      cap: 1,
      temp: -6,
      melt: { at: 1, to: 'water' },
      acid: 0.15,
      cols: [0x9aaabf, 0xc8d6e4, 0xf0f6fc]
    },
    steam: {
      state: 'gas',
      density: -0.6,
      cond: 0.12,
      cap: 0.5,
      temp: 108,
      condense: { below: 70, to: 'water', chance: 0.02 },
      life: [500, 900],
      alpha: 0.4,
      cols: [0x8a96a0, 0xb6c2ca, 0xdce6ec]
    },
    lava: {
      state: 'liquid',
      density: 2.6,
      flow: 2,
      slow: 0.3,
      cond: 0.24,
      cap: 2.2,
      temp: 1150,
      freeze: { below: 720, to: 'basalt' },
      glow: [700, 1200],
      cols: [0x2a0806, 0x6e1608, 0xb83410, 0xee7020, 0xffc850]
    },
    oil: {
      state: 'liquid',
      density: 0.8,
      flow: 4,
      cond: 0.12,
      cap: 0.9,
      ignite: { at: 230, to: 'blaze' },
      acid: 0.02,
      cols: [0x0e0b08, 0x22190c, 0x3a2c16]
    },
    // oil alight: still a liquid, still floating, burning where it lies for a while and throwing up flames. It lights the oil it
    // touches (see the reactions) rather than heating it, and gives little of its heat downward, so a slick burns across the water
    // it lies on without boiling it
    blaze: {
      state: 'liquid',
      density: 0.78,
      flow: 3,
      cond: 0.008,
      cap: 0.6,
      temp: 780,
      hold: true,
      life: [70, 150],
      leaves: 'smoke',
      flames: 0.3,
      glow: [400, 800],
      cols: [0x3a1608, 0x8a2a10, 0xe0601a, 0xffb040]
    },
    fire: {
      state: 'fire',
      density: -0.3,
      cond: 0.3,
      cap: 0.4,
      temp: 950,
      life: [10, 26],
      leaves: 'smoke',
      smoke: 0.3,
      glow: [500, 1000],
      cols: [0xa82410, 0xe8601a, 0xffa830, 0xfff0a0]
    },
    smoke: {
      state: 'gas',
      density: -0.4,
      cond: 0.06,
      cap: 0.4,
      life: [160, 420],
      alpha: 0.45,
      cols: [0x26242a, 0x3e3c44, 0x5c5a60]
    },
    wood: {
      state: 'solid',
      density: 0.7,
      cond: 0.07,
      cap: 1.2,
      ignite: { at: 280, to: 'ember' },
      breaks: 'ash',
      hard: 0.7,
      acid: 0.12,
      cols: [0x2e1c10, 0x4e321c, 0x70482a, 0x8e6238]
    },
    ember: {
      state: 'solid',
      density: 0.7,
      cond: 0.2,
      cap: 0.8,
      temp: 720,
      hold: true,
      life: [80, 200],
      leaves: 'ash',
      flames: 0.22,
      glow: [400, 800],
      cols: [0x3a0e06, 0x8a2410, 0xd85018, 0xffa040]
    },
    ash: {
      state: 'powder',
      density: 0.5,
      slide: 0.35,
      cond: 0.1,
      cap: 0.6,
      acid: 0.2,
      cols: [0x3a3838, 0x5a5856, 0x7e7c78]
    },
    acid: {
      state: 'liquid',
      density: 1.1,
      flow: 4,
      cond: 0.4,
      cap: 1.1,
      eats: 0.3,
      fumes: 0.3,
      boil: { at: 130, to: 'fumes' },
      cols: [0x285a12, 0x4a9a1c, 0x8ad034, 0xcaf26a]
    },
    fumes: {
      state: 'gas',
      density: 0.35,
      cond: 0.06,
      cap: 0.4,
      life: [200, 450],
      alpha: 0.42,
      cols: [0x2e4a1c, 0x4a6e2a, 0x6e9440]
    },
    poison: {
      state: 'gas',
      density: 0.45,
      cond: 0.06,
      cap: 0.4,
      life: [400, 900],
      alpha: 0.45,
      cols: [0x2e1e3a, 0x4a2e5c, 0x6e4a82]
    },
    powder: {
      state: 'powder',
      density: 1.4,
      slide: 0.4,
      cond: 0.15,
      cap: 0.8,
      ignite: { at: 170, blast: [3.2, 7] },
      acid: 0.1,
      cols: [0x18181c, 0x2a2a30, 0x3e3e48]
    },
    metal: {
      state: 'solid',
      density: 7,
      cond: 0.9,
      cap: 0.5,
      melt: { at: 1400, to: 'molten' },
      acid: 0.02,
      cols: [0x30303a, 0x50505c, 0x80808e, 0xb8b8c6]
    },
    molten: {
      state: 'liquid',
      density: 6.5,
      flow: 2,
      slow: 0.45,
      cond: 0.7,
      cap: 0.7,
      temp: 1550,
      freeze: { below: 1300, to: 'metal' },
      glow: [1200, 1600],
      cols: [0x6e1a0c, 0xc85a1c, 0xffa848, 0xfff0c0]
    }
  };
  const REACT = [
    ['water', 'lava', 'steam', 'basalt', 0.45],
    ['water', 'molten', 'steam', 'metal', 0.45],
    ['water', 'fire', '', 'steam', 0.7],
    ['water', 'ember', 'steam', 'ash', 0.35],
    ['snow', 'lava', 'water', 'basalt', 0.3],
    ['ice', 'lava', 'water', 'basalt', 0.12],
    ['acid', 'water', 'water', '', 0.01],
    ['oil', 'lava', 'blaze', '', 0.3],
    ['blaze', 'oil', '', 'blaze', 0.5],
    ['blaze', 'wood', '', 'ember', 0.04],
    ['blaze', 'ice', '', 'water', 0.03],
    ['blaze', 'snow', '', 'water', 0.1]
  ];
  // the six faces, then the four ways a thing may roll off downhill, then the four ways along the level
  const rnd = s => {
    let x = s >>> 0 || 1;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
  };
  const hexRGB = h => ((h >> 16) & 255) + ((h >> 8) & 255) * 256 + (h & 255) * 65536;

  /* ---- the grid, as a diorama fills it in at build time ---- */
  const grid = o => {
    const cell = o.cell || 0.1,
      at = o.at,
      n = [Math.ceil(o.size[0] / cell) + 2, Math.ceil(o.size[1] / cell) + 2, Math.ceil(o.size[2] / cell) + 2],
      N = n[0] * n[1] * n[2],
      names = ['air', 'wall'],
      mat = new Uint8Array(N),
      T = new Float32Array(N),
      amb = o.amb === undefined ? 20 : o.amb,
      baked = new Uint8Array(N),
      sources = [],
      heaters = [],
      sinks = [],
      cols = {};
    T.fill(amb);
    let sun = [-0.5, 0.7, -0.5],
      tool = 'flame',
      open = o.open !== false;
    const id = name => {
      let k = names.indexOf(name);
      if (k < 0) {
        if (!MAT[name]) throw new Error('sandbox: no material called ' + name);
        k = names.push(name) - 1;
      }
      return k;
    };
    const idx = (x, y, z) => x + n[0] * (z + n[2] * y);
    // the cell a place falls in, and the place a cell stands for (its middle)
    const cellOf = p => [
      Math.floor((p[0] - at[0]) / cell) + 1,
      Math.floor((p[1] - at[1]) / cell) + 1,
      Math.floor((p[2] - at[2]) / cell) + 1
    ];
    const mid = (x, y, z) => [at[0] + (x - 0.5) * cell, at[1] + (y - 0.5) * cell, at[2] + (z - 0.5) * cell];
    const each = f => {
      for (let y = 1; y < n[1] - 1; y++)
        for (let z = 1; z < n[2] - 1; z++) for (let x = 1; x < n[0] - 1; x++) f(x, y, z, idx(x, y, z));
    };
    const put = (i, name) => {
      const k = name ? id(name) : 0;
      mat[i] = k;
      T[i] = k > 1 && MAT[name].temp !== undefined ? MAT[name].temp : amb;
    };
    // the border all round is wall
    for (let y = 0; y < n[1]; y++)
      for (let z = 0; z < n[2]; z++)
        for (let x = 0; x < n[0]; x++)
          if (!x || !y || !z || x === n[0] - 1 || y === n[1] - 1 || z === n[2] - 1) mat[idx(x, y, z)] = WALL;
    const g = {
      n,
      cell,
      at,
      idx,
      cellOf,
      mid,
      walls(sdf, wo) {
        // asked in blocks of 4 x 4 x 4 cells first: a block well inside or well outside is settled by its middle alone
        // (a cell whose middle is on a face counts as wall: a basin whose sides fall on the lattice does not leak along them).
        // wo: the inset (a number), or { inset, as }: as names what the scene's solids are made of here (a name, or a function of
        // the place giving one; 'wall' or nothing for what may not change). Those cells are the scene's own: it goes on drawing
        // them until something happens to them, and then the grid takes over there (see .baked)
        wo = typeof wo === 'object' && wo ? wo : { inset: wo };
        const e = wo.inset === undefined ? cell * 0.25 : wo.inset,
          reach = 2 * cell * 1.8,
          as = wo.as,
          made = (i, p) => {
            const nm = typeof as === 'function' ? as(p[0], p[1], p[2]) : as;
            if (!nm || nm === 'wall') mat[i] = WALL;
            else {
              put(i, nm);
              baked[i] = 1;
            }
          };
        for (let by = 1; by < n[1] - 1; by += 4)
          for (let bz = 1; bz < n[2] - 1; bz += 4)
            for (let bx = 1; bx < n[0] - 1; bx += 4) {
              const c = mid(bx + 1.5, by + 1.5, bz + 1.5),
                d = sdf(c[0], c[1], c[2]) - e;
              if (d > reach) continue;
              for (let y = by; y < Math.min(n[1] - 1, by + 4); y++)
                for (let z = bz; z < Math.min(n[2] - 1, bz + 4); z++)
                  for (let x = bx; x < Math.min(n[0] - 1, bx + 4); x++) {
                    const i = idx(x, y, z);
                    if (d < -reach) {
                      if (as) made(i, mid(x, y, z));
                      else mat[i] = WALL;
                    } else {
                      const p = mid(x, y, z);
                      if (sdf(p[0], p[1], p[2]) < e) {
                        if (as) made(i, p);
                        else mat[i] = WALL;
                      }
                    }
                  }
            }
        return g;
      },
      // what the scene's own solids are made of, in a box (or where fn(x, y, z) says): name, or 'wall' for what may not change
      baked(lo, hi, name) {
        const fn =
          typeof lo === 'function'
            ? lo
            : (x, y, z) =>
                x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2] ? name : null;
        each((x, y, z, i) => {
          if (!baked[i]) return;
          const p = mid(x, y, z),
            nm = fn(p[0], p[1], p[2], names[mat[i]]);
          if (!nm) return;
          if (nm === 'wall') {
            mat[i] = WALL;
            baked[i] = 0;
          } else put(i, nm);
        });
        return g;
      },
      fill(fn) {
        each((x, y, z, i) => {
          if (mat[i] === WALL || baked[i]) return;
          const p = mid(x, y, z),
            name = fn(p[0], p[1], p[2]);
          if (name) put(i, name === 'air' ? null : name);
        });
        return g;
      },
      box(lo, hi, name) {
        return g.fill((x, y, z) =>
          x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2] ? name : null
        );
      },
      ball(c, r, name) {
        return g.fill((x, y, z) => ((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 < r * r ? name : null));
      },
      source(s) {
        id(s.mat);
        sources.push(Object.assign({ r: cell, every: 1, n: 1 }, s));
        return g;
      },
      heater(h) {
        heaters.push(Object.assign({ rate: 0.2 }, h));
        return g;
      },
      // a drain: what runs or falls into it is gone
      sink(k) {
        sinks.push(Object.assign({ r: cell * 2 }, k));
        return g;
      },
      colors(c) {
        Object.assign(cols, c);
        return g;
      },
      sun(d) {
        sun = d;
        return g;
      },
      tool(t) {
        tool = t;
        return g;
      },
      count: name => {
        const k = names.indexOf(name);
        let c = 0;
        for (let i = 0; i < N; i++) if (mat[i] === k) c++;
        return c;
      },
      spec(pal) {
        // every material that what is here can turn into comes along (and what those turn into), so the simulation never meets a
        // name it was not given; and the few the spells make
        for (const t of ['fire', 'smoke', 'steam', 'water', 'ice', 'snow', 'acid', 'gravel', 'dust']) id(t);
        let before = 0;
        while (before !== names.length) {
          before = names.length;
          for (let k = 2; k < names.length; k++) {
            const m = MAT[names[k]];
            for (const t of [m.melt, m.freeze, m.boil, m.condense, m.ignite]) if (t && t.to) id(t.to);
            for (const t of [m.leaves, m.breaks]) if (t) id(t);
            if (m.smoke) id('smoke');
            if (m.eats) id('fumes');
            if (m.flames) id('fire');
          }
          for (const r of REACT)
            if (names.includes(r[0]) && names.includes(r[1])) for (const t of [r[2], r[3]]) if (t) id(t);
        }
        const C = {};
        for (const name of names.slice(2)) {
          const c = cols[name];
          C[name] = c ? c.map(i => (pal ? hexRGB(pal[i]) : i)) : MAT[name].cols.map(hexRGB);
        }
        return {
          at,
          cell,
          n,
          names: names.slice(),
          mat,
          T,
          amb,
          sources,
          heaters,
          sinks,
          cols: C,
          sun,
          tool,
          open: open,
          rate: o.rate || 30,
          seed: o.seed || 1,
          mats: o.materials || null,
          baked: baked.some(v => v) ? baked : null
        };
      }
    };
    return g;
  };

  /* ---- the simulation ---- */
  const sandbox = spec => {
    const [nx, ny, nz] = spec.n,
      L = nx * nz,
      N = nx * ny * nz,
      cell = spec.cell,
      at = spec.at,
      amb = spec.amb,
      names = spec.names,
      NM = names.length,
      table = Object.assign({}, MAT, spec.mats || {}),
      R = rnd(spec.seed * 7919 + 13);
    const mat = Uint8Array.from(spec.mat),
      T = Float32Array.from(spec.T),
      life = new Uint16Array(N),
      tone = new Uint8Array(N),
      stamp = new Uint16Array(N);
    for (let i = 0; i < N; i++) tone[i] = (R() * 256) | 0;
    // the scene's own solids, which it draws until something happens to them; the cells handed over since last asked; and the
    // blasts since last asked (x, y, z, r, power, 1 if only a push: six numbers each)
    const baked = spec.baked ? Uint8Array.from(spec.baked) : null;
    let unc = [],
      evs = [];
    const ID = Object.fromEntries(names.map((nm, k) => [nm, k])),
      idOf = nm => (nm in ID ? ID[nm] : nm === 'air' || !nm ? AIR : -1);
    // what every material is, by number, for the inner loops
    const ST = new Uint8Array(NM),
      DEN = new Float32Array(NM),
      FLOW = new Uint8Array(NM),
      SLOW = new Float32Array(NM),
      SLIDE = new Float32Array(NM),
      COND = new Float32Array(NM),
      TEMP = new Float32Array(NM),
      HOLD = new Uint8Array(NM),
      MELT = new Int16Array(NM).fill(-1),
      MELTAT = new Float32Array(NM),
      FRZ = new Int16Array(NM).fill(-1),
      FRZB = new Float32Array(NM),
      BOIL = new Int16Array(NM).fill(-1),
      BOILAT = new Float32Array(NM),
      CND = new Int16Array(NM).fill(-1),
      CNDB = new Float32Array(NM),
      CNDC = new Float32Array(NM),
      IGN = new Int16Array(NM).fill(-1),
      IGNAT = new Float32Array(NM),
      BLAST = new Float32Array(NM * 2),
      LIFE0 = new Uint16Array(NM),
      LIFE1 = new Uint16Array(NM),
      LEAVES = new Int16Array(NM),
      SMOKE = new Float32Array(NM),
      FLAMES = new Float32Array(NM),
      BREAKS = new Int16Array(NM).fill(-1),
      HARD = new Float32Array(NM).fill(1),
      BRITTLE = new Uint8Array(NM),
      ACID = new Float32Array(NM),
      EATS = new Float32Array(NM),
      FUMES = new Float32Array(NM),
      GLOW0 = new Float32Array(NM),
      GLOW1 = new Float32Array(NM),
      ALPHA = new Float32Array(NM).fill(1),
      AIRY = new Uint8Array(NM);
    names.forEach((nm, k) => {
      const m = table[nm];
      ST[k] = STATES[m.state];
      DEN[k] = m.density || 0;
      FLOW[k] = m.flow || 0;
      SLOW[k] = m.slow === undefined ? 1 : m.slow;
      SLIDE[k] = m.slide === undefined ? 0.4 : m.slide;
      COND[k] = Math.min(0.16, ((m.cond || 0.1) * 0.15) / (m.cap || 1)) * 6;
      TEMP[k] = m.temp === undefined ? amb : m.temp;
      HOLD[k] = m.state === 'fire' || m.hold ? 1 : 0;
      if (m.melt) ((MELT[k] = idOf(m.melt.to)), (MELTAT[k] = m.melt.at));
      if (m.freeze) ((FRZ[k] = idOf(m.freeze.to)), (FRZB[k] = m.freeze.below));
      if (m.boil) ((BOIL[k] = idOf(m.boil.to)), (BOILAT[k] = m.boil.at));
      if (m.condense)
        ((CND[k] = idOf(m.condense.to)), (CNDB[k] = m.condense.below), (CNDC[k] = m.condense.chance || 0.05));
      if (m.ignite) {
        IGNAT[k] = m.ignite.at;
        IGN[k] = m.ignite.blast ? -2 : idOf(m.ignite.to);
        if (m.ignite.blast) ((BLAST[k * 2] = m.ignite.blast[0]), (BLAST[k * 2 + 1] = m.ignite.blast[1]));
      }
      if (m.life) ((LIFE0[k] = m.life[0]), (LIFE1[k] = m.life[1]));
      LEAVES[k] = m.leaves ? idOf(m.leaves) : AIR;
      SMOKE[k] = m.smoke || 0;
      FLAMES[k] = m.flames || 0;
      if (m.breaks) BREAKS[k] = idOf(m.breaks);
      if (m.hard) HARD[k] = m.hard;
      if (m.brittle) BRITTLE[k] = 1;
      ACID[k] = m.acid || 0;
      EATS[k] = m.eats || 0;
      FUMES[k] = m.fumes || 0;
      if (m.glow) ((GLOW0[k] = m.glow[0]), (GLOW1[k] = m.glow[1]));
      if (m.alpha) ALPHA[k] = m.alpha;
      AIRY[k] = m.state === 'air' || m.state === 'gas' ? 1 : m.state === 'fire' ? 2 : 0;
    });
    const RX = new Int16Array(NM * NM).fill(-1),
      RA = [],
      RB = [],
      RC = [];
    for (const r of REACT.concat(spec.reactions || [])) {
      const a = idOf(r[0]),
        b = idOf(r[1]);
      if (a < 0 || b < 0) continue;
      const k = RA.length;
      RA.push(r[2] ? idOf(r[2]) : -1);
      RB.push(r[3] ? idOf(r[3]) : -1);
      RC.push(r[4]);
      RX[a * NM + b] = k * 2;
      RX[b * NM + a] = k * 2 + 1;
    }
    const FIREID = idOf('fire'),
      SMOKEID = idOf('smoke'),
      FUMESID = idOf('fumes'),
      DUSTID = idOf('dust'),
      SNOWID = idOf('snow'),
      ICEID = idOf('ice');
    for (let i = 0; i < N; i++)
      if (mat[i] > 1 && LIFE1[mat[i]]) life[i] = LIFE0[mat[i]] + R() * (LIFE1[mat[i]] - LIFE0[mat[i]]);
    // the chunks: which are awake (a count of steps to stay so), which changed this step, which must be drawn again
    const CS = 8,
      cnx = Math.ceil(nx / CS),
      cny = Math.ceil(ny / CS),
      cnz = Math.ceil(nz / CS),
      NC = cnx * cny * cnz,
      awake = new Uint8Array(NC),
      chStamp = new Uint32Array(NC),
      redraw = new Uint8Array(NC),
      chunkOf = new Uint16Array(N),
      edge = new Uint8Array(N);
    for (let y = 0; y < ny; y++)
      for (let z = 0; z < nz; z++)
        for (let x = 0; x < nx; x++) {
          const i = x + nx * (z + nz * y);
          chunkOf[i] = (x >> 3) + cnx * ((z >> 3) + cnz * (y >> 3));
          edge[i] =
            ((x & 7) === 0 ? 1 : 0) |
            ((x & 7) === 7 ? 2 : 0) |
            ((z & 7) === 0 ? 4 : 0) |
            ((z & 7) === 7 ? 8 : 0) |
            ((y & 7) === 0 ? 16 : 0) |
            ((y & 7) === 7 ? 32 : 0);
        }
    const CSTEP = [-1, 1, -cnx, cnx, -cnx * cnz, cnx * cnz];
    // the chunks in the order they are stepped: from the bottom up, so what falls is not moved twice
    const order = Array.from({ length: NC }, (_, c) => c).sort(
      (a, b) => Math.floor(a / (cnx * cnz)) - Math.floor(b / (cnx * cnz))
    );
    awake.fill(6);
    redraw.fill(1);
    let sid = 0,
      steps = 0,
      changedN = 0;
    const changedList = new Int32Array(NC);
    // something happened to one of the scene's solids: from now the grid draws it, and the scene's own cells beside it (so a hole
    // has sides), and the scene is told to put away what it drew there
    const uncover = i => {
      baked[i] = 0;
      unc.push(i);
      for (let k = 0; k < 6; k++) {
        const j = i + (k === 0 ? -1 : k === 1 ? 1 : k === 2 ? -nx : k === 3 ? nx : k === 4 ? -L : L);
        if (baked[j]) {
          baked[j] = 0;
          unc.push(j);
          touched(j);
        }
      }
    };
    const touched = i => {
      if (baked !== null && baked[i]) uncover(i);
      const c = chunkOf[i];
      if (chStamp[c] !== steps + 1) {
        chStamp[c] = steps + 1;
        changedList[changedN++] = c;
      }
      redraw[c] = 1;
      const e = edge[i];
      if (e)
        for (let k = 0; k < 6; k++)
          if (e & (1 << k)) {
            const q = c + CSTEP[k];
            if (q >= 0 && q < NC) redraw[q] = 1;
          }
    };
    const wakeAround = c => {
      const cx = c % cnx,
        cz = Math.floor(c / cnx) % cnz,
        cy = Math.floor(c / (cnx * cnz));
      for (let y = Math.max(0, cy - 1); y <= Math.min(cny - 1, cy + 1); y++)
        for (let z = Math.max(0, cz - 1); z <= Math.min(cnz - 1, cz + 1); z++)
          for (let x = Math.max(0, cx - 1); x <= Math.min(cnx - 1, cx + 1); x++) {
            const q = x + cnx * (z + cnz * y);
            if (awake[q] < 8) awake[q] = 8;
          }
    };
    const wakeAt = i => {
      touched(i);
      wakeAround(chunkOf[i]);
    };
    const N6 = [-1, 1, -nx, nx, -L, L],
      DI4 = [-1, 1, -nx, nx];
    const swap = (i, j) => {
      let t = mat[i];
      mat[i] = mat[j];
      mat[j] = t;
      const f = T[i];
      T[i] = T[j];
      T[j] = f;
      t = life[i];
      life[i] = life[j];
      life[j] = t;
      t = tone[i];
      tone[i] = tone[j];
      tone[j] = t;
      stamp[i] = stamp[j] = sid;
      touched(i);
      touched(j);
    };
    const become = (i, k) => {
      mat[i] = k;
      life[i] = LIFE1[k] ? LIFE0[k] + R() * (LIFE1[k] - LIFE0[k]) : 0;
      tone[i] = (R() * 256) | 0;
      stamp[i] = sid;
      touched(i);
    };
    // may a thing of material m go into a place holding n, going down (or for gases, the way they go)?
    const sinks = (m, n) => {
      const s = ST[n];
      if (s === AIR || s === GAS || s === FIRE) return true;
      return s === LIQUID && DEN[n] < DEN[m] && n !== m;
    };
    const rises = (m, n) => {
      const s = ST[n];
      if (s === AIR) return true;
      if (s === GAS || s === FIRE) return DEN[n] > DEN[m];
      return s === LIQUID && R() < 0.4;
    };
    const drifts = n => ST[n] === AIR || ST[n] === GAS;

    const movePowder = (i, m) => {
      const b = i - L;
      if (sinks(m, mat[b])) return swap(i, b);
      if (R() < SLIDE[m]) {
        const r = (R() * 4) | 0;
        for (let k = 0; k < 4; k++) {
          const d = DI4[(r + k) & 3];
          if (sinks(m, mat[b + d]) && sinks(m, mat[i + d])) return swap(i, b + d);
        }
      }
    };
    const moveLiquid = (i, m) => {
      if (SLOW[m] < 1 && R() > SLOW[m]) return;
      const b = i - L;
      if (sinks(m, mat[b])) return swap(i, b);
      const r = (R() * 4) | 0;
      for (let k = 0; k < 4; k++) {
        const d = DI4[(r + k) & 3];
        if (sinks(m, mat[b + d]) && sinks(m, mat[i + d])) return swap(i, b + d);
      }
      // along the level. A liquid with more of itself (or anything heavy) pressing from above passes that pressure on through its own
      // kind and comes out at the first free place past it, so a pool levels and a stream fed from a full basin runs on along its
      // channel. With nothing above, it looks a little way along for somewhere to drop (so an edge spills off a ledge); failing that a
      // drop lying on its own kind wanders over the surface, and one lying on anything else holds together: it moves only to a place
      // with at least as many of its kind beside it, so a puddle stays one sheet and a lone drop sits until it joins another
      const F = FLOW[m],
        pressed = ST[mat[i + L]] === LIQUID || ST[mat[i + L]] === POWDER;
      if (pressed) {
        if (R() > 0.8) return;
        for (let k = 0; k < 4; k++) {
          const d = DI4[(r + k) & 3];
          let q = i + d;
          for (let through = 0; mat[q] === m && through < 12; through++) q += d;
          if (sinks(m, mat[q])) return swap(i, q);
        }
        return;
      }
      for (let k = 0; k < 4; k++) {
        const d = DI4[(r + k) & 3];
        let q = i;
        for (let s = 0; s < F; s++) {
          q += d;
          if (!sinks(m, mat[q])) break;
          if (sinks(m, mat[q - L])) return swap(i, q);
        }
      }
      if (R() > 0.3) return;
      const d = DI4[r],
        q = i + d;
      if (!sinks(m, mat[q])) return;
      if (mat[b] === m) return swap(i, q);
      const near = c => (mat[c - 1] === m) + (mat[c + 1] === m) + (mat[c - nx] === m) + (mat[c + nx] === m);
      const here = near(i),
        there = near(q) - 1;
      if (there >= Math.max(1, here)) swap(i, q);
    };
    const moveGas = (i, m) => {
      const d = DEN[m],
        v = d < 0 ? L : -L;
      if (R() < (d < 0 ? 0.8 : 0.5)) {
        const j = i + v;
        if (d < 0 ? rises(m, mat[j]) : ST[mat[j]] === AIR || (ST[mat[j]] === GAS && DEN[mat[j]] < d)) return swap(i, j);
      }
      if (R() < 0.6) {
        const j = i + DI4[(R() * 4) | 0];
        if (drifts(mat[j]) && mat[j] !== m) return swap(i, j);
      }
    };
    const moveFire = (i, m) => {
      const r = R();
      const j = r < 0.55 ? i + L : i + DI4[(R() * 4) | 0] + (r < 0.8 ? L : 0);
      if (ST[mat[j]] === AIR || (ST[mat[j]] === GAS && mat[j] !== m)) swap(i, j);
    };

    // ---- blasts, pushes and what flies
    const PMAX = 6000,
      P = {
        n: 0,
        x: new Float32Array(PMAX),
        y: new Float32Array(PMAX),
        z: new Float32Array(PMAX),
        vx: new Float32Array(PMAX),
        vy: new Float32Array(PMAX),
        vz: new Float32Array(PMAX),
        m: new Uint8Array(PMAX),
        T: new Float32Array(PMAX),
        t: new Uint16Array(PMAX),
        dirty: false
      };
    const fling = (x, y, z, vx, vy, vz, m, t) => {
      if (P.n >= PMAX) return false;
      const k = P.n++;
      P.x[k] = x;
      P.y[k] = y;
      P.z[k] = z;
      P.vx[k] = vx;
      P.vy[k] = vy;
      P.vz[k] = vz;
      P.m[k] = m;
      P.T[k] = t;
      P.t[k] = 0;
      P.dirty = true;
      return true;
    };
    const ix = (x, y, z) => {
      const a = Math.floor(x),
        b = Math.floor(y),
        c = Math.floor(z);
      return a < 1 || b < 1 || c < 1 || a > nx - 2 || b > ny - 2 || c > nz - 2 ? -1 : a + nx * (c + nz * b);
    };
    const land = k => {
      // it comes down in the last free cell on its way, or the nearest free one above
      let i = ix(P.x[k], P.y[k], P.z[k]);
      for (let s = 0; s < 6 && i >= 0 && ST[mat[i]] !== AIR && ST[mat[i]] !== GAS && ST[mat[i]] !== FIRE; s++) i += L;
      if (i < 0 || i >= N) return;
      if (ST[mat[i]] === WALL) return;
      mat[i] = P.m[k];
      T[i] = P.T[k];
      life[i] = LIFE1[P.m[k]] ? LIFE0[P.m[k]] : 0;
      tone[i] = (R() * 256) | 0;
      wakeAt(i);
    };
    const stepFlying = () => {
      if (!P.n) return;
      const g = 0.05;
      for (let k = 0; k < P.n; k++) {
        P.vy[k] -= g;
        P.vx[k] *= 0.985;
        P.vz[k] *= 0.985;
        const sp = Math.max(Math.abs(P.vx[k]), Math.abs(P.vy[k]), Math.abs(P.vz[k])),
          sub = Math.max(1, Math.ceil(sp));
        let hit = false;
        for (let s = 0; s < sub; s++) {
          const x = P.x[k] + P.vx[k] / sub,
            y = P.y[k] + P.vy[k] / sub,
            z = P.z[k] + P.vz[k] / sub,
            j = ix(x, y, z);
          if (j < 0 || (ST[mat[j]] !== AIR && ST[mat[j]] !== GAS && ST[mat[j]] !== FIRE)) {
            hit = true;
            break;
          }
          P.x[k] = x;
          P.y[k] = y;
          P.z[k] = z;
        }
        if (hit || ++P.t[k] > 240) {
          land(k);
          const e = --P.n;
          for (const a of [P.x, P.y, P.z, P.vx, P.vy, P.vz, P.m, P.T, P.t]) a[k] = a[e];
          k--;
        }
      }
      P.dirty = true;
    };
    // what a blast does to a cell: what is loose is thrown, what is brittle breaks and is thrown, what is near the middle is gone
    const blastAt = (cx, cy, cz, r, power, heat, fire, keepSolids) => {
      const r2 = r * r;
      evs.push(
        at[0] + (cx - 1) * cell,
        at[1] + (cy - 1) * cell,
        at[2] + (cz - 1) * cell,
        r * cell,
        power,
        keepSolids ? 1 : 0
      );
      for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(ny - 2, Math.ceil(cy + r)); y++)
        for (let z = Math.max(1, Math.floor(cz - r)); z <= Math.min(nz - 2, Math.ceil(cz + r)); z++)
          for (let x = Math.max(1, Math.floor(cx - r)); x <= Math.min(nx - 2, Math.ceil(cx + r)); x++) {
            const dx = x + 0.5 - cx,
              dy = y + 0.5 - cy,
              dz = z + 0.5 - cz,
              d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > r2) continue;
            const i = x + nx * (z + nz * y),
              m = mat[i],
              s = ST[m],
              d = Math.sqrt(d2) || 0.01,
              f = 1 - d / r;
            if (heat) T[i] += heat * f;
            if (s === WALL) continue;
            if (s === AIR) {
              if (fire && f > 0.35 && R() < 0.6 && FIREID >= 0) (become(i, FIREID), (T[i] = 900));
              continue;
            }
            let k = m;
            if (s === SOLID) {
              // a push breaks only what is brittle; a blast breaks what will break, the harder the nearer the middle it must be.
              // Of what a blast breaks, a little more than half goes to dust and the rest is thrown, not so fast as what was loose
              if (BREAKS[m] < 0 || (keepSolids && !BRITTLE[m]) || R() > (f * 1.6) / HARD[m]) continue;
              k = BREAKS[m];
              if (!BRITTLE[m] && R() < 0.55) {
                if (DUSTID >= 0 && R() < 0.5) become(i, DUSTID);
                else {
                  mat[i] = AIR;
                  touched(i);
                }
                continue;
              }
            }
            if (s === GAS || s === FIRE) continue;
            const sp = power * (0.35 + f) * (0.7 + 0.6 * R()) * (s === SOLID ? 0.6 : 1);
            if (f > 0.8 && heat > 300 && s !== LIQUID) {
              mat[i] = AIR;
              touched(i);
              continue;
            }
            if (
              fling(x + 0.5, y + 0.5, z + 0.5, (dx / d) * sp, (dy / d) * sp + power * 0.25 * f, (dz / d) * sp, k, T[i])
            ) {
              mat[i] = AIR;
              life[i] = 0;
              wakeAt(i);
            }
          }
      wakeAt(Math.max(0, Math.min(N - 1, Math.floor(cx) + nx * (Math.floor(cz) + nz * Math.floor(cy)))));
    };

    // ---- one step
    let pending = [];
    const step = () => {
      sid = (sid + 1) & 0xffff || 1;
      changedN = 0;
      const flip = sid & 1;
      // sources: springs, spouts, drips
      for (const s of spec.sources) {
        if (steps % s.every) continue;
        const k = idOf(s.mat),
          c = [(s.at[0] - at[0]) / cell + 1, (s.at[1] - at[1]) / cell + 1, (s.at[2] - at[2]) / cell + 1],
          rr = s.r / cell;
        for (let q = 0; q < s.n; q++) {
          const a = R() * 6.283,
            u = Math.sqrt(R()) * rr,
            x = c[0] + Math.cos(a) * u,
            z = c[2] + Math.sin(a) * u,
            tt = s.temp === undefined ? TEMP[k] : s.temp;
          if (s.v)
            fling(x, c[1], z, s.v[0] / cell / spec.rate, s.v[1] / cell / spec.rate, s.v[2] / cell / spec.rate, k, tt);
          else {
            const i = ix(x, c[1], z);
            if (i >= 0 && ST[mat[i]] === AIR) {
              become(i, k);
              T[i] = tt;
              wakeAt(i);
            }
          }
        }
      }
      for (const h of heaters) {
        for (const i of h.cells) {
          T[i] += (h.temp - T[i]) * h.rate;
        }
        for (const c of h.chunks) if (awake[c] < 2) awake[c] = 2;
      }
      if (spec.open) {
        const y0 = (ny - 3) * L;
        for (let i = y0; i < (ny - 1) * L; i++) {
          const st = ST[mat[i]];
          if (st === GAS || st === FIRE) {
            mat[i] = AIR;
            touched(i);
          }
        }
      }
      for (const k of drains)
        for (const i of k.cells) {
          const st = ST[mat[i]];
          if (st === LIQUID || st === POWDER) {
            mat[i] = AIR;
            touched(i);
          }
        }
      // what moves, chunk by chunk from the bottom up
      for (let oi = 0; oi < NC; oi++) {
        const c = order[oi];
        if (!awake[c]) continue;
        const x0 = (c % cnx) * CS,
          z0 = (Math.floor(c / cnx) % cnz) * CS,
          y0 = Math.floor(c / (cnx * cnz)) * CS,
          x1 = Math.min(nx - 1, x0 + CS),
          y1 = Math.min(ny - 1, y0 + CS),
          z1 = Math.min(nz - 1, z0 + CS);
        for (let y = Math.max(1, y0); y < y1; y++)
          for (let zz = Math.max(1, z0); zz < z1; zz++) {
            const z = flip ? zz : z1 - 1 - zz + Math.max(1, z0);
            for (let xx = Math.max(1, x0); xx < x1; xx++) {
              const x = flip ? x1 - 1 - xx + Math.max(1, x0) : xx,
                i = x + nx * (z + nz * y),
                m = mat[i];
              if (m <= 1 || stamp[i] === sid) continue;
              const s = ST[m];
              if (s === POWDER) movePowder(i, m);
              else if (s === LIQUID) moveLiquid(i, m);
              else if (s === GAS) moveGas(i, m);
              else if (s === FIRE) moveFire(i, m);
            }
          }
      }
      // heat, then what heat and touch do to each thing
      for (let oi = 0; oi < NC; oi++) {
        const c = order[oi];
        if (!awake[c]) continue;
        const x0 = (c % cnx) * CS,
          z0 = (Math.floor(c / cnx) % cnz) * CS,
          y0 = Math.floor(c / (cnx * cnz)) * CS,
          x1 = Math.min(nx - 1, x0 + CS),
          y1 = Math.min(ny - 1, y0 + CS),
          z1 = Math.min(nz - 1, z0 + CS);
        let warm = false;
        for (let y = Math.max(1, y0); y < y1; y++)
          for (let z = Math.max(1, z0); z < z1; z++)
            for (let x = Math.max(1, x0); x < x1; x++) {
              const i = x + nx * (z + nz * y);
              let m = mat[i];
              const s = ST[m];
              let t = T[i];
              // heat goes between neighbours as well as the poorer of the two lets it; air that is neither hot nor cold
              // carries none (so a block of ice keeps in a cool room until something warm comes near it)
              // a liquid's surface takes heat only slowly from the air, gases and flames over it, so a fire on a pool or hot air
              // over it does not boil it away (lava poured into a pool still does, by touching it)
              const ci = COND[m],
                lq = s === LIQUID;
              let acc = 0;
              for (let k = 0; k < 6; k++) {
                const j = i + N6[k],
                  n = mat[j],
                  tj = T[j],
                  a = AIRY[n];
                if (a === 1 && tj < amb + 30 && tj > amb - 30) continue;
                const kk = COND[n];
                acc += (kk < ci ? kk : ci) * (tj - t) * (lq && a ? 0.1 : 1);
              }
              let dt = acc * 0.16;
              if (s === AIR || s === GAS) {
                dt += (amb - t) * 0.003;
                // hot air rises: it trades places with cooler air over it
                if (s === AIR && t > amb + 40 && mat[i + L] === AIR && T[i + L] < t - 10 && R() < 0.5) {
                  T[i] = T[i + L];
                  T[i + L] = t + dt;
                  t = T[i];
                  dt = 0;
                }
              }
              if (HOLD[m] && t < TEMP[m]) dt = TEMP[m] - t;
              t += dt;
              T[i] = t;
              if (dt > 0.8 || dt < -0.8) warm = true;
              if (s <= WALL) continue;
              // a thing that burns, smokes or thins away comes to its end
              if (LIFE1[m]) {
                if (life[i] > 0) life[i]--;
                else {
                  const leave = s === FIRE && R() < SMOKE[m] ? SMOKEID : LEAVES[m];
                  become(i, leave < 0 ? AIR : leave);
                  // what a fire leaves is warm, not as hot as the fire was (hot smoke lying on a pool would boil it away)
                  if (ST[mat[i]] === AIR) T[i] = Math.min(T[i], 200);
                  else if (HOLD[m] && ST[mat[i]] === GAS) T[i] = Math.min(T[i], amb + 60);
                  continue;
                }
              }
              if (FLAMES[m] && R() < FLAMES[m] && ST[mat[i + L]] === AIR && FIREID >= 0) {
                become(i + L, FIREID);
                T[i + L] = 900;
              }
              // what heat makes of it
              if (MELT[m] >= 0 && t >= MELTAT[m] && R() < 0.25) {
                become(i, MELT[m]);
                T[i] = MELTAT[m] + 4;
                continue;
              }
              if (FRZ[m] >= 0 && t <= FRZB[m] && R() < 0.25) {
                become(i, FRZ[m]);
                continue;
              }
              if (BOIL[m] >= 0 && t >= BOILAT[m] && R() < 0.25) {
                become(i, BOIL[m]);
                T[i] = BOILAT[m] + 6;
                continue;
              }
              if (CND[m] >= 0 && t <= CNDB[m] && R() < CNDC[m]) {
                become(i, CND[m]);
                continue;
              }
              if (IGN[m] !== -1 && t >= IGNAT[m] && R() < 0.4) {
                if (IGN[m] === -2) {
                  mat[i] = AIR;
                  touched(i);
                  pending.push([x + 0.5, y + 0.5, z + 0.5, BLAST[m * 2], BLAST[m * 2 + 1]]);
                } else {
                  become(i, IGN[m]);
                  T[i] = Math.max(T[i], TEMP[IGN[m]]);
                }
                continue;
              }
              // what touching does: one neighbour a step, chosen at random
              const j = i + N6[(R() * 6) | 0],
                n = mat[j];
              if (n > 1) {
                const r = RX[m * NM + n];
                if (r >= 0 && R() < RC[r >> 1]) {
                  const a = r & 1 ? RB[r >> 1] : RA[r >> 1],
                    b = r & 1 ? RA[r >> 1] : RB[r >> 1];
                  if (a >= 0) become(i, a);
                  if (b >= 0) become(j, b);
                  continue;
                }
                if (EATS[m] && ACID[n] && ST[n] !== WALL && R() < EATS[m] * ACID[n] * 4) {
                  become(j, R() < FUMES[m] && FUMESID >= 0 ? FUMESID : AIR);
                  if (R() < 0.3) become(i, R() < 0.4 && FUMESID >= 0 ? FUMESID : AIR);
                  continue;
                }
              }
            }
        if (warm && chStamp[c] !== steps + 1) {
          chStamp[c] = steps + 1;
          changedList[changedN++] = c;
        }
      }
      for (const b of pending) blastAt(b[0], b[1], b[2], b[3], b[4], 700, true, false);
      pending = [];
      stepFlying();
      for (let oi = 0; oi < NC; oi++) if (awake[order[oi]]) awake[order[oi]]--;
      for (let k = 0; k < changedN; k++) wakeAround(changedList[k]);
      steps++;
    };

    const region = (p, rw) => {
      const c = [(p[0] - at[0]) / cell + 1, (p[1] - at[1]) / cell + 1, (p[2] - at[2]) / cell + 1],
        r = rw / cell,
        cells = [],
        chunks = new Set();
      for (let y = Math.max(1, Math.floor(c[1] - r)); y <= Math.min(ny - 2, Math.ceil(c[1] + r)); y++)
        for (let z = Math.max(1, Math.floor(c[2] - r)); z <= Math.min(nz - 2, Math.ceil(c[2] + r)); z++)
          for (let x = Math.max(1, Math.floor(c[0] - r)); x <= Math.min(nx - 2, Math.ceil(c[0] + r)); x++)
            if ((x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2 + (z + 0.5 - c[2]) ** 2 < r * r) {
              const i = x + nx * (z + nz * y);
              cells.push(i);
              chunks.add(chunkOf[i]);
            }
      return { cells, chunks: [...chunks] };
    };
    const drains = (spec.sinks || []).map(k => region(k.at, k.r));
    const heaters = spec.heaters.map(h => {
      const c = [(h.at[0] - at[0]) / cell + 1, (h.at[1] - at[1]) / cell + 1, (h.at[2] - at[2]) / cell + 1],
        r = h.r / cell,
        cells = [],
        chunks = new Set();
      for (let y = Math.max(1, Math.floor(c[1] - r)); y <= Math.min(ny - 2, Math.ceil(c[1] + r)); y++)
        for (let z = Math.max(1, Math.floor(c[2] - r)); z <= Math.min(nz - 2, Math.ceil(c[2] + r)); z++)
          for (let x = Math.max(1, Math.floor(c[0] - r)); x <= Math.min(nx - 2, Math.ceil(c[0] + r)); x++)
            if ((x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2 + (z + 0.5 - c[2]) ** 2 < r * r) {
              const i = x + nx * (z + nz * y);
              cells.push(i);
              chunks.add(chunkOf[i]);
            }
      return { cells, chunks: [...chunks], temp: h.temp, rate: h.rate };
    });

    // ---- the world's places, in cells
    const toCell = p => [(p[0] - at[0]) / cell + 1, (p[1] - at[1]) / cell + 1, (p[2] - at[2]) / cell + 1];
    const near = (p, r, f) => {
      const c = toCell(p),
        rc = r / cell;
      for (let y = Math.max(1, Math.floor(c[1] - rc)); y <= Math.min(ny - 2, Math.ceil(c[1] + rc)); y++)
        for (let z = Math.max(1, Math.floor(c[2] - rc)); z <= Math.min(nz - 2, Math.ceil(c[2] + rc)); z++)
          for (let x = Math.max(1, Math.floor(c[0] - rc)); x <= Math.min(nx - 2, Math.ceil(c[0] + rc)); x++) {
            const d = Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1], z + 0.5 - c[2]) / rc;
            if (d < 1) f(x + nx * (z + nz * y), d, x, y, z);
          }
    };
    const sim = {
      spec,
      names,
      P,
      get steps() {
        return steps;
      },
      step,
      idOf,
      at(p) {
        const c = toCell(p),
          i = ix(c[0], c[1], c[2]);
        return i < 0 ? null : { name: names[mat[i]], temp: T[i] };
      },
      count(name) {
        const k = idOf(name);
        let c = 0;
        for (let i = 0; i < N; i++) if (mat[i] === k) c++;
        return c;
      },
      heat(p, r, dT) {
        near(p, r, (i, d) => {
          T[i] += dT * (1 - d * 0.6);
          wakeAt(i);
        });
      },
      pour(p, name, n, r) {
        const k = idOf(name);
        if (k < 0) return;
        const c = toCell(p),
          rc = Math.max(1, (r || 0.25) / cell);
        for (let q = 0; q < n; q++) {
          const a = R() * 6.283,
            u = Math.sqrt(R()) * rc;
          fling(c[0] + Math.cos(a) * u, c[1] + R() * rc, c[2] + Math.sin(a) * u, 0, -0.2, 0, k, TEMP[k]);
        }
      },
      dig(p, r) {
        near(p, r, i => {
          if (mat[i] > 1) {
            mat[i] = AIR;
            wakeAt(i);
          }
        });
      },
      explode(p, r, power, o) {
        o = o || {};
        const c = toCell(p);
        blastAt(c[0], c[1], c[2], r / cell, power, o.heat === undefined ? 600 : o.heat, o.fire !== false, !!o.keep);
      },
      push(p, r, power) {
        const c = toCell(p);
        blastAt(c[0], c[1], c[2], r / cell, power, 0, false, true);
      },
      // a blast of breath that draws in what is loose round a place, to fling it back out after
      pull(p, r, power) {
        const c = toCell(p);
        near(p, r, (i, d, x, y, z) => {
          const s = ST[mat[i]];
          if (s !== POWDER && s !== LIQUID) return;
          const dx = c[0] - x - 0.5,
            dy = c[1] - y - 0.5,
            dz = c[2] - z - 0.5,
            l = Math.hypot(dx, dy, dz) || 1,
            sp = power * (0.5 + 0.5 * d);
          if (fling(x + 0.5, y + 0.5, z + 0.5, (dx / l) * sp, (dy / l) * sp + 0.3, (dz / l) * sp, mat[i], T[i])) {
            mat[i] = AIR;
            wakeAt(i);
          }
        });
      },
      // lightning goes through water as far as it reaches, warming it, and sets alight what burns where it touches
      shock(p, reach) {
        const c = toCell(p);
        let start = -1;
        near(p, 0.6, i => {
          if (start < 0 && ST[mat[i]] === LIQUID) start = i;
        });
        if (start < 0) return sim.heat(p, 0.3, 400);
        const seen = new Set([start]),
          q = [start],
          lim = reach || 4000;
        while (q.length && seen.size < lim) {
          const i = q.shift();
          T[i] += 18;
          wakeAt(i);
          for (const d of N6) {
            const j = i + d;
            if (seen.has(j)) continue;
            const s = ST[mat[j]];
            if (s === LIQUID) {
              seen.add(j);
              q.push(j);
            } else if (IGN[mat[j]] !== -1) T[j] += 300;
          }
        }
        void c;
      },
      cast(spell, p, o) {
        o = o || {};
        switch (spell) {
          case 'flame':
            near(p, 0.4, (i, d) => {
              T[i] += 520 * (1 - d * 0.5);
              if (ST[mat[i]] === AIR && d < 0.8 && FIREID >= 0) (become(i, FIREID), (T[i] = 900));
              wakeAt(i);
            });
            break;
          case 'frost':
            near(p, 0.9, (i, d) => {
              T[i] -= 120 * (1 - d * 0.5);
              const s = ST[mat[i]];
              if (s === FIRE) become(i, AIR);
              else if (s === AIR && d < 0.6 && R() < 0.05 && SNOWID >= 0) (become(i, SNOWID), (T[i] = -10));
              wakeAt(i);
            });
            break;
          case 'nova':
            sim.push(p, o.r || 1.5, o.power || 1.6);
            break;
          case 'bolt':
            sim.explode(p, 0.35, 1.1, { heat: 150, fire: false });
            break;
          case 'chain':
            sim.shock(p);
            break;
          case 'fist':
            sim.explode([p[0], p[1] + 0.2, p[2]], o.r || 0.9, 0.9, { heat: 0, fire: false });
            break;
          case 'gulp':
            sim.pull(p, o.r || 1.8, 0.9);
            break;
          case 'venom':
          case 'acid':
            sim.pour([p[0], p[1] + 0.3, p[2]], 'acid', 60, 0.2);
            break;
          case 'dig':
            sim.dig(p, 0.4);
            break;
          case 'ice':
            near(p, 0.35, i => {
              if (ST[mat[i]] === AIR && ICEID >= 0) (become(i, ICEID), (T[i] = -15));
              wakeAt(i);
            });
            break;
          default:
            if (idOf(spell) > 1) sim.pour([p[0], p[1] + 0.35, p[2]], spell, o.n || 90, o.r || 0.22);
        }
      },
      // the cells of the scene's own solids handed over to the grid since last asked (their indices), and the blasts
      uncovered() {
        const u = Int32Array.from(unc);
        unc = [];
        return u;
      },
      blasts() {
        const e = Float32Array.from(evs);
        evs = [];
        return e;
      },
      stats() {
        let a = 0;
        for (let c = 0; c < NC; c++) if (awake[c]) a++;
        return { steps, awake: a, chunks: NC, flying: P.n };
      }
    };

    /* ---- drawing: each chunk keeps its own few runs of slots in the block, and only a chunk that changed is drawn again */
    const sun = spec.sun || [-0.5, 0.7, -0.5],
      SX = sun[0] < 0 ? -1 : 1,
      SZ = sun[2] < 0 ? -nx : nx,
      COLS = names.map(nm => (spec.cols[nm] ? spec.cols[nm] : null)),
      GROUP = 32;
    let block = null,
      M = 0,
      free = [],
      groups = [],
      rowsHit = null,
      flyStart = 0;
    const see = n => ST[n] === AIR || ST[n] === GAS || ST[n] === FIRE;
    const record = (o, x, y, z, rgb, a, s, flags) => {
      block[o] = x;
      block[o + 1] = y;
      block[o + 2] = z;
      block[o + 3] = a;
      block[o + 4] = s * s;
      block[o + 5] = 0;
      block[o + 6] = 0;
      block[o + 7] = rgb;
      block[o + 8] = s * s;
      block[o + 9] = 0;
      block[o + 10] = s * s;
      block[o + 11] = flags;
      block[o + 12] = block[o + 13] = block[o + 14] = block[o + 15] = 0;
    };
    const colourOf = (i, m) => {
      const ramp = COLS[m];
      if (!ramp) return [0, 1, 0];
      const t0 = tone[i] / 255 - 0.5;
      let t = 0.45 + t0 * 0.26,
        em = 0;
      if (GLOW1[m]) {
        t = (T[i] - GLOW0[m]) / (GLOW1[m] - GLOW0[m]) + t0 * 0.25;
        em = 32;
      } else {
        if (see(mat[i + L])) t += 0.24;
        if (see(mat[i - L])) t -= 0.14;
        if (see(mat[i + SX])) t += 0.1;
        if (see(mat[i + SZ])) t += 0.08;
        if (ST[m] === LIQUID) {
          if (stamp[i] === sid || stamp[i] === ((sid - 1) & 0xffff)) t += 0.22;
          for (let k = 1; k <= 3; k++) if (mat[i + L * k] === m) t -= 0.08;
        }
      }
      const k = Math.max(0, Math.min(ramp.length - 1, Math.floor(t * ramp.length)));
      let rgb = ramp[k];
      // red hot: what is not its own light shows its heat
      if (!GLOW1[m] && T[i] > 520 && COLS[FIREID]) {
        const h = Math.min(1, (T[i] - 520) / 700),
          fr = COLS[FIREID];
        rgb = fr[Math.min(fr.length - 1, Math.floor(h * fr.length))];
        em = 32;
      }
      return [
        rgb,
        ST[m] === GAS
          ? ALPHA[m] * Math.min(1, life[i] / 60 + 0.25)
          : ST[m] === FIRE
            ? 0.95
            : ALPHA[m] < 1
              ? ALPHA[m]
              : 3,
        em
      ];
    };
    const drawChunk = c => {
      const x0 = (c % cnx) * CS,
        z0 = (Math.floor(c / cnx) % cnz) * CS,
        y0 = Math.floor(c / (cnx * cnz)) * CS,
        x1 = Math.min(nx - 1, x0 + CS),
        y1 = Math.min(ny - 1, y0 + CS),
        z1 = Math.min(nz - 1, z0 + CS),
        mine = groups[c] || (groups[c] = []);
      let used = 0;
      const slot = () => {
        const g = used >> 5;
        if (g >= mine.length) {
          if (!free.length) return -1;
          mine.push(free.pop());
        }
        return mine[g] * GROUP + (used++ & 31);
      };
      for (let y = Math.max(1, y0); y < y1; y++)
        for (let z = Math.max(1, z0); z < z1; z++)
          for (let x = Math.max(1, x0); x < x1; x++) {
            const i = x + nx * (z + nz * y),
              m = mat[i],
              s = ST[m];
            if (m <= 1 || (baked !== null && baked[i])) continue;
            if (
              s !== GAS &&
              s !== FIRE &&
              !see(mat[i - 1]) &&
              !see(mat[i + 1]) &&
              !see(mat[i - nx]) &&
              !see(mat[i + nx]) &&
              !see(mat[i - L]) &&
              !see(mat[i + L])
            )
              continue;
            const q = slot();
            if (q < 0) break;
            const [rgb, a, em] = colourOf(i, m),
              j = (tone[i] / 255 - 0.5) * 0.18,
              size = s === GAS ? 0.9 : s === FIRE ? 0.66 : 0.6;
            record(
              q * 16,
              at[0] + (x - 0.5 + j) * cell,
              at[1] + (y - 0.5 + j * 0.5) * cell,
              at[2] + (z - 0.5 - j) * cell,
              rgb,
              a,
              cell * size,
              em + (s === GAS || s === FIRE ? 16 : 0)
            );
            rowsHit[q >> 9] = 1;
          }
      // what is left of its slots is put away; whole runs it no longer needs go back
      const keep = Math.ceil(used / GROUP);
      for (let q = used; q < mine.length * GROUP; q++) {
        const s = mine[q >> 5] * GROUP + (q & 31);
        if (block[s * 16 + 3] !== 0) {
          block[s * 16 + 3] = 0;
          block[s * 16 + 1] = -100;
          rowsHit[s >> 9] = 1;
        }
      }
      while (mine.length > keep) free.push(mine.pop());
    };
    const drawFlying = () => {
      const PM = M - flyStart;
      for (let k = 0; k < PM; k++) {
        const o = (flyStart + k) * 16;
        if (k < P.n) {
          const m = P.m[k],
            ramp = COLS[m] || [0],
            rgb = GLOW1[m] ? ramp[ramp.length - 1] : ramp[Math.min(ramp.length - 1, 1 + (k % 2))];
          record(
            o,
            at[0] + (P.x[k] - 1) * cell,
            at[1] + (P.y[k] - 1) * cell,
            at[2] + (P.z[k] - 1) * cell,
            rgb,
            ST[m] === GAS ? 0.5 : 3,
            cell * 0.55,
            GLOW1[m] ? 32 : 0
          );
        } else if (block[o + 3] !== 0) {
          block[o + 3] = 0;
          block[o + 1] = -100;
        } else continue;
        rowsHit[(flyStart + k) >> 9] = 1;
      }
    };
    /* draw into a block of slots (16 numbers each): what is in the grid in all but the last few hundred, what is flying in those.
       Returns the rows of 512 slots that were written (a Uint8Array, 1 for each written) */
    sim.draw = (blk, slots) => {
      if (block !== blk) {
        block = blk;
        M = slots;
        flyStart = Math.max(0, M - Math.min(PMAX, Math.max(512, Math.floor(M * 0.06))));
        free = [];
        for (let g = Math.floor(flyStart / GROUP) - 1; g >= 0; g--) free.push(g);
        groups = [];
        rowsHit = new Uint8Array(Math.ceil(M / 512));
        for (let s = 0; s < M; s++) {
          block[s * 16 + 3] = 0;
          block[s * 16 + 1] = -100;
        }
        redraw.fill(1);
        rowsHit.fill(1);
      }
      for (let c = 0; c < NC; c++)
        if (redraw[c]) {
          redraw[c] = 0;
          drawChunk(c);
        }
      if (P.dirty) {
        P.dirty = false;
        drawFlying();
      }
      return rowsHit;
    };
    return sim;
  };

  /* ---- the world's side: a block of splats, and a system on the stage that keeps them up with the grid ---- */
  const attach = (W, o) => {
    o = o || {};
    const spec = W.sandbox;
    if (!spec) return W;
    if (W.anim) throw new Error('sandbox: attach before anything else sets the world moving');
    // its block starts at a row of its own, and holds a splat for every cell that may be seen at once, and some for what flies
    const N0 = W.count,
      cells = spec.n[0] * spec.n[2] * 2 + spec.n[0] * spec.n[1] + spec.n[1] * spec.n[2],
      slots = Math.ceil(Math.min(o.slots || Math.max(24000, cells * 1.6), 400000) / 512) * 512,
      start = Math.ceil(W.count / 512) * 512,
      D = new Float32Array((start + slots) * 16);
    D.set(W.data);
    for (let s = W.count; s < start + slots; s++) {
      D[s * 16 + 3] = 0;
      D[s * 16 + 1] = -100;
    }
    W.data = D;
    W.count = start + slots;
    const st = W.anim || K.stage(W);
    W.anim = st;
    const block = D.subarray(start * 16, (start + slots) * 16),
      row0 = start / 512,
      rate = spec.rate || 30;
    // (on a page that has offered a worker for it, the grid is stepped there; anywhere else, here)
    const mkWorker =
      o.worker ||
      (typeof Worker !== 'undefined' && typeof globalThis !== 'undefined' && globalThis.INK_SANDBOX_WORKER) ||
      null;
    let sim = null,
      worker = null,
      busy = false,
      origin = null,
      queue = [];
    // the scene's splats over each of its solids that the grid knows (each goes with the nearest such cell within a cell and a bit),
    // found the first time one is handed over; and what has been put away, to bring back if the grid starts again
    let ownAt = null,
      ownList = null,
      hidden = [];
    const owners = () => {
      const [nx, ny, nz] = spec.n,
        cell = spec.cell,
        at = spec.at,
        bk = spec.baked,
        NC = nx * ny * nz,
        own = new Int32Array(N0).fill(-1);
      ownAt = new Int32Array(NC + 1);
      for (let i = 0; i < N0; i++) {
        if (D[i * 16 + 3] === 0) continue;
        const fx = (D[i * 16] - at[0]) / cell + 1,
          fy = (D[i * 16 + 1] - at[1]) / cell + 1,
          fz = (D[i * 16 + 2] - at[2]) / cell + 1,
          x = Math.floor(fx),
          y = Math.floor(fy),
          z = Math.floor(fz);
        if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
        let best = -1,
          bd = 1.3 * 1.3;
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++) {
              const X = x + dx,
                Y = y + dy,
                Z = z + dz;
              if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
              const c = X + nx * (Z + nz * Y);
              if (!bk[c]) continue;
              const d = (X + 0.5 - fx) ** 2 + (Y + 0.5 - fy) ** 2 + (Z + 0.5 - fz) ** 2;
              if (d < bd) ((bd = d), (best = c));
            }
        if (best >= 0) ((own[i] = best), ownAt[best + 1]++);
      }
      for (let c = 0; c < NC; c++) ownAt[c + 1] += ownAt[c];
      ownList = new Int32Array(ownAt[NC]);
      const fillAt = ownAt.slice(0, NC);
      for (let i = 0; i < N0; i++) if (own[i] >= 0) ownList[fillAt[own[i]]++] = i;
    };
    const handOver = unc => {
      if (!unc || !unc.length || !spec.baked) return;
      if (!ownAt) owners();
      for (let k = 0; k < unc.length; k++) {
        const c = unc[k];
        for (let q = ownAt[c]; q < ownAt[c + 1]; q++) {
          const i = ownList[q],
            a = D[i * 16 + 3];
          if (a === 0) continue;
          hidden.push(i, a);
          D[i * 16 + 3] = 0;
          st.base[i * 16 + 3] = 0;
          st.rows[i >> 9] = 1;
        }
      }
    };
    const listeners = [];
    const told = b => {
      if (!b || !b.length || !listeners.length) return;
      for (let k = 0; k < b.length; k += 6) {
        const e = { p: [b[k], b[k + 1], b[k + 2]], r: b[k + 3], power: b[k + 4], push: !!b[k + 5] };
        for (const f of listeners) f(e);
      }
    };
    const sys = {
      sandbox: true,
      start,
      slots,
      get sim() {
        return sim;
      },
      tool: spec.tool,
      update(dt, t) {
        // its own clock starts when it is first stepped, and again each time it is set going after being put away
        if (origin === null) origin = t;
        t -= origin;
        if (mkWorker && !worker) {
          worker = mkWorker();
          worker.onmessage = e => {
            const m = e.data;
            if (m.rows) {
              for (let k = 0; k < m.rows.length; k++) {
                block.set(m.data.subarray(k * 8192, (k + 1) * 8192), m.rows[k] * 8192);
                st.rows[row0 + m.rows[k]] = 1;
              }
              sys.steps = m.steps;
              sys.stats = m.stats;
              handOver(m.unc);
              told(m.blasts);
            }
            busy = false;
          };
          worker.postMessage({ sandbox: 'init', spec, slots });
        }
        if (worker) {
          for (const q of queue) worker.postMessage(q);
          queue = [];
          if (!busy) {
            busy = true;
            worker.postMessage({ sandbox: 'run', t });
          }
          return;
        }
        if (!sim) sim = K.sandbox(spec);
        const want = Math.floor(t * rate),
          most = o.budget === undefined ? (typeof window === 'undefined' ? Infinity : 3) : o.budget;
        let n = 0;
        while (sim.steps < want && n < most) {
          sim.step();
          n++;
        }
        if (sim.steps < want - 30) {
          // (too far behind: let the clock go and stay with what can be done)
        }
        const hit = sim.draw(block, slots);
        for (let r = 0; r < hit.length; r++)
          if (hit[r]) {
            hit[r] = 0;
            st.rows[row0 + r] = 1;
          }
        handOver(sim.uncovered());
        told(sim.blasts());
      },
      // f({ p, r, power, push }) for every blast (and push) in the grid: for a shake, a sound, or what a game does to who is near
      onBlast(f) {
        listeners.push(f);
        return sys;
      },
      poke(hit) {
        if (!hit || !hit.p) return;
        const spell = st.tool || sys.tool || 'flame';
        sys.cast(spell, hit.p);
      },
      cast(spell, p, co) {
        if (worker) queue.push({ sandbox: 'cast', spell, p, o: co || {} });
        else {
          if (!sim) sim = K.sandbox(spec);
          sim.cast(spell, p, co);
        }
      },
      dispose() {
        if (worker) worker.terminate();
        worker = null;
        sim = null;
        for (let k = 0; k < hidden.length; k += 2) {
          const i = hidden[k];
          D[i * 16 + 3] = st.base[i * 16 + 3] = hidden[k + 1];
          st.rows[i >> 9] = 1;
        }
        hidden = [];
        busy = false;
        origin = null;
        queue = [];
      }
    };
    st.add(sys);
    st.sandbox = sys;
    st.tool = spec.tool;
    const was = st.dispose;
    st.dispose = () => {
      sys.dispose();
      if (was) was();
    };
    return W;
  };

  /* the worker's side: the simulation lives here and keeps stepping toward whatever time the page last asked for, a few milliseconds at
     a go, between messages; each time the page asks, it sends back the rows it has drawn since */
  const serve = port => {
    let sim = null,
      block = null,
      slots = 0,
      rate = 30,
      target = 0,
      looping = false;
    const loop = () => {
      looping = false;
      if (!sim) return;
      const t0 = Date.now();
      while (sim.steps < target && Date.now() - t0 < 12) sim.step();
      if (sim.steps < target) {
        looping = true;
        setTimeout(loop, 0);
      }
    };
    return m => {
      if (m.sandbox === 'init') {
        sim = K.sandbox(m.spec);
        slots = m.slots;
        rate = m.spec.rate || 30;
        block = new Float32Array(slots * 16);
        target = 0;
        return true;
      }
      if (!sim) return false;
      if (m.sandbox === 'cast') {
        sim.cast(m.spell, m.p, m.o);
        return true;
      }
      if (m.sandbox === 'run') {
        target = Math.floor(m.t * rate);
        if (!looping && sim.steps < target) sim.step();
        const hit = sim.draw(block, slots),
          rows = [];
        for (let r = 0; r < hit.length; r++)
          if (hit[r]) {
            hit[r] = 0;
            rows.push(r);
          }
        const data = new Float32Array(rows.length * 8192),
          unc = sim.uncovered(),
          blasts = sim.blasts();
        rows.forEach((r, k) => data.set(block.subarray(r * 8192, (r + 1) * 8192), k * 8192));
        port.postMessage({ rows, data, steps: sim.steps, stats: sim.stats(), unc, blasts }, [
          data.buffer,
          unc.buffer,
          blasts.buffer
        ]);
        if (!looping && sim.steps < target) {
          looping = true;
          setTimeout(loop, 0);
        }
        return true;
      }
      return false;
    };
  };

  K.sandbox = sandbox;
  K.sandbox.materials = MAT;
  K.sandbox.reactions = REACT;
  K.sandbox.grid = grid;
  K.sandbox.attach = attach;
  K.sandbox.serve = serve;
})(KIT);
