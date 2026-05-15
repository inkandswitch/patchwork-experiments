export type AudioLayer = {
  context: AudioContext;
  master: GainNode;
  compressor: DynamicsCompressorNode;
};

export async function ensureAudioContext(): Promise<AudioContext> {
  const AudioContextCtor =
    globalThis.AudioContext ??
    (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  const context = new AudioContextCtor();
  if (context.state === 'suspended') {
    await context.resume();
  }
  return context;
}

export function createAudioLayer(context: AudioContext): AudioLayer {
  const compressor = context.createDynamicsCompressor();
  const master = context.createGain();
  compressor.threshold.value = -18;
  compressor.knee.value = 20;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.18;
  master.gain.value = 0.72;
  compressor.connect(master);
  master.connect(context.destination);
  return { context, master, compressor };
}

export function createNoiseSource(context: AudioContext, duration: number) {
  const sampleRate = context.sampleRate;
  const frameCount = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = context.createBuffer(1, frameCount, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    channel[index] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  return source;
}
