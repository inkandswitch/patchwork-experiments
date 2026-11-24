const Airflow = require('../src/airflow.js');
const LightSchedule = require('../src/light-schedule.js');
const SceneOptics = require('../src/scene-optics.js');
const { inside } = require('./rain-impacts.js');

function settings(authored, override) {
  if (override === false || (authored === false && override === undefined)) return null;
  const record = value => {
    if (value === undefined || value === true || value === false) return {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype)
      throw new TypeError('World precipitation settings must be an object');
    return value;
  };
  const values = { ...record(authored), ...record(override) };
  if (Object.keys(values).some(key => !['rain', 'snow', 'occluder', 'occlusion', 'flightSegments', 'lightStrength'].includes(key)))
    throw new RangeError('Unknown world precipitation setting');
  const { rain = 1, snow = 1, occlusion = true, occluder, flightSegments = 8, lightStrength = .65 } = values;
  if ([rain, snow].some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
      !Number.isFinite(lightStrength) || lightStrength < 0 || lightStrength > 8 ||
      typeof occlusion !== 'boolean' || (occluder !== undefined && typeof occluder !== 'function') ||
      !Number.isInteger(flightSegments) || flightSegments < 1 || flightSegments > 64)
    throw new RangeError('Invalid world precipitation rates, occlusion or light strength');
  return { rain, snow, occlusion, occluder, flightSegments, lightStrength };
}

function windPath(time, duration, wind, windAt) {
  if (!windAt) return age => [wind[0] * age, wind[1] * age];
  // Integrate a shared, linearly interpolated velocity history for the whole emitter set.
  const count = Math.min(256, Math.max(1, Math.ceil(duration * 24)));
  const step = duration / count, velocity = [wind], sums = [[0,0]];
  for (let i = 1; i <= count; i++) {
    velocity.push(Airflow.frame(windAt(time - i * step) ?? wind).velocity);
    sums.push(sums[i - 1].map((value, axis) => value + step * (velocity[i - 1][axis] + velocity[i][axis]) * .5));
  }
  return age => {
    if (age >= duration) return sums[count];
    const index = Math.min(count - 1, Math.floor(age / step)), dt = age - index * step;
    return sums[index].map((value, axis) => value + dt *
      (velocity[index][axis] + (velocity[index + 1][axis] - velocity[index][axis]) * .5 * dt / step));
  };
}

function blocks(occluder, from, to, time) {
  const delta = to.map((n, i) => n - from[i]), distance = Math.hypot(...delta);
  return distance > 1e-6 && occluder(...from, delta.map(n => n / distance), distance, time);
}

