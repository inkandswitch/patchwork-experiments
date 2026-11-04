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
export const ELEVEN_MODEL_STORAGE = 'talkAndDraw.elevenLabsModel';
/** Flash and Turbo cost the same (cheapest tier); Turbo sounds better for ~200 ms more
 *  latency; Multilingual v2 is the best of these and twice the price per character. */
export const ELEVEN_MODELS = ['eleven_flash_v2_5', 'eleven_turbo_v2_5', 'eleven_multilingual_v2'];
export const DEFAULT_ELEVEN_MODEL = 'eleven_turbo_v2_5';
export const DEFAULT_VOICE_NAME = 'Hope';
/** What the previous sentence was, so the next one continues its prosody. */
let previousText = '';
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
/** A note about the voice lookup (e.g. the key can't list voices), or null. */
let voiceNote: string | null = null;
/** A premade voice every key can use, for when the chosen one can't be looked up. */
export const FALLBACK_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // "Rachel"

/**
 * Voices known by name, so no lookup (and no voices_read permission) is needed. The
 * premade ones are usable on every plan; library voices such as "Hope" need a paid
 * plan when used through the API.
 */
export const KNOWN_VOICES: Record<string, string> = {
  hope: 'tnSpp4vdxKPjI9w0GnoV', // library voice
  rachel: '21m00Tcm4TlvDq8ikWAM',
  sarah: 'EXAVITQu4vr4xnSDxMaL',
  laura: 'FGY2WhTYpPnrIDTdsKH5',
  charlie: 'IKne3meq5aSn9XLyUdCD',
  george: 'JBFqnCBsd6RMkjVDRZzb',
  callum: 'N2lVS1w4EtoT3dr4eOWO',
  river: 'SAz9YHcvj6GT2YYXdXww',
  liam: 'TX3LPaxmHKxFdv7VOQHJ',
  alice: 'Xb7hH8MSUJpSbSDYk0k2',
  matilda: 'XrExE9yKIg1WjnnlVkGX',
  will: 'bIHbv24MWmeRgasZH58o',
  jessica: 'cgSgspJ2msm6clMCkdW9',
  eric: 'cjVigY5qzO86Huf0OWal',
  chris: 'iP95p4xoKVk53GoZ742B',
  brian: 'nPczCjzI2devNBz1zQrb',
  daniel: 'onwK4e9ZLuTAKqWW03F9',
  lily: 'pFZP5JQG7iQjIQuC4Bku',
  bill: 'pqHfZKP75CvOlQylNhV4',
};
/** The premade voice used when the chosen one is a library voice the plan can't use. */
export const PREMADE_STANDIN = 'sarah';
/** Set when the chosen voice was refused as a library voice; a premade one is used instead. */
let voiceStandIn: string | null = null;

/** ElevenLabs voice ids are 20 alphanumerics; the Voice field takes either a name or an id. */
export function isVoiceId(s: string): boolean {
  return /^[A-Za-z0-9]{20,}$/.test(s.trim());
}

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

export function getElevenModel(): string {
  const m = storage()?.getItem(ELEVEN_MODEL_STORAGE);
  return m && ELEVEN_MODELS.includes(m) ? m : DEFAULT_ELEVEN_MODEL;
}

export function setElevenModel(m: string | null): void {
  if (m && ELEVEN_MODELS.includes(m) && m !== DEFAULT_ELEVEN_MODEL) storage()?.setItem(ELEVEN_MODEL_STORAGE, m);
  else storage()?.removeItem(ELEVEN_MODEL_STORAGE);
}

export function getVoiceName(): string {
  return storage()?.getItem(ELEVEN_VOICE_STORAGE) || DEFAULT_VOICE_NAME;
}

export function setVoiceName(name: string | null): void {
  const n = (name ?? '').trim();
  if (n && n !== DEFAULT_VOICE_NAME) storage()?.setItem(ELEVEN_VOICE_STORAGE, n);
  else storage()?.removeItem(ELEVEN_VOICE_STORAGE);
  disabledReason = null;
  voiceNote = null;
  voiceStandIn = null;
}

/** One line for the drawer: on/off, voice, and why it fell back if it did. */
export function elevenStatus(): string {
  if (!elevenEnabled()) return 'off — using the browser voice';
  if (!hasElevenKey()) return 'on — key asked for on first use';
  if (disabledReason) return `fell back to the browser voice: ${disabledReason}`;
  if (voiceNote) return `on — ${voiceNote}`;
  return `on — voice "${getVoiceName()}", ${getElevenModel()}`;
}

/** Turns the voice off for this page load and reports why (once, to the console and `notify`). */
function disable(reason: string, notify?: (text: string) => void): void {
  if (disabledReason) return;
  disabledReason = reason;
  console.warn('Talk & Draw: ElevenLabs off for now —', reason);
  notify?.(`ElevenLabs: ${reason}. Using the browser voice.`);
}

async function resolveVoiceId(key: string, name: string): Promise<string | null> {
  if (voiceStandIn) return voiceStandIn;
  if (isVoiceId(name)) return name.trim();
  const known = KNOWN_VOICES[name.trim().toLowerCase()];
  if (known) return known;
  const cacheKey = `${ELEVEN_VOICE_STORAGE}Id:${name.toLowerCase()}`;
  const cached = storage()?.getItem(cacheKey);
  if (cached) return cached;
  const res = await fetch(`${API}/v1/voices`, { headers: { 'xi-api-key': key } });
  if (!res.ok) {
    const detail = await errorDetail(res);
    if (res.status === 401 && /permission/i.test(detail)) {
      // A restricted key: it can speak but not list voices. Keep talking with a
      // premade voice, and say how to get the wanted one.
      if (!voiceNote) {
        voiceNote = `key can't list voices (needs the "Voices: read" permission), so "${name}" can't be looked up; using the default voice. Paste the voice's ID into the Voice field to use it.`;
        console.warn('Talk & Draw: ElevenLabs —', voiceNote);
      }
      return FALLBACK_VOICE_ID;
    }
    throw new Error(`voices: HTTP ${res.status} ${detail}`);
  }
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
    const res = await fetch(`${API}/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: getElevenModel(),
        // The sentence before this one, so prosody carries over instead of resetting.
        ...(previousText ? { previous_text: previousText.slice(-300) } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await errorDetail(res);
      if (/library voice/i.test(detail) && !voiceStandIn) {
        // The plan can't use this (library) voice through the API: speak with a
        // premade one instead, say so once, and retry this sentence right away.
        voiceStandIn = KNOWN_VOICES[PREMADE_STANDIN];
        voiceNote = `"${getVoiceName()}" is a library voice your plan can't use via the API; speaking with the premade voice "${PREMADE_STANDIN}". Pick a premade voice (${Object.keys(KNOWN_VOICES).filter((n) => n !== 'hope').join(', ')}) or upgrade.`;
        console.warn('Talk & Draw: ElevenLabs —', voiceNote);
        notify?.(`ElevenLabs: ${voiceNote}`);
        return synthesize(text, notify);
      }
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
    previousText = text;
    const bytes = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
    return { blob: new Blob([bytes], { type: 'audio/mpeg' }), words: wordsFromAlignment(text, data.alignment) };
  } catch (err) {
    console.warn('Talk & Draw: ElevenLabs unavailable', err);
    disable(err instanceof Error ? err.message : String(err), notify);
    return null;
  }
}
