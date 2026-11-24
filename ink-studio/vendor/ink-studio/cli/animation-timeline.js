const { spriteAtlas } = require('./sprite-atlas.js');

function previewTimes(timeline, state, count) {
  if (count === 1) return { times: [0], sourceTimes: [state.time] };
  const { loop } = state;
  const start = loop?.start ?? state.time, end = loop?.end ?? timeline.duration;
  if (!loop?.wraps) {
    const times = Array.from({ length: count }, (_, i) => (end - start) * i / (count - 1));
    if (start === end) return { times: [0], sourceTimes: [start] };
    return { times, sourceTimes: times.map((t, i) => i === count - 1 ? end : start + t) };
  }

  // Sample the actual last and first poses on either side of the seam.
  const tail = timeline.duration - start, span = tail + end;
  const tailCount = Math.max(1, Math.min(count - 1, Math.round(count * tail / span)));
  const headCount = end === 0 ? 1 : count - tailCount;
  const last = Array.from({ length: tailCount }, (_, i) =>
    i === tailCount - 1 ? timeline.duration : start + tail * i / (tailCount - 1));
  const first = Array.from({ length: headCount }, (_, i) => end * i / Math.max(1, headCount - 1));
  const seamGap = Math.min(1 / timeline.sprite.fps, span / count);
  return {
    times: [...last.map(t => t - last[0]), ...first.map(t => tail + seamGap + t)],
    sourceTimes: [...last, ...first]
  };
}

function previewTimeline(world, { timeline = world.animationTimeline, width, height, frames, before = false,
  maps = ['silhouette'], view = {}, yaw, pivot } = {}) {
  if (typeof timeline?.frame !== 'function') throw new TypeError('Expected a world with an animation timeline');
  const state = timeline.snapshot(), sprite = timeline.sprite;
  const count = frames ?? (state.loop ? 12 : 1);
  if (!Number.isSafeInteger(count) || count < 1 || count > 512)
    throw new RangeError('Timeline preview needs one to 512 frames');

  const { KIT: K } = require('../index.js').load();
  const renderWorld = { ...world };
  let atlas, posed = false;
  try {
    atlas = spriteAtlas(renderWorld, {
      ...previewTimes(timeline, state, count), width: width ?? sprite.width, height: height ?? sprite.height,
      directions: 1, columns: Math.min(count, 8), fps: sprite.fps,
      yaw: (yaw ?? sprite.yaw) + state.direction * Math.PI * 2 / sprite.directions,
      pivot: pivot ?? sprite.pivot, view, maps,
      pose(target, time) {
        timeline.frame(time, { stage: state.stage, before });
        posed = true;
        target.data = K.bones.posed(world);
      }
    });
  } finally {
    if (posed) timeline.frame(state.time, { stage: state.stage });
  }
  atlas.metadata.timeline = { stage: state.stage, part: state.part, playhead: state.time,
    direction: state.direction, directions: sprite.directions, loop: state.loop, finding: state.focus?.id ?? null, before };
  return atlas;
}

module.exports = { previewTimeline };
