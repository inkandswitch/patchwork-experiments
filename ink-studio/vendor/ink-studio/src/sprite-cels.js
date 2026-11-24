/* Frame-local edits and visual holds registered to baked sprite views. */
const SpriteCels = (() => {
  const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
  const fields = (value, allowed) => isRecord(value) && Object.keys(value).every(key => allowed.includes(key));
  const names = ['color', 'depth', 'normal', 'emission', 'effect'];
  const target = ['frame', 'direction', 'pitch'];

  function prepare(definition, groups, { width, color, depthRange, copyRgba, pixelBudget }) {
    if (definition === undefined) return null;
    if (!fields(definition, ['poses', 'replacements', 'holds']))
      throw new TypeError('Sprite cels need poses, replacements or holds');
    const { poses = {}, replacements = [], holds = [] } = definition;
    if (!isRecord(poses) || Object.entries(poses).some(([name, frame]) => !name.trim() || !groups.has(frame)) ||
        ![replacements, holds].every(list => Array.isArray(list) && list.length <= 4096))
      throw new RangeError('Sprite cels need named baked frames and bounded edit lists');
    const frameIds = [...groups.keys()].sort((a, b) => a - b);
    const edited = new Map(), held = new Map();

    function select(edit) {
      const frame = typeof edit.frame === 'string' && Object.hasOwn(poses, edit.frame) ? poses[edit.frame] : edit.frame;
      const views = groups.get(frame)?.filter(view =>
        (edit.direction === undefined || edit.direction === view.direction) &&
        (edit.pitch === undefined || edit.pitch === view.pitch));
      if (!views?.length) throw new RangeError('Sprite cel edit matches no baked view for frame ' + edit.frame);
      return { frame, views };
    }

    for (const edit of replacements) {
      if (!fields(edit, [...target, 'images', 'extensionDepth', 'effectDepth']) ||
          !fields(edit.images, names) || !Object.keys(edit.images).length ||
          [edit.extensionDepth, edit.effectDepth].some(value => value !== undefined && !Number.isFinite(value)))
        throw new TypeError('Sprite cel replacement needs registered images and finite depth offsets');
      const { views } = select(edit);
      if (views.length !== 1 || edited.has(views[0]))
        throw new RangeError('Sprite cel replacement must uniquely identify one unedited view');
      const view = views[0], { x, y, width: w, height: h } = view.rect;
      pixelBudget -= w * h * Object.keys(edit.images).length;
      if (pixelBudget < 0) throw new RangeError('Sprite cel edits exceed the atlas pixel budget');
      const maps = Object.fromEntries(Object.entries(edit.images).map(([name, image]) =>
        [name, copyRgba(image, w * h * 4, 'Sprite cel ' + name)]));
      if (maps.depth && !depthRange) throw new RangeError('A sprite cel depth image needs the atlas depth range');
      if (maps.color && edit.extensionDepth === undefined) {
        for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
          const pixel = (row * w + col) * 4 + 3, baked = ((row + y) * width + col + x) * 4 + 3;
          if (maps.color[pixel] && !color[baked] && !maps.depth?.[pixel])
            throw new RangeError('Sprite cel paint outside the baked silhouette needs depth or an effect image');
        }
      }
      edited.set(view, { maps, extensionDepth: edit.extensionDepth, effectDepth: edit.effectDepth ?? 0 });
    }

    for (const hold of holds) {
      if (!fields(hold, [...target, 'frames']) || !Number.isSafeInteger(hold.frames) || hold.frames < 2)
        throw new TypeError('Sprite cel hold needs a frame and a length of at least two frames');
      const { frame, views } = select(hold), start = frameIds.indexOf(frame);
      if (start + hold.frames > frameIds.length) throw new RangeError('Sprite cel hold extends past the bake');
      for (const source of views) for (let i = 0; i < hold.frames; i++) {
        const destination = groups.get(frameIds[start + i]).find(view =>
          view.direction === source.direction && view.yaw === source.yaw && view.pitch === source.pitch);
        if (!destination) throw new RangeError('Sprite cel hold needs matching views in every held frame');
        if (held.has(destination)) throw new RangeError('Sprite cel holds overlap within a view');
        held.set(destination, source);
      }
    }
    return { edited, held };
  }

  function playback(entries, fps, mode) {
    if (!['loop', 'once'].includes(mode))
      throw new RangeError('Sprite playback must be loop or once');
    if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('Sprite playback needs a positive frame rate');
    const views = new Map();
    for (const entry of entries) {
      const frame = entry.frame ?? 0, prior = views.get(frame);
      if (prior && (prior.time !== entry.time || prior.duration !== entry.duration))
        throw new RangeError('Sprite atlas views of a frame must share its timing');
      views.set(frame, entry);
    }
    const ids = [...views.keys()].sort((a, b) => a - b);
    let next = 0;
    const times = ids.map(frame => {
      const { time = next, duration = 1 / fps } = views.get(frame);
      if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0)
        throw new RangeError('Sprite playback needs finite times and positive durations');
      next = time + duration;
      return time;
    });
    if (times.some((time, index) => index > 0 && time <= times[index - 1]) || !Number.isFinite(next))
      throw new RangeError('Sprite playback times must increase by frame');
    const origin = times[0], length = next - origin;
    if (!(length > 0 && Number.isFinite(length))) throw new RangeError('Sprite playback needs a finite duration');
    const epsilon = Math.min(length * 1e-7, Math.max(1, Math.abs(origin), length) * 4 * Number.EPSILON);
    return time => {
      const elapsed = Number.isFinite(time) ? time : 0;
      let offset = elapsed;
      if (mode === 'loop') {
        offset %= length;
        if (offset < 0) offset += length;
        if (length - offset <= epsilon) offset = 0;
      }
      const at = origin + offset + epsilon;
      let left = 0, right = times.length;
      while (right - left > 1) {
        const mid = (left + right) >> 1;
        if (times[mid] <= at) left = mid;
        else right = mid;
      }
      return ids[left];
    };
  }

  return Object.freeze({ prepare, playback });
})();
if (typeof module !== 'undefined') module.exports = SpriteCels;
