/* km-ramp: ramps that turn as they darken.
   A ramp is a list of palette colours, dark to light, that a material is shaded on. The dull way to make one is the same hue, darker and
   lighter. The better way lets the hue travel: shadows lean cool, lights lean warm (or the other way under a cold light), so a lit thing
   has colour in its shade. This does not invent colours: it picks from the palette a diorama already has, and says how far it had to reach.
     K.ramp.make(pal, { hue: 110, n: 5 })            -> { ramp: [3, 4, 5, 9, 12], miss: [...], travel }
        hue (degrees) or base (0xrrggbb)   the colour the ramp is about
        n (5)  shift (50: how many degrees the hue travels from the darkest to the lightest)  cool (235) warm (48): the hues it leans to
        sat (0.5)  dark (0.12)  light (0.88): how light the ends are     from: [indices] only these palette colours may be used
     K.ramp.check(pal, ramp)                          -> { travel, sat, says }   (says: what kind of ramp this is, in words)
   Nothing here is used unless a diorama calls it. */
(function (K) {
  const hsl = h => {
    const r = ((h >> 16) & 255) / 255,
      g = ((h >> 8) & 255) / 255,
      b = (h & 255) / 255,
      mx = Math.max(r, g, b),
      mn = Math.min(r, g, b),
      l = (mx + mn) / 2,
      d = mx - mn;
    if (d < 1e-6) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1)),
      hh = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hh * 60, s, l];
  };
  const rgb = (h, s, l) => {
    const c = (1 - Math.abs(2 * l - 1)) * s,
      hp = (((h % 360) + 360) % 360) / 60,
      x = c * (1 - Math.abs((hp % 2) - 1)),
      m = l - c / 2,
      q =
        hp < 1
          ? [c, x, 0]
          : hp < 2
            ? [x, c, 0]
            : hp < 3
              ? [0, c, x]
              : hp < 4
                ? [0, x, c]
                : hp < 5
                  ? [x, 0, c]
                  : [c, 0, x];
    return [q[0] + m, q[1] + m, q[2] + m];
  };
  const lum = h => (0.299 * ((h >> 16) & 255) + 0.587 * ((h >> 8) & 255) + 0.114 * (h & 255)) / 255;
  const arc = (a, b) => ((((b - a) % 360) + 540) % 360) - 180; // the short way round from a to b, in degrees
  K.ramp = {
    hsl,
    make(pal, o) {
      o = o || {};
      const n = o.n || 5,
        base = o.base !== undefined ? hsl(o.base) : [o.hue || 0, o.sat === undefined ? 0.5 : o.sat, 0.5],
        sat = o.sat === undefined ? Math.max(0.25, base[1]) : o.sat,
        shift = o.shift === undefined ? 50 : o.shift,
        cool = o.cool === undefined ? 235 : o.cool,
        warm = o.warm === undefined ? 48 : o.warm,
        dark = o.dark === undefined ? 0.12 : o.dark,
        light = o.light === undefined ? 0.88 : o.light,
        allowed = o.from || pal.map((_, i) => i).slice(1),
        used = new Set(),
        ramp = [],
        miss = [];
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1),
          // toward the cool hue in the dark half, toward the warm one in the light half, never further than half the shift
          to = t < 0.5 ? cool : warm,
          lean = Math.sign(arc(base[0], to)) * Math.min(Math.abs(arc(base[0], to)), (shift / 2) * Math.abs(2 * t - 1)),
          c = rgb(base[0] + lean, sat * (1.15 - 0.45 * t), dark + (light - dark) * Math.pow(t, 0.9));
        let best = -1,
          bd = 1e9;
        for (const j of allowed) {
          if (used.has(j)) continue;
          const h = pal[j],
            dr = ((h >> 16) & 255) / 255 - c[0],
            dg = ((h >> 8) & 255) / 255 - c[1],
            db = (h & 255) / 255 - c[2],
            grey = hsl(h)[1] < 0.12 && sat > 0.25, // a grey is not taken for a colour unless there is nothing else near
            d = (dr * dr * 0.3 + dg * dg * 0.55 + db * db * 0.15) * (grey ? 4 : 1);
          if (d < bd) {
            bd = d;
            best = j;
          }
        }
        if (best < 0) break;
        used.add(best);
        ramp.push(best);
        miss.push(Math.sqrt(bd));
      }
      // each step took the nearest colour not yet taken; they are then put in order, dark to light
      const order = ramp.map((c, i) => i).sort((a, b) => lum(pal[ramp[a]]) - lum(pal[ramp[b]])),
        r2 = order.map(i => ramp[i]),
        m2 = order.map(i => miss[i]);
      ramp.length = 0;
      miss.length = 0;
      for (let i = 0; i < r2.length; i++) {
        ramp.push(r2[i]);
        miss.push(m2[i]);
      }
      return Object.assign({ ramp, miss }, K.ramp.check(pal, ramp));
    },
    check(pal, ramp) {
      const cs = ramp.map(i => hsl(pal[i])),
        col = cs.filter(c => c[1] > 0.1 && c[2] > 0.06 && c[2] < 0.94);
      if (col.length < 2) return { travel: 0, sat: 0, says: 'greys' };
      const a = col[0],
        b = col[col.length - 1],
        travel = arc(a[0], b[0]),
        sat = col.reduce((s, c) => s + c[1], 0) / col.length,
        coolA = Math.abs(arc(a[0], 235)),
        coolB = Math.abs(arc(b[0], 235));
      let rising = true;
      for (let i = 1; i < ramp.length; i++) if (lum(pal[ramp[i]]) < lum(pal[ramp[i - 1]]) - 0.01) rising = false;
      const says = !rising
        ? 'not dark to light'
        : Math.abs(travel) < 12
          ? 'one hue, darker and lighter'
          : 'turns ' +
            Math.round(Math.abs(travel)) +
            ' degrees, ' +
            (coolA < coolB ? 'cool shadows to warm lights' : 'warm shadows to cool lights');
      return { travel, sat, says };
    }
  };
})(KIT);
