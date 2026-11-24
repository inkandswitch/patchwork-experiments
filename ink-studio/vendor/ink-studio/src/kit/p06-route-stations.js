/* Retain normalized positions through named edits to an ordered route. */
(function (K) {
  const P = K.procedural || K.authoring;
  const unit = v => Number.isFinite(v) && v >= 0 && v <= 1;
  const interval = v => Array.isArray(v) && v.length === 2 && v.every(unit) && v[0] < v[1];
  const destination = v => Array.isArray(v) && v.length === 2 && v.every(unit) && v[0] !== v[1];
  const lerp = (a,b,t) => a + (b-a)*t;

  function index(sections) {
    if (!Array.isArray(sections)) throw Error('Route stations need ordered sections');
    const order = [], byKey = new Map();
    let length = 0;
    for (const {key,length:span} of sections) {
      if (typeof key !== 'string' || !key || byKey.has(key) || !(span > 0) || !Number.isFinite(span))
        throw Error('Route sections need distinct keys and positive finite lengths');
      const section = { key, start:length, length:span };
      byKey.set(key,section);
      order.push(section);
      length += span;
    }
    if (!Number.isFinite(length)) throw Error('Route length must be finite');
    return {
      byKey,
      locate(u) {
        if (!unit(u)) throw Error('Route station must be between zero and one');
        if (!order.length) return null;
        const station = u*length;
        const part = order.find(p => station <= p.start+p.length) || order.at(-1);
        return { key:part.key, t:Math.max(0,Math.min(1,(station-part.start)/part.length)) };
      },
      at(key,t) {
        const part = byKey.get(key);
        return part ? (part.start+part.length*t)/length : null;
      }
    };
  }

  function remap(before, after, edits = []) {
    const old = index(before), next = index(after), ranges = new Map();
    for (const {from,to,fromRange=[0,1],toRange=[0,1]} of edits) {
      if (!old.byKey.has(from) || !next.byKey.has(to) || !interval(fromRange) || !destination(toRange))
        throw Error('Invalid route station mapping');
      const pieces = ranges.get(from) || [];
      pieces.push({to,fromRange:fromRange.slice(),toRange:toRange.slice()});
      ranges.set(from,pieces);
    }
    for (const pieces of ranges.values()) {
      pieces.sort((a,b) => a.fromRange[0]-b.fromRange[0]);
      if (pieces.some((piece,i) => i>0 && piece.fromRange[0]<pieces[i-1].fromRange[1]))
        throw Error('Route station mappings overlap');
    }
    return u => {
      const from = old.locate(u);
      if (!from) return null;
      const pieces = ranges.get(from.key);
      if (!pieces) return next.at(from.key,from.t);
      const piece = pieces.find(({fromRange:[a,b]}) => from.t >= a && from.t <= b);
      return piece ? next.at(piece.to,lerp(...piece.toRange,(from.t-piece.fromRange[0])/(piece.fromRange[1]-piece.fromRange[0]))) : null;
    };
  }

  P.routeStations = Object.freeze({ remap });
})(KIT);
