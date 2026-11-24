/* Reuse retained depth buckets with smaller transient streams. */
const SplatOrder = (() => {
  const bins = 65536, never = () => false;
  function key(depth,minimum,scale){
    const bucket=(depth-minimum)*scale|0;
    return bucket<0?0:bucket>=bins?bins-1:bucket;
  }
  const sortWorkspace = new WeakMap(), bucketTables = new WeakMap();

  function compile(indices, depthAt, behind = never) {
    if (!indices.length) return null;
    const depths = new Float32Array(indices.length);
    let minimum = Infinity, maximum = -Infinity;
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i], depth = depthAt(index);
      if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff ||
          (i > 0 && index <= indices[i - 1]) || !Number.isFinite(depth))
        throw new Error('Depth sorting needs increasing nonnegative integer indices and finite depths');
      depths[i] = depth;
      minimum = Math.min(minimum, depth);
      maximum = Math.max(maximum, depth);
    }
    const scale = (bins - 1) / (maximum - minimum || 1);
    const backKey = key(Math.fround(minimum), minimum, scale);
    const counts = new Uint32Array(bins), keys = new Uint16Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const bucket = behind(indices[i]) ? backKey : key(depths[i], minimum, scale);
      keys[i] = bucket;
      counts[bucket]++;
    }
    let prefix = 0;
    for (let i = 0; i < bins; i++) {
      const count = counts[i];
      counts[i] = prefix;
      prefix += count;
    }
    const order = new Int32Array(indices.length), sortedKeys = new Uint16Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const bucket = keys[i], position = counts[bucket]++;
      order[position] = indices[i];
      sortedKeys[position] = bucket;
    }
    const retained=Object.freeze({ minimum, maximum, scale, backKey, order, keys: sortedKeys });
    bucketTables.set(retained,counts);
    return retained;
  }

  function sortTail(retained, indices, keys, ordered) {
    if(!ordered||indices.length<512){
      indices.sort((a,b)=>keys[a]-keys[b]||a-b);
      return;
    }
    let workspace=sortWorkspace.get(retained);
    if(!workspace||workspace.scratch.length<indices.length){
      workspace={scratch:new Int32Array(Math.max(indices.length,Math.ceil((workspace?.scratch.length||0)*1.5))),
        low:new Uint32Array(256),high:new Uint32Array(256)};
      sortWorkspace.set(retained,workspace);
    }
    const {scratch,low,high}=workspace;
    low.fill(0);high.fill(0);
    for(let i=0;i<indices.length;i++){
      const value=keys[indices[i]];
      low[value&255]++;
      high[value>>8]++;
    }
    let a=0,b=0;
    for(let i=0;i<256;i++){
      const countLow=low[i],countHigh=high[i];
      low[i]=a;high[i]=b;
      a+=countLow;b+=countHigh;
    }
    // Stable bucket passes preserve the input's sample-index tie order.
    for(let i=0;i<indices.length;i++){
      const index=indices[i];
      scratch[low[keys[index]&255]++]=index;
    }
    for(let i=0;i<indices.length;i++){
      const index=scratch[i];
      indices[high[keys[index]>>8]++]=index;
    }
  }

  function merge(retained, indices, depthAt, behind, result, keysByIndex) {
    if (result.length < retained.order.length + indices.length) throw new Error('Depth order target is too small');
    let previous=-1,ordered=true;
    for (const index of indices) {
      const depth = depthAt(index);
      if (!Number.isSafeInteger(index) || index < 0 || index >= keysByIndex.length || !Number.isFinite(depth))
        throw new Error('Depth sorting needs in-range indices and finite depths');
      // A changing range requires rebuilding the original buckets, including
      // ties. Let the caller perform its full sort with all current depths.
      if (depth < retained.minimum || depth > retained.maximum) return false;
      keysByIndex[index] = behind(index) ? retained.backKey : key(Math.fround(depth), retained.minimum, retained.scale);
      if(index<previous)ordered=false;
      previous=index;
    }
    sortTail(retained,indices,keysByIndex,ordered);
    const { order, keys } = retained, bucketEnds=bucketTables.get(retained);
    let i = 0, at = 0;
    for (const index of indices) {
      const depth = keysByIndex[index];
      if(bucketEnds){
        let stop=Math.max(i,depth?bucketEnds[depth-1]:0);
        const end=bucketEnds[depth];
        while(stop<end&&order[stop]<index)stop++;
        if(stop-i>=64){
          result.set(order.subarray(i,stop),at);
          at+=stop-i;
          i=stop;
        }else while(i<stop)result[at++]=order[i++];
      }else{
        while(i<order.length&&(keys[i]<depth||keys[i]===depth&&order[i]<index))
          result[at++]=order[i++];
      }
      result[at++] = index;
    }
    result.set(order.subarray(i), at);
    return true;
  }

  function transparency(value) {
    if (value === undefined || value === false) return null;
    if (value === true) return { depthTolerance: 0.04 };
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => key !== 'depthTolerance' && key !== 'mode'))
      throw new TypeError('Stable transparency expects a boolean or settings with mode and depthTolerance');
    const { mode = 'hold' } = value;
    const depthTolerance = value.depthTolerance ?? .04;
    if (!['hold', 'blend'].includes(mode)) throw new TypeError('Stable transparency mode needs hold or blend');
    if (!Number.isFinite(depthTolerance) || depthTolerance < 0)
      throw new RangeError('Transparency depthTolerance must be finite and nonnegative');
    return depthTolerance ? { depthTolerance, ...(mode === 'blend' && { mode }) } : null;
  }

  function isTransparent(data, index, opacity, optical, back) {
    const flags = data[index * 16 + 11] | 0;
    return opacity <= 0 || (!(flags & 64) && !back?.has(index) && (opacity < 1 || flags & 16 || optical));
  }

  const byIndex = index => index;

  // A transparent row can move ahead only when it is within the depth window
  // of the farthest remaining row. A priority queue picks the previous order
  // among eligible rows without a nontransitive comparison of depth pairs.
  function stabilize(order, tolerance, depthAt, transparentAt, rankAt = byIndex, sameSpan = anySpan) {
    if (!tolerance) return order;
    let rows, depths, ranks, heap, used;
    for (let start = 0; start + 1 < order.length;) {
      if (!transparentAt(order[start])) { start++; continue; }
      let end = start + 1;
      while (end < order.length && transparentAt(order[end]) &&
             depthAt(order[end]) - depthAt(order[end - 1]) <= tolerance &&
             sameSpan(order[end - 1], order[end])) end++;
      if (end - start > 1) {
        rows ??= [];
        depths ??= [];
        ranks ??= [];
        heap ??= [];
        used ??= [];
        const count = end - start;
        for (let i = 0; i < count; i++) {
          const row = order[start + i];
          rows[i] = row;
          depths[i] = depthAt(row);
          ranks[i] = rankAt(row);
          used[i] = false;
        }
        let first = 0, add = 0, size = 0;
        for (let position = start; position < end; position++) {
          while (first < count && used[first]) first++;
          const limit = depths[first] + tolerance;
          while (add < count && depths[add] <= limit) {
            let at = size++;
            while (at > 0) {
              const parent = (at - 1) >> 1;
              if (ranks[heap[parent]] <= ranks[add]) break;
              heap[at] = heap[parent];
              at = parent;
            }
            heap[at] = add++;
          }
          const next = heap[0], tail = heap[--size];
          if (size) {
            let at = 0;
            while (at * 2 + 1 < size) {
              let child = at * 2 + 1;
              if (child + 1 < size && ranks[heap[child + 1]] < ranks[heap[child]]) child++;
              if (ranks[tail] <= ranks[heap[child]]) break;
              heap[at] = heap[child];
              at = child;
            }
            heap[at] = tail;
          }
          used[next] = true;
          order[position] = rows[next];
        }
      }
      start = end;
    }
    return order;
  }

  function anySpan() { return true; }

  function history() {
    let previous, ranks;
    return Object.freeze({
      reset() { previous = ranks = undefined; },
      sort(order, { data, layout, view, time, tolerance, depthAt, transparentAt, sameSpan }) {
        const direction = [view[2], view[6], view[10]];
        if (previous && (previous.data !== data || previous.layout !== layout || ranks.length !== order.length || previous.tolerance !== tolerance ||
            time < previous.time || direction.reduce((dot, axis, i) => dot + axis * previous.direction[i], 0) < 0.866))
          ranks = undefined;
        if (ranks) stabilize(order, tolerance, depthAt, transparentAt, index => ranks[index], sameSpan);
        ranks ??= new Int32Array(order.length);
        for (let i = 0; i < order.length; i++) ranks[order[i]] = i;
        previous = { data, layout, direction, time, tolerance };
        return order;
      }
    });
  }

  return Object.freeze({ compile, merge, transparency, isTransparent, stabilize, history });
})();
if (typeof module !== 'undefined') module.exports = SplatOrder;
