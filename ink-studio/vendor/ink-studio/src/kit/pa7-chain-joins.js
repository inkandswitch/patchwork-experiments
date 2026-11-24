/* Join two directed chains by their ends and transfer normalized stations. */
(function (K) {
  const P = K.procedural || K.authoring;
  const vector = point => Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

  function plan(first, second, { tolerance = .3, firstEnd, secondEnd } = {}) {
    const length = first?.length + second?.length;
    if (!Number.isFinite(length) || ![first, second].every(chain =>
      chain.length > 0 && vector(chain.start) && vector(chain.end)))
      throw new Error('Chain joins need finite endpoints and positive lengths');
    if (!Number.isFinite(tolerance) || tolerance < 0 ||
      ![firstEnd, secondEnd].every(end => end === undefined || end === 0 || end === 1))
      throw new Error('Chain joins need a non-negative tolerance and endpoint indices 0 or 1');

    const starts = [first.start, first.end], ends = [second.start, second.end];
    let match = null, nearest = tolerance;
    for (const a of firstEnd === undefined ? [0, 1] : [firstEnd]) {
      for (const b of secondEnd === undefined ? [0, 1] : [secondEnd]) {
        const distance = K.V.dist(starts[a], ends[b]);
        if (distance <= nearest && (!match || distance < nearest)) {
          match = [a, b];
          nearest = distance;
        }
      }
    }
    if (!match) return null;

    const split = first.length / length, reverseFirst = match[0] === 0, reverseSecond = match[1] === 1;
    return {
      firstEnd: match[0], secondEnd: match[1], reverseFirst, reverseSecond, split,
      mapFirst(u) { return (reverseFirst ? 1 - u : u) * split; },
      mapSecond(u) { return split + (reverseSecond ? 1 - u : u) * (1 - split); }
    };
  }

  P.chainJoins = { plan };
})(KIT);
