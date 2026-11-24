/* Seekable precipitation and sparks, plus Ink's native atmospheric emitters. */
(function (K) {
  const P = K.procedural, G = P.generator;
  const { integer, range, vector, unit, wrap, clock, raster, dimensions, draw, line, ellipse, color, alpha,
    projection } = P.generatorSupport;
  const turn = Math.PI * 2;

  function rain({ preset = 'rain', time = 0, seed = 0, count = 120, speed = preset === 'snow' ? 16 : 78,
    wind = preset === 'snow' ? 5 : 24, length = preset === 'snow' ? 1.5 : 5,
    fill = preset === 'snow' ? '#d0e6f0' : '#8bb7ce', opacity = .65, mask, maskOptions, ...options } = {}) {
    const size = dimensions(options), { width, height } = size;
    clock(time, seed);
    if (!['rain', 'snow'].includes(preset) || !integer(count, 0, 4096) || !range(speed, .01, 1e4) ||
        !range(wind, -1e4, 1e4) || !range(length, .25, 128) || !range(opacity, 0, 1))
      throw new RangeError('Invalid precipitation preset, count, speed or appearance');
    color(fill);
    const random = K.grow.dice(P.data.hash('precipitation:' + preset, seed)), particles = [], commands = [];
    const snow = preset === 'snow', horizontal = length * Math.abs(wind / speed);
    const xMargin = Math.min(width, horizontal) + length;
    for (let id = 0; id < count; id++) {
      const scale = .53 + .94 * random(), phase = random(), speedScale = .68 + .64 * random();
      const x = wrap(random() * (width + 2 * xMargin) + wind * time * speedScale, width + 2 * xMargin) - xMargin +
        (snow ? 2 * Math.sin(turn * phase + time * speedScale) : 0);
      const y = wrap(phase * (height + 4 * length) + speed * time * speedScale, height + 4 * length) - 2 * length;
      const weight = opacity * (.3 + .7 * random()), tint = alpha(fill, weight), run = length * scale;
      const p = [x, y], tail = snow ? p.slice() : [x - run * wind / speed, y - run];
      particles.push({ id, point: p, tail, size: run, opacity: weight });
      if (snow) commands.push(ellipse(x, y, run / 2, run / 2, tint));
      else commands.push(line(tail, p, tint, 1));
    }
    const image = draw(size, commands);
    const value = mask === undefined ? image : P.raster.stack({
      ...size, layers: [{ source: image, mask, maskOptions }]
    }).value;
    return { value, particles };
  }

  function sparks({ origin, time = 0, seed = 0, angle = -Math.PI / 2, spread = 1.2, speed = [17, 43], gravity = 24,
    start = 0, end = Infinity, rate = 26, lifetime = [.4, 1.2], tail = .075, size: radius = .8,
    core = '#fff1ab', edge = '#ef6839', ...options } = {}) {
    const size = dimensions(options);
    origin ??= [size.width * .5, size.height * .83];
    clock(time, seed);
    const interval = (value, lo, hi) => vector(value, 2) && range(value[0], lo, hi) && range(value[1], value[0], hi);
    if (!vector(origin, 2) || !Number.isFinite(angle) || !range(spread, 0, turn) || !interval(speed, 0, 1e4) ||
        !range(gravity, -1e4, 1e4) || !range(start, -1e9, 1e9) || (end !== Infinity && (!range(end, start, 1e9) || end <= start)) ||
        !range(rate, .01, 4096) || !interval(lifetime, .001, 24) || rate * lifetime[1] > 4000 ||
        !range(tail, 0, 24) || !range(radius, .25, 128)) throw new RangeError('Invalid spark clock, motion or appearance');
    color(core);
    color(edge);
    const commands = [], particles = [];
    for (const { serial, birth, age, phase, random } of K.splatEffects.births({ rate, start, end, lifetime, seed }, time)) {
      const heading = angle + (random() - .5) * spread, force = K.mix(...speed, random());
      const vx = Math.cos(heading) * force, vy = Math.sin(heading) * force;
      const at = t => [origin[0] + vx * t, origin[1] + vy * t + .5 * gravity * t * t];
      const point = at(age), previous = at(Math.max(0, age - tail)), weight = 1 - phase;
      const r = radius * (.65 + .6 * random()) * (.65 + .35 * weight);
      particles.push({ id: serial, birth, point, tail: previous, opacity: weight });
      if (tail && age > 0) commands.push(line(previous, point, alpha(edge, weight * .75), 1));
      commands.push(ellipse(point[0], point[1], r, r, alpha(phase < .55 ? core : edge, weight ** .55)));
    }
    return { value: draw(size, commands), particles };
  }

  function plume({ preset = 'smoke', id = preset, socket = { p: [0, 0, 0], dir: [0, 1, 0] },
    representation, motion = {}, life = {}, style = {}, time = 0, seed = 0, slices = 10, ...options } = {}) {
    const size = dimensions(options), { width, height } = size, { origin, scale, pixel } = projection(size, options);
    clock(time, seed);
    if (!integer(slices, 2, 64)) throw new RangeError('Plume preview needs 2 to 64 depth samples');
    const recipe = { sockets: { source: socket }, emitters: [
      { id, preset, socket: 'source', ...(representation !== undefined && { representation }), motion, life, style, seed }
    ] };
    const frame = K.atmosphere.emitters.compile(recipe).frame(time);
    if (frame.count) {
      const rows = frame.write(new Float32Array(frame.count * 16)), commands = [];
      for (let i = 0; i < rows.length; i += 16) {
        if (!rows[i + 3]) continue;
        const [x, y] = pixel(rows.subarray(i, i + 2)), rgb = rows[i + 7];
        const fill = '#' + [rgb & 255, rgb >> 8 & 255, rgb >> 16 & 255]
          .map(n => n.toString(16).padStart(2, '0')).join('');
        commands.push(ellipse(x, y, Math.sqrt(rows[i + 4]) * scale, Math.sqrt(rows[i + 8]) * scale, alpha(fill, rows[i + 3])));
      }
      return { value: draw(size, commands), recipe };
    }

    const data = new Uint8Array(width * height * 4), volume = frame.volumes[0];
    if (volume) {
      const { min, max, field, density, color: fill } = volume;
      const [left, top] = pixel([min[0], max[1]]), [right, bottom] = pixel([max[0], min[1]]);
      const x0 = Math.max(0, Math.floor(left)), x1 = Math.min(width, Math.ceil(right));
      const y0 = Math.max(0, Math.floor(top)), y1 = Math.min(height, Math.ceil(bottom));
      if (Math.max(0, x1 - x0) * Math.max(0, y1 - y0) * slices > 1e6)
        throw new RangeError('Plume preview exceeds one million density samples');
      const dz = (max[2] - min[2]) / slices, rgb = parseInt(fill.slice(1), 16);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const wx = (x + .5 - origin[0]) / scale, wy = (origin[1] - y - .5) / scale;
        let optical = 0;
        for (let z = 0; z < slices; z++) optical += field.sample(wx, wy, min[2] + (z + .5) * dz);
        const opacity = Math.round(-Math.expm1(-optical * dz * density) * 255);
        if (opacity) data.set([rgb >> 16, rgb >> 8 & 255, rgb & 255, opacity], (y * width + x) * 4);
      }
    }
    return { value: raster(width, height, data, 4), recipe };
  }

  Object.assign(G, { rain, sparks, plume });
})(KIT);
