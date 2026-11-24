/* Branch and span recipes produce reusable spatial geometry and a flat swatch. */
(function (K) {
  const P = K.procedural, G = P.generator;
  const { integer, range, vector, dimensions, clock, color, draw, line, ellipse, projection } = P.generatorSupport;
  const forms = {
    pine: { split: 2, spread: .85, taper: .64, leaf: '#597e71', crown: .14 },
    broadleaf: { split: 3, spread: .63, taper: .66, leaf: '#75a37d', crown: .26 },
    bare: { split: 2, spread: .52, taper: .65, leaf: null, crown: 0 }
  };

  function tree({ species = 'pine', seed = 0, root = [0, 0, 0], levels = 4, trunk = 1.05, radius = .075,
    bark = '#63504f', foliage, ...options } = {}) {
    const size = dimensions(options), { scale, pixel } = projection(size, options);
    clock(0, seed);
    if (!Object.hasOwn(forms, species) || !vector(root, 3) || !integer(levels, 1, 6) ||
        !range(trunk, .001, 100) || !range(radius, .0001, 10))
      throw new RangeError('Invalid tree species, origin, levels or dimensions');
    const { split, spread, taper, leaf, crown } = forms[species];
    foliage ??= leaf;
    color(bark);
    if (foliage !== null) color(foliage);
    const random = K.grow.dice(P.data.hash('tree:' + species, seed)), tokens = [];
    const symbol = (symbol, ...args) => tokens.push({ symbol, args });
    function branch(depth, length, base) {
      symbol('!', base);
      symbol('F', length, base * .7);
      if (depth + 1 === levels) {
        symbol('L');
        return;
      }
      for (let i = 0; i < split; i++) {
        symbol('[');
        symbol('+', (i - (split - 1) / 2) * spread * 2 + (random() - .5) * .65);
        symbol('&', (random() - .5) * .66);
        branch(depth + 1, length * taper * (.84 + .30 * random()), base * (.48 + .07 * random()));
        symbol(']');
      }
      if (species === 'pine' && depth === 0) {
        symbol('F', length * .41, base * .49);
        branch(depth + 1, length * taper * .7, base * .46);
      }
    }
    branch(0, trunk, radius);
    const { limbs: branches, marks } = P.growth.turtle(tokens, { origin: root, forward: [0, 1, 0], up: [0, 0, 1], radius });
    const leaves = foliage === null ? [] : marks.map(mark => mark.p);
    const commands = branches.map(({ pts, r0, r1 }) => line(pixel(pts[0]), pixel(pts[1]), bark, Math.max(1, (r0 + r1) * scale)));
    for (const p of leaves) {
      const [x, y] = pixel(p), r = crown * scale * trunk * (.5 + random() * .46);
      if (r > 0) commands.push(ellipse(x, y, r, r * .72, foliage));
    }
    return { value: draw(size, commands), branches, leaves };
  }

  function cable(start, end, { sag = .4, gravity, segments = 48, stroke = '#405363', weight = 1, ...options } = {}) {
    const size = dimensions(options), { pixel } = projection(size, options);
    if (!integer(segments, 2, 1024) || !range(weight, .1, 128)) throw new RangeError('Invalid cable segments or stroke');
    color(stroke);
    const span = P.spans.catenary(start, end, { sag, gravity });
    const path = Array.from({ length: segments + 1 }, (_, i) => span.sample(i / segments).point);
    return { value: draw(size, [{ type: 'path', color: stroke, width: weight, points: path.map(pixel) }]), path, length: span.length };
  }

  Object.assign(G, { tree, cable });
})(KIT);
