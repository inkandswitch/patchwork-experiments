/* A swept, ground-following body over caller-supplied supports and solids. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V;
  function vector(point, size) {
    if (!Array.isArray(point) || point.length !== size) return false;
    for (const value of point) if (!Number.isFinite(value)) return false;
    return true;
  }
  const range = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;

  const materialTag = value => value === undefined || typeof value === 'string' && value.length > 0 && value.length <= 160;
  function footprint(radius) {
    const offsets=[[0,0]];
    for(let i=0;i<16;i++){
      const angle=Math.PI*i/8, x=Math.cos(angle)*radius, z=Math.sin(angle)*radius;
      offsets.push([x,z]);
      if(i%2===0)offsets.push([x*.5,z*.5]);
    }
    return offsets;
  }

  function create({ supports, clearance, transition, radius = .18, height = 1.64, stepUp = .34,
    stepDown = .48, minimumNormal = .63, stride = Math.min(.085, radius * .6), budget = 128, flatBottom = false } = {}) {
    if (typeof supports !== 'function' || typeof clearance !== 'function' ||
        transition!==undefined&&typeof transition!=='function' || !range(radius, .03, 4) ||
        !range(height, radius * 2 + .05, 12) || !range(stepUp, 0, height - radius * 2 - .025) ||
        !range(stepDown, 0, 16) || !range(minimumNormal, .01, 1) || !range(stride, .005, radius) ||
        !Number.isSafeInteger(budget) || budget < 1 || budget > 2048 || typeof flatBottom !== 'boolean')
      throw Error('Invalid traversal query or body');
    const lower = stepUp + radius + .005, upper = height - radius,
      sections = Math.max(1, Math.ceil((upper - lower) / (radius * .65)));
    const seats=flatBottom?footprint(radius):[[0,0]];

    function fits(p) {
      for (let i = 0; i <= sections; i++) {
        const y = p[1] + lower + (upper - lower) * i / sections;
        const distance = clearance([p[0], y, p[2]], radius);
        if (!Number.isFinite(distance) && distance !== Infinity) throw Error('Traversal clearance must be a finite signed distance or positive infinity');
        if (distance < radius - .0005) return false;
      }
      return true;
    }

    function seat(x, z, floor, ceiling, from) {
      let best = null;
      for(const [dx,dz] of seats){
        const list = supports(x+dx, z+dz, floor, ceiling);
        if (!Array.isArray(list) || list.length > 256) throw Error('Traversal supports must return a bounded array');
        for (const s of list) {
          if (!s || !Number.isFinite(s.y) || !vector(s.normal, 3) || V.len(s.normal) < 1e-8 ||
              (s.id !== undefined && typeof s.id !== 'string') || !materialTag(s.material)) throw Error('Traversal support needs height and normal');
          if (s.y < floor - .00001 || s.y > ceiling + .00001 || best && s.y <= best.foot[1] ||
              s.normal[1] / V.len(s.normal) + .00001 < minimumNormal) continue;
          const foot = [x, s.y, z];
          if (fits(foot) && (!transition || !from || transition(from,foot,s))) {
            best = { foot, support: s.id ?? null, normal: V.norm(s.normal) };
            if (s.material !== undefined) best.material = s.material;
            if (s.surface !== undefined) best.surface = s.surface;
          }
        }
      }
      return best;
    }

    function stand(point, { rise = stepUp, drop = stepDown } = {}) {
      if (!vector(point, 3) || !range(rise, 0, 1000) || !range(drop, 0, 1000))
        throw Error('Standing needs an XYZ point and bounded search height');
      return seat(point[0], point[2], point[1] - drop, point[1] + rise);
    }

    function move(foot, delta, { trace = false } = {}) {
      if (!vector(foot, 3) || !vector(delta, 2) || typeof trace !== 'boolean')
        throw Error('Traversal needs an XYZ foot, XZ displacement and optional trace flag');
      const steps = Math.ceil(Math.hypot(...delta) / stride), contacts = trace ? [] : null;
      if (steps > budget) throw Error('Traversal exceeds its step budget');
      const dx = delta[0] / steps, dz = delta[1] / steps;
      let current = { foot: foot.slice(), support: null }, blocked = false, progress = 0;
      for (let i = 0; i < steps; i++) {
        const [x, y, z] = current.foot, lo = y - stepDown, hi = y + stepUp;
        let next = seat(x + dx, z + dz, lo, hi,current.foot);
        if (!next) {
          blocked = true;
          if (dx && dz) {
            const firstX = Math.abs(dx) >= Math.abs(dz);
            next = firstX ? seat(x + dx, z, lo, hi,current.foot) || seat(x, z + dz, lo, hi,current.foot)
              : seat(x, z + dz, lo, hi,current.foot) || seat(x + dx, z, lo, hi,current.foot);
          }
        }
        if (!next) break;
        progress += Math.hypot(next.foot[0] - x, next.foot[2] - z);
        if (contacts) contacts.push(next);
        current = next;
      }
      return { ...current, steps, blocked, progress, ...(contacts && { contacts }) };
    }
    return Object.freeze({ stand, move, radius, height, stepUp, stepDown, maxDistance:stride*budget });
  }
  function cadence({ spacing = .62, first = spacing * .35, budget = 256 } = {}) {
    if (!range(spacing, .025, 20) || !range(first, 0, spacing) || !Number.isSafeInteger(budget) || budget < 1 || budget > 4096)
      throw Error('Cadence needs bounded spacing, first contact distance and event budget');
    let remaining = first, index = 0;
    function advance(from, contacts) {
      if (!vector(from, 3) || !Array.isArray(contacts) || contacts.length > 2048)
        throw Error('Cadence needs a starting point and bounded traversal contacts');
      let start = from, next = remaining, cursor = index;
      const events = [];
      for (const contact of contacts) {
        const foot = contact?.foot;
        if (!vector(foot, 3) || !vector(contact.normal, 3) || !materialTag(contact.material) ||
            (contact.support !== null && typeof contact.support !== 'string'))
          throw Error('Invalid cadence contact');
        const length = Math.hypot(foot[0] - start[0], foot[2] - start[2]);
        if (!Number.isFinite(length)) throw Error('Cadence contact distance must be finite');
        if (length > 0) {
          while (next <= length + 1e-9) {
            if (events.length >= budget) throw Error('Cadence exceeds its event budget');
            const fraction = Math.min(1, next / length);
            events.push({
              ...contact,
              foot: foot.map((value, axis) => start[axis] * (1 - fraction) + value * fraction),
              normal: contact.normal.slice(),
              index: cursor, side: cursor++ % 2 ? 'right' : 'left'
            });
            next += spacing;
          }
          next -= length;
        }
        start = foot;
      }
      remaining = next;
      index = cursor;
      return events;
    }
    function reset() { remaining = first; index = 0; }
    return Object.freeze({ advance, reset });
  }

  P.traversal = Object.freeze({ create, cadence, footprint });
})(KIT);
