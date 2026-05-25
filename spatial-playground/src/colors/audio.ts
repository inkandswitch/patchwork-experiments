import type { SoundId } from '../types.ts';
import { ensureAudioContext, createNoiseSource } from '../shared/audio.ts';

export function createAudioManager(): {
  ensureContext(): Promise<AudioContext | null>;
  getContext(): AudioContext | null;
  testOutput(onStatusChange: (text: string) => void): Promise<void>;
  updateSoundLayer(nextSound: SoundId | null): void;
  destroy(): void;
} {
  let audioContext: AudioContext | null = null;
  let activeSoundCleanup: (() => void) | null = null;
  let activeSoundId: SoundId | null = null;

  async function ensureCtx(): Promise<AudioContext | null> {
    audioContext = audioContext ?? await ensureAudioContext();
    return audioContext;
  }

  function getContext(): AudioContext | null {
    return audioContext;
  }

  async function testOutput(onStatusChange: (text: string) => void) {
    audioContext = audioContext ?? await ensureAudioContext();

    if (!audioContext) {
      onStatusChange('Audio unsupported');
      return;
    }

    const now = audioContext.currentTime;
    const master = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    const low = audioContext.createOscillator();
    const high = audioContext.createOscillator();

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, now);
    filter.Q.setValueAtTime(0.7, now);

    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.34, now + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

    low.type = 'triangle';
    high.type = 'sine';
    low.frequency.setValueAtTime(261.63, now);
    high.frequency.setValueAtTime(523.25, now);

    low.connect(filter);
    high.connect(filter);
    filter.connect(master);
    master.connect(audioContext.destination);

    low.start(now);
    high.start(now);
    low.stop(now + 0.72);
    high.stop(now + 0.72);

    onStatusChange('Test tone');
  }

  function updateSoundLayer(nextSound: SoundId | null) {
    if (activeSoundId === nextSound) {
      return;
    }

    activeSoundCleanup?.();
    activeSoundCleanup = null;
    activeSoundId = nextSound;

    if (!audioContext || !nextSound) {
      return;
    }

    activeSoundCleanup = startSoundLayer(audioContext, nextSound);
  }

  function startSoundLayer(context: AudioContext, soundId: SoundId): () => void {
    if (soundId === 'chime') {
      return startChimeLayer(context);
    }

    if (soundId === 'pad') {
      return startPadLayer(context);
    }

    return startLofiLayer(context);
  }

  function createLayerGain(context: AudioContext, peakGain: number) {
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.45);
    gain.connect(context.destination);

    return {
      gain,
      fadeOut: (duration = 0.45) => {
        const fadeNow = context.currentTime;
        gain.gain.cancelScheduledValues(fadeNow);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), fadeNow);
        gain.gain.exponentialRampToValueAtTime(0.0001, fadeNow + duration);
      },
      disconnect: () => {
        gain.disconnect();
      },
    };
  }

  function startChimeLayer(context: AudioContext): () => void {
    const layer = createLayerGain(context, 0.32);
    const notes = [523.25, 587.33, 659.25, 783.99, 880];
    let step = 0;

    const playChime = () => {
      const now = context.currentTime;
      const root = notes[step % notes.length];
      const harmony = notes[(step + 2) % notes.length];
      scheduleBellTone(context, layer.gain, root, now, -0.22);
      scheduleBellTone(context, layer.gain, harmony * 0.5, now + 0.12, 0.22, 0.12);
      step += 1;
    };

    playChime();
    const loopId = window.setInterval(playChime, 1650);

    return () => {
      window.clearInterval(loopId);
      layer.fadeOut(0.65);
      window.setTimeout(() => layer.disconnect(), 760);
    };
  }

  function scheduleBellTone(
    context: AudioContext,
    destination: AudioNode,
    frequency: number,
    startTime: number,
    pan = 0,
    peak = 0.34,
  ) {
    const oscillator = context.createOscillator();
    const overtone = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const panner = context.createStereoPanner();

    oscillator.type = 'sine';
    overtone.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, startTime);
    overtone.frequency.setValueAtTime(frequency * 2.01, startTime);
    panner.pan.setValueAtTime(pan, startTime);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(frequency * 2.2, startTime);
    filter.Q.setValueAtTime(4.5, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 2.2);

    oscillator.connect(gain);
    overtone.connect(gain);
    gain.connect(filter);
    filter.connect(panner);
    panner.connect(destination);

    oscillator.start(startTime);
    overtone.start(startTime);
    oscillator.stop(startTime + 2.3);
    overtone.stop(startTime + 2.3);
  }

  function startPadLayer(context: AudioContext): () => void {
    const layer = createLayerGain(context, 0.34);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 980;
    filter.Q.value = 0.7;
    filter.connect(layer.gain);

    const tremolo = context.createOscillator();
    const tremoloDepth = context.createGain();
    tremolo.frequency.value = 0.08;
    tremoloDepth.gain.value = 110;
    tremolo.connect(tremoloDepth);
    tremoloDepth.connect(filter.frequency);
    tremolo.start();

    const oscillators = [0, 1, 2].map((index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index === 1 ? 'sine' : 'triangle';
      gain.gain.value = index === 1 ? 0.22 : 0.14;
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start();
      return oscillator;
    });

    const chords = [
      [220, 277.18, 329.63],
      [196, 246.94, 329.63],
      [174.61, 220, 293.66],
    ];
    let chordIndex = 0;

    const retuneChord = () => {
      const now = context.currentTime;
      const chord = chords[chordIndex % chords.length];
      oscillators.forEach((oscillator, index) => {
        oscillator.frequency.cancelScheduledValues(now);
        oscillator.frequency.linearRampToValueAtTime(chord[index], now + 1.8);
      });
      chordIndex += 1;
    };

    retuneChord();
    const loopId = window.setInterval(retuneChord, 6200);

    return () => {
      window.clearInterval(loopId);
      layer.fadeOut(0.8);
      const stopAt = context.currentTime + 0.85;
      tremolo.stop(stopAt);
      oscillators.forEach((oscillator) => oscillator.stop(stopAt));
      window.setTimeout(() => layer.disconnect(), 920);
    };
  }

  function startLofiLayer(context: AudioContext): () => void {
    const layer = createLayerGain(context, 0.38);
    const hissSource = createNoiseSource(context, 1.8);
    const hissFilter = context.createBiquadFilter();
    const hissGain = context.createGain();

    hissFilter.type = 'lowpass';
    hissFilter.frequency.value = 1800;
    hissGain.gain.value = 0.08;
    hissSource.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(layer.gain);
    hissSource.loop = true;
    hissSource.start();

    const bassNotes = [110, 130.81, 98, 123.47];
    let step = 0;

    const playPulse = () => {
      const now = context.currentTime;
      const bass = bassNotes[step % bassNotes.length];
      scheduleLofiPulse(context, layer.gain, bass, now);
      step += 1;
    };

    playPulse();
    const loopId = window.setInterval(playPulse, 900);

    return () => {
      window.clearInterval(loopId);
      layer.fadeOut(0.6);
      hissSource.stop(context.currentTime + 0.65);
      window.setTimeout(() => layer.disconnect(), 760);
    };
  }

  function scheduleLofiPulse(
    context: AudioContext,
    destination: AudioNode,
    frequency: number,
    startTime: number,
  ) {
    const bassOscillator = context.createOscillator();
    const toneOscillator = context.createOscillator();
    const bassGain = context.createGain();
    const toneGain = context.createGain();
    const bassFilter = context.createBiquadFilter();
    const toneFilter = context.createBiquadFilter();

    bassOscillator.type = 'triangle';
    toneOscillator.type = 'sawtooth';
    bassOscillator.frequency.setValueAtTime(frequency, startTime);
    bassOscillator.frequency.exponentialRampToValueAtTime(frequency * 0.92, startTime + 0.32);
    toneOscillator.frequency.setValueAtTime(frequency * 2, startTime);
    toneOscillator.frequency.exponentialRampToValueAtTime(frequency * 1.84, startTime + 0.28);

    bassFilter.type = 'lowpass';
    bassFilter.frequency.setValueAtTime(820, startTime);
    bassFilter.Q.setValueAtTime(0.7, startTime);

    toneFilter.type = 'bandpass';
    toneFilter.frequency.setValueAtTime(900, startTime);
    toneFilter.Q.setValueAtTime(1.1, startTime);

    bassGain.gain.setValueAtTime(0.0001, startTime);
    bassGain.gain.exponentialRampToValueAtTime(0.34, startTime + 0.02);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.48);

    toneGain.gain.setValueAtTime(0.0001, startTime);
    toneGain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.015);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.34);

    bassOscillator.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(destination);

    toneOscillator.connect(toneFilter);
    toneFilter.connect(toneGain);
    toneGain.connect(destination);

    bassOscillator.start(startTime);
    toneOscillator.start(startTime);
    bassOscillator.stop(startTime + 0.54);
    toneOscillator.stop(startTime + 0.42);

    const click = createNoiseSource(context, 0.12);
    const clickFilter = context.createBiquadFilter();
    const clickGain = context.createGain();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.setValueAtTime(1400, startTime);
    clickGain.gain.setValueAtTime(0.0001, startTime);
    clickGain.gain.exponentialRampToValueAtTime(0.11, startTime + 0.01);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.16);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(destination);
    click.start(startTime);
    click.stop(startTime + 0.18);
  }

  return {
    ensureContext: ensureCtx,
    getContext,
    testOutput,
    updateSoundLayer,
    destroy() {
      activeSoundCleanup?.();
      activeSoundCleanup = null;
      if (audioContext) {
        void audioContext.close();
        audioContext = null;
      }
    },
  };
}
