/* Sample bounded solid fields inside a candidate volume. */
(function (K) {
  const P = K.procedural;
  const { bounds, overlap, contains, expand } = P.spatial;

  function clearanceField(solids) {
    if (!Array.isArray(solids) || solids.length > 8192) throw new Error('Clearance fields need at most 8192 solids');
    const ids = new Set();
    const records = solids.map(solid => {
      if (typeof solid?.id !== 'string' || !solid.id || ids.has(solid.id) || typeof solid.distance !== 'function') {
        throw new Error('Clearance solids need unique ids, bounds and distance functions');
      }
      ids.add(solid.id);
      return Object.freeze({
        id: solid.id,
        bounds: P.data.freeze(bounds(solid.bounds)),
        distance: solid.distance.bind(solid)
      });
    });
    function query(box, exclude = []) {
      const area = bounds(box);
      if (!Array.isArray(exclude) || !exclude.every(id => typeof id === 'string')) {
        throw new Error('Clearance exclusions must be ids');
      }
      const ignore = new Set(exclude);
      return records.filter(solid => !ignore.has(solid.id) && overlap(solid.bounds, area));
    }
    function probe(box, { spacing = 0.08, padding = 0.015, exclude, budget = 250000 } = {}) {
      const area = bounds(box);
      if (
        !Number.isFinite(spacing) ||
        spacing < 0.02 ||
        spacing > 64 ||
        !Number.isFinite(padding) ||
        padding < 0 ||
        padding > 1 ||
        !Number.isSafeInteger(budget) ||
        budget < 1 ||
        budget > 1000000
      ) {
        throw new Error('Clearance probes need bounded spacing, padding and budget');
      }
      const size = area.max.map((v, i) => v - area.min[i]);
      const steps = size.map(extent => Math.ceil(extent / spacing));
      const tested = steps.reduce((count, n) => count * (n + 1), 1);
      const candidates = query(expand(area, padding), exclude).map(solid => ({
        solid,
        expanded: expand(solid.bounds, padding)
      }));
      if (tested > 32768 || tested * candidates.length > budget) throw new Error('Clearance probe exceeds its budget');
      const at = (axis, index) => area.min[axis] + (steps[axis] ? (size[axis] * index) / steps[axis] : 0);
      const contacts = new Map();
      for (let x = 0; x <= steps[0]; x++) {
        for (let y = 0; y <= steps[1]; y++) {
          for (let z = 0; z <= steps[2]; z++) {
            const point = [at(0, x), at(1, y), at(2, z)];
            for (const { solid, expanded } of candidates) {
              if (!contains(expanded, point)) continue;
              const distance = solid.distance(point);
              if (!Number.isFinite(distance) && distance !== Infinity) throw new Error('Invalid clearance field value');
              if (distance < padding && distance < (contacts.get(solid.id)?.distance ?? Infinity)) {
                contacts.set(solid.id, { id: solid.id, point, distance });
              }
            }
          }
        }
      }
      const sorted = [...contacts.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return P.data.freeze({ clear: !contacts.size, tested, contacts: sorted });
    }

    return Object.freeze({ records: Object.freeze(records), query, probe });
  }

  P.clearance = { field: clearanceField };
})(KIT);
