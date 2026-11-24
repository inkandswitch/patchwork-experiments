/* Group aligned features on a measured chart without changing their retained coordinates. */
(function (K) {
  const P = K.procedural || K.authoring;
  const { wrap, delta, unwrap } = P.periodicCoordinates;
  const pair = values => Array.isArray(values) && values.length === 2 && Array.from(values).every(Number.isFinite);

  function alignedFeatureGroups(features, { axis = 0, chartAxis = axis, periods = [0, 0], separation = .25 } = {}) {
    if (!Array.isArray(features) || ![0, 1].includes(axis) || ![0, 1].includes(chartAxis) ||
        !pair(periods) || periods.some(v => v < 0) || !Number.isFinite(separation) || separation < 0)
      throw new Error('Aligned groups need features, valid axes and nonnegative periods and separation');
    const ids = new Set();
    for (const f of features) {
      if (!f || typeof f.id !== 'string' || !f.id || ids.has(f.id) || !pair(f.at) ||
          !pair(f.units) || !pair(f.size) || [...f.units, ...f.size].some(x => x <= 0) ||
          ![f.gap, f.alignment, f.sizeTolerance].every(x => Number.isFinite(x) && x >= 0) ||
          !Number.isSafeInteger(f.limit) || f.limit < 2)
        throw new Error('Aligned features need unique IDs, finite charts, positive sizes and valid tolerances');
      ids.add(f.id);
    }
    const across = 1 - chartAxis, other = 1 - axis;
    function distance(a, b, i) {
      const d = periods[i] ? delta(b.at[i], a.at[i], periods[i]) : b.at[i] - a.at[i];
      return Math.abs(d) * (a.units[i] + b.units[i]) / 2;
    }
    function joins(a, b) {
      if (distance(a, b, across) > Math.min(a.alignment, b.alignment) ||
          Math.abs(a.size[other] - b.size[other]) > Math.min(a.size[other], b.size[other]) *
            Math.min(a.sizeTolerance, b.sizeTolerance)) return false;
      const along = distance(a, b, chartAxis);
      return along >= Math.min(a.size[axis], b.size[axis]) * separation &&
        along - (a.size[axis] + b.size[axis]) / 2 <= Math.min(a.gap, b.gap);
    }

    const unseen = new Set(features), groups = [];
    while (unseen.size) {
      const first = unseen.values().next().value, component = [first];
      unseen.delete(first);
      for (let i = 0; i < component.length; i++) {
        for (const candidate of unseen) {
          if (!joins(component[i], candidate)) continue;
          unseen.delete(candidate);
          component.push(candidate);
        }
      }
      if (component.length < 2) continue;
      const units = [0, 1].map(i => component.reduce((sum, f) => sum + f.units[i], 0) / component.length);
      const coordinates = component.map(f => f.at[chartAxis]), period = periods[chartAxis];
      const unwrapped = period ? unwrap(coordinates, period) : coordinates;
      const ordered = component.map((feature, i) => ({ feature, station: unwrapped[i] * units[chartAxis] }))
        .sort((a, b) => a.station - b.station || a.feature.id.localeCompare(b.feature.id));
      const limit = Math.min(...component.map(f => f.limit));
      for (let i = 0; i + 1 < ordered.length; i += limit) {
        const view = ordered.slice(i, i + limit);
        const min = Math.min(...view.map(({feature, station}) => station - feature.size[axis] / 2));
        const max = Math.max(...view.map(({feature, station}) => station + feature.size[axis] / 2));
        const acrossCoords = view.map(({feature}) => feature.at[across]);
        const acrossPeriod = periods[across];
        const aligned = acrossPeriod ? unwrap(acrossCoords, acrossPeriod) : acrossCoords;
        const anchor = [];
        const middle = (min + max) / 2 / units[chartAxis];
        const mean = aligned.reduce((sum, n) => sum + n, 0) / aligned.length;
        anchor[chartAxis] = period ? wrap(middle, period) : middle;
        anchor[across] = acrossPeriod ? wrap(mean, acrossPeriod) : mean;
        const size = [];
        size[axis] = max - min;
        size[other] = Math.max(...view.map(({feature}) => feature.size[other]));
        groups.push({ members: view.map(({feature}) => feature.id), stations: view.map(({station}) => station),
          anchor, units: units.slice(), range: [min, max], size });
      }
    }
    return P.data.freeze(groups);
  }

  P.alignedFeatureGroups = alignedFeatureGroups;
})(KIT);
