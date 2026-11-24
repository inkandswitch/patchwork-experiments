import {
  createTransition, createTransitionComposer, createTransitionPlayback, transitionEasings, transitionPresets
} from '../../webgl.mjs';
import { height, previewSources, width } from './scenes.mjs';

const $ = selector => document.querySelector(selector);
const canvas = $('canvas'), status = $('#status'), slider = $('#time'), play = $('#play'), sound = $('#sound');
const duration = $('#duration'), easing = $('#easing'), color = $('#color'), seed = $('#seed');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const customAnchors = {
  'character-centered-iris': [0.49, 0.67], 'tile-flood': [0.73, 0.52],
  'destination-iris': [0.72, 0.28], 'last-light-out': [0.72, 0.28], 'lingering-afterimage': [0.48, 0.66]
};
const anchorControls = new Set([...Object.keys(customAnchors), 'diamond-iris', 'clock-wipe',
  'horizontal-squeeze', 'vertical-split', 'faint', 'first-slit-of-light', 'eyelid-reveal', 'sleepy-double-blink',
  'squint-into-daylight', 'wake-from-a-dream', 'threat-centered-blackout', 'ink-soak']);

let composer, selected, anchor, colorEdited, plan, runner, elapsed = 0, previous, request, audio;
const buttons = new Map();
try {
  composer = createTransitionComposer(canvas, { contextAttributes: { preserveDrawingBuffer: true } });
  for (const name of transitionEasings) easing.add(new Option(name, name));
  for (const preset of transitionPresets) {
    let group = buttons.get(preset.group);
    if (!group) {
      group = document.createElement('section');
      const label = document.createElement('h2');
      label.textContent = preset.group;
      group.append(label);
      $('#presets').append(group);
      buttons.set(preset.group, group);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.name;
    button.dataset.preset = preset.id;
    button.addEventListener('click', () => select(preset, !reducedMotion));
    group.append(button);
    buttons.set(preset.id, button);
  }
  select(transitionPresets.find(preset => preset.id === location.hash.slice(1)) ??
    transitionPresets.find(preset => preset.id === 'sleepy-double-blink'), false);
} catch (error) {
  status.textContent = error.message;
}

function resetSettings() {
  duration.value = selected.duration;
  easing.value = '';
  seed.value = selected.defaults.seed ?? 27;
  color.value = '#' + (selected.defaults.color ?? [0, 0, 0]).slice(0, 3)
    .map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('');
  anchor = customAnchors[selected.id];
  colorEdited = false;
}

function select(preset, autoplay) {
  stop();
  buttons.get(selected?.id)?.removeAttribute('aria-current');
  selected = preset;
  buttons.get(selected.id).setAttribute('aria-current', 'true');
  history.replaceState(null, '', '#' + preset.id);
  $('#effect').textContent = preset.name;
  status.textContent = anchorControls.has(preset.id) ? 'Click the preview to move the focal point.' : '';
  resetSettings();
  for (const [name, input] of Object.entries(previewSources(preset))) composer.setSource(name, input);
  configure(autoplay ? 0 : 1);
  if (autoplay) start();
}

function configure(position) {
  const opts = { duration: duration.valueAsNumber, seed: seed.valueAsNumber };
  if (easing.value) opts.easing = easing.value;
  if (colorEdited) opts.color = [...color.value.slice(1).matchAll(/../g)].map(x => parseInt(x[0], 16) / 255).concat(1);
  if (anchor) opts.anchor = opts.target = anchor;
  plan = createTransition(selected.id, opts);
  runner = createTransitionPlayback(plan, { onCue });
  elapsed = position * plan.duration;
  runner.seek(elapsed);
  show(plan.sample(elapsed));
}

function show(frame) {
  composer.draw(frame, { width, height });
  slider.value = Math.round(frame.progress * 1000);
  $('#clock').textContent = frame.time.toFixed(2) + ' / ' + plan.duration.toFixed(2) + ' s';
}

function tick(now) {
  if (previous !== undefined) elapsed = Math.min(plan.duration, elapsed + (now - previous) / 1000);
  previous = now;
  show(runner.update(elapsed));
  if (elapsed < plan.duration) request = requestAnimationFrame(tick);
  else stop();
}

function start() {
  if (elapsed >= plan.duration) {
    elapsed = 0;
    runner.reset();
  }
  if (elapsed === 0) runner.reset();
  previous = undefined;
  play.textContent = 'Pause';
  request = requestAnimationFrame(tick);
}

function stop() {
  if (request !== undefined) cancelAnimationFrame(request);
  request = previous = undefined;
  play.textContent = 'Play';
}

function onCue(cue) {
  if (cue.name !== 'rain' || !audio || sound.getAttribute('aria-pressed') !== 'true') return;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * 1.55), audio.sampleRate);
  const noise = buffer.getChannelData(0);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
  const rain = audio.createBufferSource(), cutoff = audio.createBiquadFilter(), gain = audio.createGain();
  rain.buffer = buffer;
  cutoff.type = 'lowpass';
  cutoff.frequency.value = 1500;
  rain.connect(cutoff).connect(gain).connect(audio.destination);
  gain.gain.setValueAtTime(0.11, audio.currentTime);
  gain.gain.linearRampToValueAtTime(0, audio.currentTime + 1.55);
  rain.start();
}

if (composer) {
  play.addEventListener('click', () => request === undefined ? start() : stop());
  slider.addEventListener('input', () => {
    stop();
    elapsed = Number(slider.value) / 1000 * plan.duration;
    show(runner.seek(elapsed));
  });
  for (const control of [duration, easing, color, seed]) control.addEventListener('change', () => {
    if (!duration.reportValidity() || !seed.reportValidity()) return;
    stop();
    if (control === color) colorEdited = true;
    configure(Number(slider.value) / 1000);
  });
  $('#reset').addEventListener('click', () => {
    stop();
    resetSettings();
    configure(Number(slider.value) / 1000);
  });
  canvas.addEventListener('click', event => {
    if (!anchorControls.has(selected.id)) return;
    const rect = canvas.getBoundingClientRect();
    anchor = [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
    stop();
    const position = Number(slider.value) / 1000;
    configure(position > 0.95 || position < 0.05 ? 0.5 : position);
  });
  sound.addEventListener('click', async () => {
    const enable = sound.getAttribute('aria-pressed') === 'false';
    if (enable) {
      audio ??= new AudioContext();
      await audio.resume();
    }
    sound.setAttribute('aria-pressed', String(enable));
    sound.textContent = enable ? 'Sound on' : 'Sound off';
  });
  window.addEventListener('hashchange', () => {
    const preset = transitionPresets.find(item => item.id === location.hash.slice(1));
    if (preset && preset !== selected) select(preset, false);
  });
}
