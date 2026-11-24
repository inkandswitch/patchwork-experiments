/* Address a region of a fixed cell-centered lattice without changing its phase. */
(function (K) {
  const P = K.procedural || K.authoring;
  const interval = value => Array.isArray(value) && value.length === 2 &&
    Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[0] <= value[1];

  function centeredGridRange(domain, count, region = domain) {
    if (!interval(domain) || domain[0] === domain[1] ||
        !Number.isFinite(domain[1] - domain[0]) || !interval(region) ||
        !Number.isSafeInteger(count) || count < 1)
      throw new Error('A centered grid needs finite intervals and a positive sample count');

    const [min,max] = domain, span = max - min;
    function boundary(value,inclusive) {
      let low = 0, high = count;
      while (low < high) {
        const mid = low + Math.floor((high-low)/2);
        const center = min + span*((mid+.5)/count);
        if (center < value || inclusive && center === value) low = mid + 1;
        else high = mid;
      }
      return low;
    }
    return [boundary(region[0],false),boundary(region[1],true)];
  }

  (P.sampling ||= {}).centeredGridRange = centeredGridRange;
})(KIT);
