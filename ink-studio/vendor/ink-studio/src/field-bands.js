/* Hard thresholds and an optional inside edge for sampled scalar fields. */
const FieldBands = (() => {
  const record = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));
  const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;

  function settings(value) {
    if (!record(value, ['stops', 'edge']) || !Array.isArray(value.stops) || !value.stops.length || value.stops.length > 32)
      throw new TypeError('Field bands need one to 32 color stops');
    let last = -1;
    const stops = Array.from(value.stops, stop => {
      if (!record(stop, ['at', 'color']) || !unit(stop.at) || stop.at <= last || stop.color === undefined)
        throw new RangeError('Field band stops need a color and strictly increasing thresholds in [0, 1]');
      last = stop.at;
      return { at: stop.at, color: stop.color };
    });
    const { edge } = value;
    if (edge !== undefined && (!record(edge, ['width', 'color']) || !unit(edge.width) || edge.width <= 0 ||
        edge.color === undefined || edge.width > (stops[1]?.at ?? 1) - stops[0].at + Number.EPSILON))
      throw new RangeError('The field band edge needs a color and a positive width inside the first band');
    return { stops, ...(edge && { edge: { width: edge.width, color: edge.color } }) };
  }

  function bind({ stops, edge }, color) {
    const entries = stops.map(({ at, color: swatch }) => ({ at, rgb: color(swatch) }));
    const rim = edge && { at: entries[0].at, rgb: color(edge.color) };
    const limit = rim && rim.at + edge.width;
    return {
      palette: (rim ? [...entries, rim] : entries).map(entry => entry.rgb),
      sample(value) {
        if (!Number.isFinite(value) || value < entries[0].at) return;
        if (rim && value < limit) return rim;
        for (let i = entries.length - 1; i > 0; i--) if (value >= entries[i].at) return entries[i];
        return entries[0];
      }
    };
  }
  return Object.freeze({ settings, bind });
})();
if (typeof module !== 'undefined') module.exports = FieldBands;