function frame(world, override, { time, wind, windAt, localWind, weather, lamps, localLighting, impacts, exposure }) {
  if (!world.precipitationRanges?.length) return null;
  const config = settings(world.precipitation, override);
  // Tag the authored rows even in the disabled view so they disappear together.
  const rows = new Uint8Array(world.count);
  let duration = 0;
  for (const { first, end, profile } of world.precipitationRanges) {
    rows.fill(profile ? 2 : 1, first, end);
    if (config && (windAt || localWind)) for (let row = first; row < end; row++) {
      const q = row * 16;
      duration = Math.max(duration, world.data[q + 14] / world.data[q + 13]);
    }
  }
  if (!config) return { rows };
  const { occlusion, occluder, flightSegments, lightStrength } = config;
  const historyLength = duration + (impacts?.lookback ?? 0);
  const uniformDrift = windPath(time, historyLength, wind, duration > 0 ? windAt : undefined);
  const histories = new Map(), uniform = new Map();
  function driftFor(index,x,y,z) {
    if (!localWind || !duration) return uniformDrift;
    if (!histories.has(index)) {
      const velocityAt = t => {
        if (!uniform.has(t)) uniform.set(t,windAt?.(t) ?? wind);
        return localWind(t,x,z,uniform.get(t),y);
      };
      histories.set(index,windPath(time,historyLength,localWind(time,x,z,wind,y),velocityAt));
    }
    return histories.get(index);
  }
  const receivers = (impacts?.receivers ?? []).filter(receiver => occlusion || receiver.kind !== 'roof');
  function hit(x, y, z, speed, height, birthAge, flown, drift) {
    const total = drift(birthAge);
    for (const receiver of receivers) {
      const age = (y - receiver.y) / speed;
      if (age <= 0 || age > flown || y - receiver.y > height) continue;
      const tail = drift(birthAge - age);
      const px = x + total[0] - tail[0], pz = z + total[1] - tail[1];
      if (inside(receiver, px, pz)) return { receiver, at:[px,receiver.y,pz], age };
    }
  }
  function blocked(point, origin, age, born, count) {
    const geometry = occlusion && occluder;
    if (!geometry && !exposure?.rainBlocked) return false;
    let from = origin;
    for (let i = 1; i <= count; i++) {
      const to = point(i / count);
      if (exposure?.rainBlocked?.(from,to) ||
          (geometry && blocks(occluder, from, to, born + age * (i - .5) / count))) return true;
      from = to;
    }
    return false;
  }
  function recentContacts() {
    const events = [];
    if (!receivers.length || !config.rain) return events;
    for (const { first, end, profile } of world.precipitationRanges) {
      if (profile && !weather) continue;
      for (let row = first; row < end; row++) {
        const q = row * 16, data = world.data;
        if (Math.round(data[q + 11]) % 16 !== 2 || !data[q + 3]) continue;
        const x = data[q], y = data[q + 1], z = data[q + 2];
        const phase = data[q + 12], speed = data[q + 13], height = data[q + 14], period = height / speed;
        if (!(period > 0 && Number.isFinite(period))) continue;
        const cycle = time / period + phase;
        if (impacts.lookback / period > 4096) throw new RangeError('Rain impact history exceeds the emitter budget');
        const youngest = (cycle - Math.floor(cycle)) * period;
        const drift = driftFor(row,x,y,z);
        for (let born = youngest; born <= impacts.lookback + period; born += period) {
          const contact = hit(x, y, z, speed, height, born, Math.min(born, period), drift);
          if (!contact || born - contact.age > impacts.lookback) continue;
          const eventTime = time - born + contact.age;
          const strength = config.rain * (exposure?.rain?.(...contact.at) ?? 1) *
            (profile ? weather.rainAt?.(eventTime,contact.at[0],contact.at[2]) ?? weather.rainGain : 1);
          if (!(strength > 0)) continue;
          const total = drift(born);
          // Stop just above the authored receiving plane so the receiver itself is not treated as upstream cover.
          const travel = Math.max(0, contact.age - .025 / speed);
          const point = u => {
            const age = travel * u, tail = drift(born - age);
            return [x + total[0] - tail[0], y - speed * age, z + total[1] - tail[1]];
          };
          if (!blocked(point, [x,y,z], travel, time - born, (windAt || localWind) ? flightSegments : 1))
            events.push({ ...contact, time:eventTime, strength });
        }
      }
    }
    return events;
  }
  const fade = (a, b, value) => {
    const u = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };

  function pose(index, x, y, z, kind, phase, speed, height, sway, alpha) {
    const snow = kind === 15, profile = rows[index] === 2;
    const gain = snow ? config.snow : config.rain;
    const localRate = profile && (snow ? weather?.snowHere : weather?.rainHere);
    const uniformRate = profile ? (snow ? weather?.snowGain : weather?.rainGain) ?? 0 : 1;
    if (!gain || !alpha || (!uniformRate && !localRate)) return null;
    const cycle = time * speed / height + phase, fraction = cycle - Math.floor(cycle);
    const age = fraction * height / speed;
    const drift = driftFor(index,x,y,z);
    if (!snow && y - speed * age <= receivers[0]?.y && hit(x, y, z, speed, height, age, age, drift)) return null;
    const total = drift(age);
    function point(progress) {
      const flown = progress * fraction;
      const remaining = drift(age * (1 - progress));
      const wx = snow ? (Math.sin(flown * 11 + phase * 40) - Math.sin(phase * 40)) * sway : 0;
      const wz = snow ? (Math.cos(flown * 7 + phase * 23) - Math.cos(phase * 23)) * sway * .6 : 0;
      return [x + total[0] - remaining[0] + wx, y - flown * height, z + total[1] - remaining[1] + wz];
    }
    const position = point(1);
    const rate = gain * (exposure?.rain?.(...position) ?? 1) * (localRate ? localRate(position[0],position[2]) : uniformRate);
    if (!rate || blocked(point, [x,y,z], age, time - age, snow || windAt || localWind ? flightSegments : 1)) return null;
    const coverage = snow ? fade(0,.05,fraction) * (1 - fade(.92,1,fraction)) : 1 - fraction * fraction;
    return [...position, Math.min(.99, alpha * rate * coverage)];
  }

  const media = lightStrength && localLighting();
  const lighting = lightStrength && (media || lamps.length) ? (x, y, z) => {
    const out = [0,0,0];
    if (media) SceneOptics.addLocalLight(media, x, y, z, out);
    const from = [x,y,z];
    for (const lamp of lamps) {
      const amount = LightSchedule.contribution(lamp, x, y, z);
      if (!amount || (occluder && blocks(occluder, from, lamp.p, time))) continue;
      for (let i = 0; i < 3; i++) out[i] += lamp.color[i] * amount;
    }
    return out.map(value => value * lightStrength);
  } : null;
  return { rows, pose, lighting, contacts: receivers.length ? recentContacts() : undefined };
}

module.exports = { frame, settings };
