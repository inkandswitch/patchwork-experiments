/* Pack independent sprites and their registered maps into a native Ink atlas. */
(function (P) {
  const R = P.raster;
  const {dimensions, view, image, pair, aligned, clamp} = P.rasterSupport;
  const record = P.graphTypes.validator('record');
  const mapNames = ['depth', 'normal', 'emission', 'silhouette'];

  function bounds(raster) {
    const {width, height, data} = raster;
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (!data[(y * width + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    return right < 0 ? {x: 0, y: 0, width: 1, height: 1} :
      {x: left, y: top, width: right - left + 1, height: bottom - top + 1};
  }

  function placement(skyline, width, queue) {
    // The deque gives the highest occupied row under each candidate rectangle.
    let first = 0, end = 0, left = 0, lowest = Infinity;
    for (let x = 0; x < skyline.length; x++) {
      if (first < end && queue[first] <= x - width) first++;
      while (first < end && skyline[queue[end - 1]] <= skyline[x]) end--;
      queue[end++] = x;
      if (x >= width - 1 && skyline[queue[first]] < lowest) {
        lowest = skyline[queue[first]];
        left = x - width + 1;
      }
    }
    return [left, lowest];
  }

  function pack(sprites, {maxWidth = 1024, maxHeight = 1024, padding = 1, extrude = 0, trim = false,
    fps = 12, depthRange, normalSpace = 'view', emissionMode = 'add'} = {}) {
    dimensions(maxWidth, maxHeight);
    if (!Array.isArray(sprites) || !sprites.length || sprites.length > 1024 ||
        !Number.isSafeInteger(padding) || padding < 0 || padding > 128 ||
        !Number.isSafeInteger(extrude) || extrude < 0 || extrude > padding || typeof trim !== 'boolean' ||
        !Number.isFinite(fps) || fps <= 0 || fps > 240 ||
        depthRange !== undefined && (!pair(depthRange) || depthRange[1] < depthRange[0]) ||
        !['view', 'asset'].includes(normalSpace) || !['add', 'baked'].includes(emissionMode))
      throw new RangeError('Invalid atlas sources, spacing or encoding options');
    const ids = new Set(), planes = new Set(['color']);
    let sourcePixels = 0;
    const items = Array.from(sprites, (value, index) => {
      const {source, id = String(index), maps = {}, pivot, unitsPerPixel = 1} =
        value?.source === undefined ? {source: value} : value;
      const input = view(source), {width, height} = input;
      const center = pivot ?? input.pivot ?? [width / 2, height / 2];
      if (!record(maps)) throw new TypeError('Atlas sprite maps must be named rasters');
      const names = Object.keys(maps);
      if (typeof id !== 'string' || !id.length || ids.has(id) || !pair(center) ||
          !Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0 || names.some(name => !mapNames.includes(name)))
        throw new TypeError('Atlas sprites need unique IDs, valid pivots and known maps');
      ids.add(id);
      sourcePixels += width * height * (1 + names.length);
      if (sourcePixels > 16e6) throw new RangeError('Atlas exceeds its source pixel budget');
      const images = {color: R.rgba(source)};
      for (const name of names) {
        aligned(maps[name], width, height);
        images[name] = R.rgba(maps[name]);
        planes.add(name);
      }
      const area = trim ? bounds(images.color) : {x: 0, y: 0, width, height};
      return {id, index, unitsPerPixel, images, area, center, width, height};
    });
    if (planes.has('depth') && depthRange === undefined)
      throw new RangeError('Packed depth maps need an explicit depthRange for their RGB24 samples');

    const skyline = new Int32Array(maxWidth), queue = new Int32Array(maxWidth);
    const sorted = items.slice().sort((a, b) => b.area.height - a.area.height || b.area.width - a.area.width || a.index - b.index);
    let width = 0, height = 0;
    for (const item of sorted) {
      const paddedWidth = item.area.width + padding * 2, paddedHeight = item.area.height + padding * 2;
      if (paddedWidth > maxWidth) throw new RangeError('Sprite does not fit the atlas width: ' + item.id);
      const [x, y] = placement(skyline, paddedWidth, queue);
      if (y + paddedHeight > maxHeight) throw new RangeError('Sprite does not fit the atlas height: ' + item.id);
      skyline.fill(y + paddedHeight, x, x + paddedWidth);
      width = Math.max(width, x + paddedWidth);
      height = Math.max(height, y + paddedHeight);
      item.rect = {x: x + padding, y: y + padding, width: item.area.width, height: item.area.height};
    }
    if (width * height * planes.size > 16e6) throw new RangeError('Packed atlas exceeds its output pixel budget');
    const images = Object.fromEntries([...planes].map(name => [name, new Uint8Array(width * height * 4)]));
    const frames = items.map(item => {
      const {id, index, unitsPerPixel, center, area, rect} = item;
      for (const [name, input] of Object.entries(item.images)) {
        const output = images[name], data = input.data;
        for (let y = -extrude; y < rect.height + extrude; y++) for (let x = -extrude; x < rect.width + extrude; x++) {
          const u = area.x + clamp(x, 0, area.width - 1), v = area.y + clamp(y, 0, area.height - 1);
          const from = (v * input.width + u) * 4, to = ((rect.y + y) * width + rect.x + x) * 4;
          for (let c = 0; c < 4; c++) output[to + c] = data[from + c];
        }
      }
      return {id, frame: index, rect, unitsPerPixel, pivot: {x: center[0] - area.x, y: center[1] - area.y},
        sourceSize: {width: item.width, height: item.height}, trim: {x: area.x, y: area.y}};
    });
    const metadata = {width, height, fps, frames, normalSpace, emissionMode,
      encodings: {color: 'straight RGBA', ...(planes.has('depth') && {depth: {range: depthRange.slice()}})}};
    return {value: image(width, height, 4, images.color), atlas: {metadata, images}, metadata};
  }

  R.pack = pack;
})(KIT.procedural);
