/* Stable attachment selection. A host supplies the frames and physical fit. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V;
  const name = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const tags = value => Array.isArray(value) && value.length <= 32 && value.every(name);
  const unit = value => V.len(value) > 1e-8;
  const draw = (name, seed) => ((P.data.hash(name, seed) >>> 0) + 1) / 4294967297;

  function row({ range, spacing, inset = 0, maxPairs = 8 }) {
    if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite) ||
        !Number.isFinite(range[1] - range[0]) || range[1] < range[0] ||
        !Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(inset) || inset < 0 ||
        !Number.isSafeInteger(maxPairs) || maxPairs < 0 || maxPairs > 31)
      throw Error('Attachment row needs a finite distance range, positive spacing and a bounded pair count');

    const half = (range[1] - range[0]) / 2;
    if (inset > half) return Object.freeze([]);
    const center = range[0] + half;
    const pairs = Math.min(maxPairs, Math.floor((half - inset) / spacing));
    const stations = [];
    function add(index) {
      const distance = center + index * spacing;
      stations.push({ index, distance, range: [
        Math.max(range[0] + inset, distance - spacing / 2),
        Math.min(range[1] - inset, distance + spacing / 2)
      ] });
    }
    add(0);
    for (let i = 1; i <= pairs; i++) {
      add(-i);
      add(i);
    }
    return P.data.freeze(stations);
  }

  function fitRow(spec, { occupied = [], gap = spec?.spacing, fits } = {}) {
    const stations = row(spec || {});
    if (!Array.isArray(occupied) || occupied.length > 1024 ||
        !Array.from(occupied).every(interval => Array.isArray(interval) && interval.length === 2 &&
          interval.every(Number.isFinite) && interval[0] <= interval[1]) ||
        !Number.isFinite(gap) || gap < 0 || fits !== undefined && typeof fits !== 'function')
      throw Error('Fitted attachment rows need a finite gap and bounded occupied intervals');
    const reserved = occupied.slice();
    const result = [];
    for (const station of stations) {
      const [low, high] = station.range;
      const near = reserved.filter(([a, b]) => a <= high && b >= low);
      const candidates = [station.distance, low, high];
      for (const interval of near) {
        for (const edge of interval) if (edge >= low && edge <= high) candidates.push(edge);
      }
      // A support predicate may admit a new point inside an otherwise open band.
      if (fits) for (let i = 1; i < 8; i++) candidates.push(low + (high - low) * i / 8);
      candidates.sort((a, b) => Math.abs(a - station.distance) - Math.abs(b - station.distance) || a - b);
      const distance = [...new Set(candidates)].find(at =>
        near.every(([a, b]) => at <= a || at >= b) && (!fits || fits(at, station)));
      if (distance === undefined) continue;
      result.push({ ...station, preferred: station.distance, distance });
      if (gap) reserved.push([distance - gap, distance + gap]);
    }
    return P.data.freeze(result);
  }

  function layout(slots, families, { seed = 0, fits = () => true, sizeFor, budget = 32768 } = {}) {
    if (!Array.isArray(slots) || slots.length > 1024 || !Array.isArray(families) || families.length > 128 ||
        !Number.isSafeInteger(seed) || typeof fits !== 'function' || sizeFor !== undefined && typeof sizeFor !== 'function' ||
        !Number.isSafeInteger(budget) || budget < 1 || budget > 131072)
      throw Error('Attachment layout needs bounded slots, families and evaluation budget');

    const familyIds = new Set(), candidates = families.map(raw => {
      const { id, weight = 1, size, requires = [], data = null } = raw || {};
      if (!name(id) || familyIds.has(id) || !Number.isFinite(weight) || weight <= 0 ||
          !vector(size) || size.some(v => v <= 0) || !tags(requires)) throw Error('Invalid attachment family');
      familyIds.add(id);
      return P.data.freeze({ id, weight, size: size.slice(), requires: requires.slice(), data: P.data.clone(data) });
    });

    const ids = new Set(), frames = slots.map(raw => {
      const { id, point, normal, tangent, room, tags: labels = [], chance = 1, priority = 0, variant = 0, pin = null, data = null } = raw || {};
      if (!name(id) || ids.has(id) || ![point, normal, tangent].every(vector) || !unit(normal) ||
          !vector(room) || room.some(v => v < 0) || !tags(labels) || !Number.isFinite(chance) || chance < 0 || chance > 1 ||
          !Number.isFinite(priority) || !Number.isSafeInteger(variant) || pin !== null && !familyIds.has(pin))
        throw Error('Invalid attachment slot');
      ids.add(id);
      const n = V.norm(normal), along = V.mad(tangent, n, -V.dot(tangent, n));
      if (!unit(along)) throw Error('Attachment slot axes must span a frame');
      const t = V.norm(along);
      return P.data.freeze({ id, point: point.slice(), normal: n, tangent: t, bitangent: V.cross(n, t),
        room: room.slice(), tags: labels.slice(), chance, priority, variant, pin, data: P.data.clone(data) });
    }).sort((a, b) => b.priority - a.priority || order(a.id, b.id));

    let checks = 0;
    const placements = [];
    for (const slot of frames) {
      const local = P.data.hash(slot.id, seed ^ slot.variant);
      if (!slot.pin && draw('occupancy', local) >= slot.chance) continue;
      const compatible = candidates.filter(family => {
        if (++checks > budget) throw Error('Attachment layout exceeds its candidate budget');
        if (slot.pin && slot.pin !== family.id || !family.requires.every(tag => slot.tags.includes(tag))) return false;
        const size = sizeFor ? sizeFor(family, slot) : family.size;
        if (sizeFor && (!vector(size) || size.some(v => v <= 0)))
          throw Error('Resolved attachment dimensions must be finite and positive');
        return size.every((v, i) => v <= slot.room[i]);
      }).map(family => ({ family, score: -Math.log(draw(family.id, local)) / family.weight }))
        .sort((a, b) => a.score - b.score || order(a.family.id, b.family.id));
      for (const { family } of compatible) {
        const proposal = P.data.freeze({ key: slot.id, slot, family, seed: P.data.hash(family.id, local) });
        if (!fits(proposal, placements.slice())) continue;
        placements.push(proposal);
        break;
      }
    }
    return P.data.freeze(placements);
  }

  P.attachments = Object.freeze({ layout, row, fitRow });
})(KIT);
