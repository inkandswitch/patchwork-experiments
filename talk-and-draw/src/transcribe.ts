/**
 * On-device transcription: Whisper via Transformers.js, run after the session ends
 * on the whole recording, with word-level timestamps.
 *
 * Verified 2026-11-03 in node: word timestamps need the `_timestamped` exports
 * (models exported with cross-attentions); the plain ones throw. whisper-base.en
 * timestamped is noticeably more accurate on timing than tiny, and transcribes
 * ~5 s of speech in under a second once loaded. The first load downloads the model
 * (~150 MB fp32 / less quantized) and is cached by the browser afterwards.
 *
 * The library is loaded from the CDN at runtime rather than bundled: bundling it
 * made vite emit a 26 MB ONNX wasm into dist (which pushwork would push into the
 * document), and its onnxruntime-node postinstall broke `pnpm install`. The model
 * files come from huggingface.co either way, and ONNX's wasm defaults to the same
 * CDN, so this adds no new network dependency.
 */
import type { TranscriptWord } from './message';

export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
export const WHISPER_MODEL = 'onnx-community/whisper-base.en_timestamped';

export type ProgressFn = (status: string) => void;

export interface TranscribeResult {
  words: TranscriptWord[];
  text: string;
  model: string;
  device: string;
  /** ms spent in the model (not counting load) */
  ms: number;
}

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<any>;

let asrPromise: Promise<{ asr: Asr; device: string }> | null = null;

function describeProgress(p: any): string | null {
  if (!p || typeof p !== 'object') return null;
  if (p.status === 'progress' && typeof p.progress === 'number') {
    const file = typeof p.file === 'string' ? p.file.split('/').pop() : 'model';
    return `loading ${file} ${Math.round(p.progress)}%`;
  }
  if (p.status === 'initiate') return `loading ${String(p.file ?? 'model').split('/').pop()}…`;
  if (p.status === 'ready') return 'model ready';
  return null;
}

/** Loads (once) the Whisper pipeline. WebGPU when available, else wasm. */
export function loadWhisper(onProgress?: ProgressFn): Promise<{ asr: Asr; device: string }> {
  if (asrPromise) return asrPromise;
  asrPromise = (async () => {
    const { pipeline } = (await import(/* @vite-ignore */ TRANSFORMERS_URL)) as any;
    const progress_callback = (p: any) => {
      const s = describeProgress(p);
      if (s && onProgress) onProgress(s);
    };
    const preferred = (navigator as any).gpu ? 'webgpu' : 'wasm';
    try {
      const asr = (await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
        device: preferred,
        progress_callback,
      } as any)) as unknown as Asr;
      return { asr, device: preferred };
    } catch (err) {
      if (preferred === 'webgpu') {
        console.warn('Talk & Draw: Whisper on WebGPU failed, falling back to wasm', err);
        const asr = (await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
          device: 'wasm',
          progress_callback,
        } as any)) as unknown as Asr;
        return { asr, device: 'wasm' };
      }
      throw err;
    }
  })();
  asrPromise.catch(() => {
    asrPromise = null; // let a later attempt retry
  });
  return asrPromise;
}

/** Decodes a recorded blob (webm/opus, mp4, …) to 16 kHz mono, as Whisper expects. */
export async function decodeTo16kMono(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  // decodeAudioData resamples to the context's rate; an offline context needs no gesture.
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const audio = await ctx.decodeAudioData(bytes);
  const n = audio.length;
  const out = new Float32Array(n);
  const channels = audio.numberOfChannels;
  for (let c = 0; c < channels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += data[i] / channels;
  }
  return out;
}

/**
 * Transcribes the recording. `offsetMs` is how long after the session's t0 the
 * recorder started; it is added so word times line up with stroke times.
 */
export async function transcribe(
  blob: Blob,
  offsetMs: number,
  onProgress?: ProgressFn,
): Promise<TranscribeResult> {
  const [{ asr, device }, samples] = await Promise.all([loadWhisper(onProgress), decodeTo16kMono(blob)]);
  onProgress?.('transcribing…');
  const t = performance.now();
  const out = await asr(samples, { return_timestamps: 'word', chunk_length_s: 30 });
  const ms = performance.now() - t;
  const off = offsetMs / 1000;
  const words: TranscriptWord[] = [];
  for (const c of out?.chunks ?? []) {
    const word = String(c.text ?? '').trim();
    if (!word) continue;
    const [a, b] = Array.isArray(c.timestamp) ? c.timestamp : [0, null];
    const t0 = (typeof a === 'number' ? a : 0) + off;
    const t1 = (typeof b === 'number' ? b : t0 - off) + off;
    words.push({ word, t0, t1 });
  }
  return { words, text: String(out?.text ?? '').trim(), model: WHISPER_MODEL, device, ms };
}
