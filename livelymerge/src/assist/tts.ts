/**
 * ElevenLabs text-to-speech with character timestamps, so word anchors line up the
 * same way they do with the browser's engine. Flash v2.5 (lowest latency, cheapest).
 * The API key is asked for on first use and kept in localStorage; the voice is
 * looked up by name once and its id cached. Any failure — no key, quota exhausted,
 * network — returns null and the caller falls back to the browser's speech engine;
 * a quota/auth failure also switches ElevenLabs off for the rest of the page load so
 * every later sentence doesn't pay for a failed request first.
 */
export const ELEVEN_KEY_STORAGE = 'talkAndDraw.elevenLabsApiKey';
export const ELEVEN_ON_STORAGE = 'talkAndDraw.elevenLabs';
export const ELEVEN_VOICE_STORAGE = 'talkAndDraw.elevenLabsVoice';
export const ELEVEN_MODEL = 'eleven_flash_v2_5';
export const DEFAULT_VOICE_NAME = 'Hope';
const API = 'https://api.elevenlabs.io';

export interface WordTime {
  /** char offset of the word in the spoken text */
  charIndex: number;
  /** seconds from the start of the audio */
  t0: number;
  t1: number;
}

export interface TtsResult {
  blob: Blob;
  words: WordTime[];
}

/** Why ElevenLabs is off for this page load (quota, bad key, …), or null. */
let disabledReason: string | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function elevenEnabled(): boolean {
  return (storage()?.getItem(ELEVEN_ON_STORAGE) ?? 'on') !== 'off';
}

export function setElevenEnabled(on: boolean): void {
  storage()?.setItem(ELEVEN_ON_STORAGE, on ? 'on' : 'off');
  if (on) disabledReason = null;
}

export function getElevenKey(ask: boolean): string | null {
  const s = storage();
  let key = s?.getItem(ELEVEN_KEY_STORAGE) ?? null;
  if (!key && ask) {
    key = window.prompt('ElevenLabs API key for the voice (kept in this browser only; cancel to use the browser voice):', '')?.trim() ?? null;
    if (key) s?.setItem(ELEVEN_KEY_STORAGE, key);
    else setElevenEnabled(false);
  }
  return key || null;
}

export function clearElevenKey(): void {
  storage()?.removeItem(ELEVEN_KEY_STORAGE);
  disabledReason = null;
}

export function hasElevenKey(): boolean {
  return !!storage()?.getItem(ELEVEN_KEY_STORAGE);
}

export function getVoiceName(): string {
  return storage()?.getItem(ELEVEN_VOICE_STORAGE) || DEFAULT_VOICE_NAME;
}

export function setVoiceName(name: string | null): void {
  const n = (name ?? '').trim();
  if (n && n !== DEFAULT_VOICE_NAME) storage()?.setItem(ELEVEN_VOICE_STORAGE, n);
  else storage()?.removeItem(ELEVEN_VOICE_STORAGE);
  disabledReason = null;
}

/** One line for the drawer: on/off, voice, and why it fell back if it did. */
export function elevenStatus(): string {
  if (!elevenEnabled()) return 'off — using the browser voice';
  if (!hasElevenKey()) return 'on — key asked for on first use';
  if (disabledReason) return `fell back to the browser voice: ${disabledReason}`;
  return `on — voice "${getVoiceName()}", ${ELEVEN_MODEL}`;
}

/** Turns the voice off for this page load and reports why (once, to the console and `notify`). */
function disable(reason: string, notify?: (text: string) => void): void {
  if (disabledReason) return;
  disabledReason = reason;
  console.warn('Talk & Draw: ElevenLabs off for now —', reason);
  notify?.(`ElevenLabs: ${reason}. Using the browser voice.`);
}

async function resolveVoiceId(key: string, name: string): Promise<string | null> {
  const cacheKey = `${ELEVEN_VOICE_STORAGE}Id:${name.toLowerCase()}`;
  const cached = storage()?.getItem(cacheKey);
  if (cached) return cached;
  const res = await fetch(`${API}/v1/voices`, { headers: { 'xi-api-key': key } });
  if (!res.ok) throw new Error(`voices: HTTP ${res.status} ${await errorDetail(res)}`);
  const data = (await res.json()) as { voices?: { voice_id: string; name: string }[] };
  const voices = data.voices ?? [];
  const hit =
    voices.find((v) => v.name.toLowerCase() === name.toLowerCase()) ??
    voices.find((v) => v.name.toLowerCase().startsWith(name.toLowerCase()));
  if (!hit) {
    console.warn(`Talk & Draw: no ElevenLabs voice named "${name}" in your voices (${voices.map((v) => v.name).join(', ')}); add it to My Voices or pick another in the drawer.`);
    if (voices.length === 0) return null;
    return voices[0].voice_id;
  }
  storage()?.setItem(cacheKey, hit.voice_id);
  return hit.voice_id;
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    const d = j?.detail;
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object') return `${d.status ?? ''} ${d.message ?? ''}`.trim();
    return JSON.stringify(j).slice(0, 200);
  } catch {
    return '';
  }
}

/** Words of `text` with their timing, from the API's per-character alignment. */
export function wordsFromAlignment(
  text: string,
  alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } | null | undefined,
): WordTime[] {
  if (!alignment || !Array.isArray(alignment.characters)) return [];
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  // The alignment's character string normally equals the text; when it doesn't,
  // walk both and match characters in order, skipping what the API dropped.
  const out: WordTime[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let a = 0; // cursor into the alignment
  while ((m = re.exec(text))) {
    const first = m.index;
    const last = m.index + m[0].length - 1;
    let t0: number | null = null;
    let t1: number | null = null;
    for (let i = first; i <= last; i++) {
      while (a < chars.length && chars[a] !== text[i]) a++;
      if (a >= chars.length) break;
      if (t0 == null) t0 = starts[a];
      t1 = ends[a];
      a++;
    }
    if (t0 != null && t1 != null) out.push({ charIndex: first, t0, t1 });
  }
  return out;
}

/**
 * Synthesizes `text`. null means "use the browser voice": disabled, no key, or a
 * failure (which also disables it for this page load when it is quota/auth).
 */
export async function synthesize(text: string, notify?: (text: string) => void): Promise<TtsResult | null> {
  if (!elevenEnabled() || disabledReason) return null;
  const key = getElevenKey(false);
  if (!key) return null;
  try {
    const voiceId = await resolveVoiceId(key, getVoiceName());
    if (!voiceId) {
      disable('no usable voice in your account', notify);
      return null;
    }
    const res = await fetch(`${API}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: ELEVEN_MODEL }),
    });
    if (!res.ok) {
      const detail = await errorDetail(res);
      // Quota, bad key, or rate limit: stop trying for this page load.
      if (res.status === 401 || res.status === 402 || res.status === 429 || /quota|credit|limit/i.test(detail)) {
        disable(`HTTP ${res.status} ${detail}`.trim(), notify);
      } else {
        console.warn('Talk & Draw: ElevenLabs request failed', res.status, detail);
      }
      return null;
    }
    const data = (await res.json()) as { audio_base64?: string; alignment?: any };
    if (!data.audio_base64) return null;
    const bytes = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
    return { blob: new Blob([bytes], { type: 'audio/mpeg' }), words: wordsFromAlignment(text, data.alignment) };
  } catch (err) {
    console.warn('Talk & Draw: ElevenLabs unavailable', err);
    disable(err instanceof Error ? err.message : String(err), notify);
    return null;
  }
}
