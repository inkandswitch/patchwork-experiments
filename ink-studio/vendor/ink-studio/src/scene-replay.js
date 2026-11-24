function frameIndex(count, fps, seconds, loop) {
  const duration = count / fps;
  const time = loop ? ((seconds % duration) + duration) % duration : Math.max(0, seconds);
  return Math.min(count - 1, Math.floor(time * fps + 1e-9));
}

function mount(root, recording, settings, indexAt) {
  const image = root.querySelector('img');
  const button = root.querySelector('button');
  const slider = root.querySelector('input');
  const status = root.querySelector('output');
  const { frames, fps } = recording, duration = frames.length / fps;
  let origin = null, offset = 0, animation = 0, index = -1;

  function show(time) {
    const next = indexAt(frames.length, fps, time, false);
    if (next === index) return;
    index = next;
    const source = 'data:image/png;base64,' + frames[index];
    if (image.src !== source) image.src = source;
    if (slider) {
      slider.value = index;
      slider.setAttribute('aria-valuetext', 'Frame ' + (index + 1) + ' of ' + frames.length);
      status.value = (index / fps).toFixed(2) + ' s / ' + duration.toFixed(2) + ' s';
    }
  }
  const position = now => offset + (origin === null ? 0 : (now - origin) / 1000);
  function label() {
    if (button) button.textContent = origin === null ? 'Play' : 'Pause';
  }
  function seek(seconds) {
    if (!Number.isFinite(seconds)) throw new RangeError('Replay time must be finite');
    offset = Math.max(0, Math.min(duration, seconds));
    if (origin !== null) origin = performance.now();
    show(offset);
  }
  function pause() {
    if (origin === null) return;
    const time = position(performance.now());
    offset = settings.loop ? time % duration : Math.min(duration, time);
    origin = null;
    cancelAnimationFrame(animation);
    show(offset);
    label();
  }
  function tick(now) {
    if (origin === null) return;
    let time = Math.max(0, position(now));
    if (time >= duration) {
      if (!settings.loop) {
        pause();
        seek(duration);
        return;
      }
      offset = time %= duration;
      origin = now;
    }
    show(time);
    animation = requestAnimationFrame(tick);
  }
  function play() {
    if (origin !== null || frames.length < 2) return;
    if (offset >= duration) seek(0);
    origin = performance.now();
    animation = requestAnimationFrame(tick);
    label();
  }
  if (button) button.addEventListener('click', () => origin === null ? play() : pause());
  if (slider) slider.addEventListener('input', () => {
    pause();
    seek(Number(slider.value) / fps);
  });
  show(0);
  if (settings.autoplay && !matchMedia('(prefers-reduced-motion: reduce)').matches) play();
  return Object.freeze({ play, pause, seek, duration,
    get currentTime() {
      const time = position(performance.now());
      return origin !== null && settings.loop ? time % duration : Math.min(time, duration);
    },
    get paused() { return origin === null; }
  });
}

module.exports = { frameIndex, mount };
