const RippleField = require('../src/ripple-field.js');

const clamp = n => Math.max(0, Math.min(1,n));
const inside = (receiver, x, z) => x >= receiver.min[0] && x <= receiver.max[0] &&
  z >= receiver.min[1] && z <= receiver.max[1];

function record(value, name) {
  if (!value || ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError(name + ' must be an object');
  return value;
}
function number(value, lo, hi, name) {
  if (!Number.isFinite(value) || value < lo || value > hi) throw new RangeError(name + ' is out of range');
  return value;
}
function vector(value, n, name) {
  if (!Array.isArray(value) || value.length !== n || !Array.from(value).every(Number.isFinite))
    throw new TypeError(name + ' needs ' + n + ' finite coordinates');
  return value.slice();
}

function settings(authored, override) {
  const requested = override ?? authored;
  if (requested === undefined || requested === false) return null;
  const read = value => value === true || value === false || value === undefined ? {} : record(value, 'Rain impacts');
  const base = read(authored), edits = read(override);
  const { receivers = [], maxSources = 48 } = { ...base, ...edits };
  const layer = key => ({ ...(base[key] === undefined ? {} : record(base[key], key)),
    ...(edits[key] === undefined ? {} : record(edits[key], key)) });
  for (const value of [base, edits]) if (Object.keys(value).some(key => !['receivers','maxSources','ripple','paving','runoff'].includes(key)))
    throw new RangeError('Unknown rain impact setting');
  if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 64 || !Array.isArray(receivers))
    throw new RangeError('Rain impacts need receivers and a source budget of 1–64');
  const { lifetime: ringLife = .8, ...wave } = layer('ripple');
  const ripple = { amplitude:.19, scale:.31, speed:1.42, width:.16, damping:.8, ...wave };
  const paving = { radius:.17, lifetime:.23, strength:.92, ...layer('paving') };
  const runoff = { lifetime:2.2, strength:.23, ...layer('runoff') };
  number(ringLife, .001, 30, 'Ripple lifetime');
  number(paving.lifetime, .001, 30, 'Paving impact lifetime');
  number(paving.radius, .001, 20, 'Paving impact radius');
  number(paving.strength, 0, 8, 'Paving impact strength');
  number(runoff.lifetime, .001, 30, 'Runoff lifetime');
  number(runoff.strength, 0, 8, 'Runoff strength');
  const names = new Set();
  let lookback = Math.max(ringLife, paving.lifetime);
  const surfaces = Array.from(receivers, value => {
    const { id, kind, y, min, max, drains = [] } = record(value, 'Rain receiver');
    if (typeof id !== 'string' || !id.trim() || names.has(id) || !['water','paving','roof'].includes(kind) ||
        !Array.isArray(drains) || (kind !== 'roof' && drains.length))
      throw new TypeError('Rain receivers need a unique ID, kind, bounds and optional roof drains');
    names.add(id);
    const low = vector(min, 2, 'Rain receiver minimum'), high = vector(max, 2, 'Rain receiver maximum');
    if (!Number.isFinite(y) || low.some((n,i) => n >= high[i])) throw new RangeError('Invalid rain receiver plane');
    const paths = Array.from(drains, raw => {
      const { from, to, width = .09, delay = .15, travel = .3 } = record(raw, 'Roof drain');
      const start = vector(from, 3, 'Drain start'), end = vector(to, 3, 'Drain end');
      const delta = end.map((n,i) => n - start[i]);
      const length2 = delta.reduce((sum,n) => sum + n*n, 0);
      if (!(length2 > 1e-10) || !Number.isFinite(length2)) throw new RangeError('Roof drain needs a nonzero path');
      number(width, .001, 20, 'Drain width');
      number(delay, 0, 30, 'Drain delay');
      number(travel, .001, 30, 'Drain travel time');
      lookback = Math.max(lookback, delay + travel + runoff.lifetime);
      return { start, delta, length2, width, delay, travel };
    });
    return { id, kind, y, min:low, max:high, paths };
  }).sort((a,b) => b.y - a.y);
  return { receivers:surfaces, maxSources, lookback, ripple, ringLife, paving, runoff };
}

function frame(config, contacts, time) {
  if (!config || !contacts?.length) return null;
  const received = new Map(), { ripple, ringLife, paving, runoff, maxSources } = config;
  for (const contact of contacts) {
    if (!received.has(contact.receiver.id)) received.set(contact.receiver.id, []);
    received.get(contact.receiver.id).push(contact);
  }
  const fields = new Map();
  for (const receiver of config.receivers) {
    const life = receiver.kind === 'water' ? ringLife : receiver.kind === 'paving' ? paving.lifetime : config.lookback;
    const events = (received.get(receiver.id) ?? []).filter(event => time - event.time <= life)
      .sort((a,b) => b.time - a.time).slice(0,maxSources);
    if (!events.length) continue;
    if (receiver.kind === 'water') {
      const drops = events.map(event => ({ at:event.at, start:event.time,
        strength:event.strength * clamp((1 - (time - event.time) / ringLife) * 3) }));
      const field = RippleField.field({ ...ripple, drops, capacity:maxSources });
      fields.set(receiver.id, { receiver, rings:field.frame(time) });
    } else fields.set(receiver.id, { receiver, events });
  }
  function normal(id, at, footprint) {
    const source = fields.get(id);
    if (source?.rings && Math.abs(at[1] - source.receiver.y) <= .12 && inside(source.receiver, at[0], at[2]))
      return RippleField.sampleFrame(source.rings, at, footprint);
  }
  function mask(id, channel, at) {
    const source = fields.get(id);
    if (!source?.events) return 0;
    const { receiver, events } = source;
    let value = 0;
    if (channel === 'splash' && receiver.kind === 'paving') {
      if (Math.abs(at[1] - receiver.y) > .12 || !inside(receiver, at[0], at[2])) return 0;
      for (const event of events) {
        const phase = clamp((time - event.time) / paving.lifetime);
        const radius = paving.radius * (.28 + .72 * phase);
        const q = Math.hypot(at[0] - event.at[0], at[2] - event.at[2]) / radius;
        const ring = clamp(1 - Math.abs(q - phase*.65) * 3);
        value = Math.max(value, ring * (1 - phase) * event.strength * paving.strength);
      }
    } else if (channel === 'runoff' && receiver.kind === 'roof') {
      for (const path of receiver.paths) {
        const dx = at[0]-path.start[0], dy = at[1]-path.start[1], dz = at[2]-path.start[2];
        const u = clamp((dx*path.delta[0] + dy*path.delta[1] + dz*path.delta[2]) / path.length2);
        const taper = clamp(1 - Math.hypot(dx-u*path.delta[0], dy-u*path.delta[1], dz-u*path.delta[2]) / path.width);
        if (!taper) continue;
        const lag = path.delay + u * path.travel;
        let wet = 0;
        for (const event of events) {
          const age = time - event.time - lag;
          if (age >= 0 && age < runoff.lifetime) wet += event.strength * (1 - age / runoff.lifetime) ** 2;
        }
        value = Math.max(value, taper * taper * clamp(wet * runoff.strength));
      }
    }
    return clamp(value);
  }
  return { normal, mask };
}
module.exports = { settings, frame, inside };
