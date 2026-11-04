/**
 * Speech with word anchors. The AI's text carries inline markers,
 *   "I'll move {s1}this window{/} over {p2}here{/}."
 * and the executor fires the steps anchored to `s1` when the TTS reaches "this",
 * ending them when "window" has been spoken. M3 uses the browser's speechSynthesis
 * (word boundary events); ElevenLabs with character timestamps comes later.
 */
export interface AnchorSpan {
  id: string;
  /** char offsets in the plain (marker-free) text; end == start for a point marker */
  start: number;
  end: number;
}

export interface ParsedSay {
  text: string;
  spans: AnchorSpan[];
  words: { start: number; end: number }[];
}

/**
 * Symbols read badly by speech engines ("180°" came out as "degreerrrs"), turned into
 * words. Applied before anchor parsing so word offsets stay consistent.
 */
export function speakable(raw: string): string {
  return raw
    .replace(/(\d)\s*°\s*C\b/g, '$1 degrees Celsius')
    .replace(/(\d)\s*°\s*F\b/g, '$1 degrees Fahrenheit')
    .replace(/(\d)\s*°/g, '$1 degrees')
    .replace(/°/g, ' degrees')
    .replace(/(\d)\s*px\b/g, '$1 pixels')
    .replace(/(\d)\s*×\s*(\d)/g, '$1 by $2')
    .replace(/×/g, ' times ')
    .replace(/→/g, ' to ')
    .replace(/≈/g, ' about ')
    .replace(/≤/g, ' at most ')
    .replace(/≥/g, ' at least ')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Strips `{id}` / `{/}` markers and records the spans they delimit. */
export function parseAnchors(raw: string): ParsedSay {
  raw = speakable(raw);
  let text = '';
  const spans: AnchorSpan[] = [];
  const open: AnchorSpan[] = [];
  const re = /\{(\/|[A-Za-z0-9_-]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    text += raw.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] === '/') {
      const s = open.pop();
      if (s) s.end = text.length;
    } else {
      const s: AnchorSpan = { id: m[1], start: text.length, end: text.length };
      spans.push(s);
      open.push(s);
    }
  }
  text += raw.slice(last);
  // Unclosed spans cover the single word that follows them.
  for (const s of open) {
    const w = wordsOf(text).find((w) => w.end > s.start);
    s.end = w ? w.end : s.start;
  }
  return { text, spans, words: wordsOf(text) };
}

export function wordsOf(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** Index of the first word a span covers, and of the last. */
export function spanWords(p: ParsedSay, s: AnchorSpan): { first: number; last: number } {
  let first = p.words.findIndex((w) => w.end > s.start);
  if (first < 0) first = p.words.length - 1;
  let last = -1;
  for (let i = 0; i < p.words.length; i++) if (p.words[i].start < Math.max(s.end, s.start + 1)) last = i;
  if (last < first) last = first;
  return { first, last };
}

export interface SpeakHandlers {
  /** Called as each word starts (index into parsed.words). */
  onWord?(index: number): void;
  onSpanStart?(span: AnchorSpan): void;
  onSpanEnd?(span: AnchorSpan): void;
}

export interface TtsWord {
  charIndex: number;
  t0: number;
  t1: number;
}

export interface SpeakOptions {
  rate?: number;
  voiceName?: string;
  /** chars/s used to estimate word timing when the engine gives no boundary events */
  estimatedCharsPerSec?: number;
  /** Cut whatever is speaking or queued and start now (say steps, whose anchors must
   *  line up with actions). Default: queue behind what is already speaking. */
  takeover?: boolean;
  /** An external voice (ElevenLabs): audio plus word times. null → the browser's engine. */
  tts?: (text: string) => Promise<{ blob: Blob; words: TtsWord[] } | null>;
}

// ---- external-audio queue: one clip at a time, in order; a takeover empties it ----

interface Playing {
  audio: HTMLAudioElement;
  stop: () => void;
}
let playing: Playing | null = null;
let queueTail: Promise<void> = Promise.resolve();
let queueGeneration = 0;

/** Stops every voice: the browser engine and any external clip, queued or playing. */
export function stopAllSpeech(): void {
  queueGeneration++;
  queueTail = Promise.resolve();
  if (playing) playing.stop();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

/**
 * Speaks `parsed.text`, firing span handlers from the engine's word boundaries;
 * with no boundary events (some voices, no engine) an estimate paces them instead.
 * Resolves when speech ends or `isCanceled()` turns true.
 */
export async function speak(
  parsed: ParsedSay,
  handlers: SpeakHandlers,
  opts: SpeakOptions = {},
  isCanceled: () => boolean = () => false,
  isFast: () => boolean = () => false,
): Promise<void> {
  if (opts.tts && parsed.text.trim()) {
    // Synthesize right away (the network round trip overlaps whatever is still
    // playing), then take a slot in the playback queue.
    let clip: { blob: Blob; words: TtsWord[] } | null = null;
    try {
      clip = await opts.tts(parsed.text);
    } catch {
      clip = null;
    }
    if (isCanceled()) return;
    if (clip) return playClip(clip, parsed, handlers, opts, isCanceled, isFast);
  }
  return speakWithBrowser(parsed, handlers, opts, isCanceled, isFast);
}

function anchorTables(parsed: ParsedSay) {
  const starts = new Map<number, AnchorSpan[]>();
  const ends = new Map<number, AnchorSpan[]>();
  for (const s of parsed.spans) {
    const { first, last } = spanWords(parsed, s);
    (starts.get(first) ?? starts.set(first, []).get(first)!).push(s);
    (ends.get(last) ?? ends.set(last, []).get(last)!).push(s);
  }
  return { starts, ends };
}

async function playClip(
  clip: { blob: Blob; words: TtsWord[] },
  parsed: ParsedSay,
  handlers: SpeakHandlers,
  opts: SpeakOptions,
  isCanceled: () => boolean,
  isFast: () => boolean,
): Promise<void> {
  const { starts, ends } = anchorTables(parsed);
  let reached = -1;
  const reach = (i: number) => {
    for (let w = reached + 1; w <= i && w < parsed.words.length; w++) {
      if (w > 0) for (const s of ends.get(w - 1) ?? []) handlers.onSpanEnd?.(s);
      handlers.onWord?.(w);
      for (const s of starts.get(w) ?? []) handlers.onSpanStart?.(s);
      reached = w;
    }
  };
  const finish = () => {
    reach(parsed.words.length - 1);
    if (reached >= 0 && reached < parsed.words.length) for (const s of ends.get(reached) ?? []) handlers.onSpanEnd?.(s);
    reached = parsed.words.length;
  };
  // Word start times by word index (words the alignment missed inherit the previous).
  const wordStart: number[] = parsed.words.map(() => 0);
  for (const w of clip.words) {
    const i = parsed.words.findIndex((x) => x.start === w.charIndex);
    if (i >= 0) wordStart[i] = w.t0;
  }
  for (let i = 1; i < wordStart.length; i++) if (wordStart[i] < wordStart[i - 1]) wordStart[i] = wordStart[i - 1];
  // No alignment (a model without timestamps): spread the words over the clip's
  // duration by character position, once the duration is known.
  const estimateFromDuration = (duration: number) => {
    if (clip.words.length > 0 || !Number.isFinite(duration) || duration <= 0) return;
    const total = Math.max(1, parsed.text.length);
    for (let i = 0; i < parsed.words.length; i++) wordStart[i] = (parsed.words[i].start / total) * duration;
  };

  if (opts.takeover) stopAllSpeech();
  const gen = queueGeneration;
  const mySlot = queueTail;
  let release!: () => void;
  queueTail = new Promise<void>((r) => (release = r));
  try {
    await mySlot;
    if (gen !== queueGeneration || isCanceled()) return;
    await new Promise<void>((resolve) => {
      const url = URL.createObjectURL(clip.blob);
      const audio = new Audio(url);
      let done = false;
      let raf: number | null = null;
      const end = () => {
        if (done) return;
        done = true;
        if (raf != null) cancelAnimationFrame(raf);
        clearInterval(poll);
        if (playing && playing.audio === audio) playing = null;
        URL.revokeObjectURL(url);
        finish();
        resolve();
      };
      const stop = () => {
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
        end();
      };
      playing = { audio, stop };
      const tick = () => {
        if (done) return;
        const t = audio.currentTime;
        let i = reached;
        while (i + 1 < wordStart.length && wordStart[i + 1] <= t + 0.02) i++;
        if (i > reached) reach(i);
        raf = requestAnimationFrame(tick);
      };
      const poll = setInterval(() => {
        if (done) return;
        if (isCanceled() || isFast()) stop();
      }, 50);
      audio.onended = end;
      audio.onerror = end;
      audio.onloadedmetadata = () => estimateFromDuration(audio.duration);
      audio.onplay = () => {
        estimateFromDuration(audio.duration);
        raf = requestAnimationFrame(tick);
      };
      audio.play().catch(() => end());
    });
  } finally {
    release();
  }
}

function speakWithBrowser(
  parsed: ParsedSay,
  handlers: SpeakHandlers,
  opts: SpeakOptions = {},
  isCanceled: () => boolean = () => false,
  isFast: () => boolean = () => false,
): Promise<void> {
  const cps = opts.estimatedCharsPerSec ?? 15;
  const starts = new Map<number, AnchorSpan[]>();
  const ends = new Map<number, AnchorSpan[]>();
  for (const s of parsed.spans) {
    const { first, last } = spanWords(parsed, s);
    (starts.get(first) ?? starts.set(first, []).get(first)!).push(s);
    (ends.get(last) ?? ends.set(last, []).get(last)!).push(s);
  }
  let reached = -1;
  const reach = (i: number) => {
    // Words may be skipped by the engine; fire everything up to i in order.
    for (let w = reached + 1; w <= i && w < parsed.words.length; w++) {
      if (w > 0) for (const s of ends.get(w - 1) ?? []) handlers.onSpanEnd?.(s);
      handlers.onWord?.(w);
      for (const s of starts.get(w) ?? []) handlers.onSpanStart?.(s);
      reached = w;
    }
  };
  const finish = () => {
    reach(parsed.words.length - 1);
    if (reached >= 0 && reached < parsed.words.length) for (const s of ends.get(reached) ?? []) handlers.onSpanEnd?.(s);
    reached = parsed.words.length;
  };

  return new Promise((resolve) => {
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const end = () => {
      if (done) return;
      done = true;
      timers.forEach((t) => clearTimeout(t));
      finish();
      resolve();
    };
    // Estimated pacing: a timer per word, skipped once real boundaries show up.
    let sawBoundary = false;
    const schedule = () => {
      for (let i = 0; i < parsed.words.length; i++) {
        const at = (parsed.words[i].start / cps) * 1000;
        timers.push(
          setTimeout(() => {
            if (!sawBoundary && !done) reach(i);
          }, at),
        );
      }
    };
    const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    if (!synth || !parsed.text.trim()) {
      schedule();
      timers.push(setTimeout(end, (parsed.text.length / cps) * 1000 + 50));
      const fastPoll = setInterval(() => {
        if (done) clearInterval(fastPoll);
        else if (isFast() || isCanceled()) {
          clearInterval(fastPoll);
          end();
        }
      }, 50);
      return;
    }
    const u = new SpeechSynthesisUtterance(parsed.text);
    if (opts.rate) u.rate = opts.rate;
    if (opts.voiceName) {
      const v = synth.getVoices().find((v) => v.name === opts.voiceName);
      if (v) u.voice = v;
    }
    u.onstart = () => schedule();
    u.onboundary = (ev) => {
      if (ev.name && ev.name !== 'word') return;
      sawBoundary = true;
      const i = parsed.words.findIndex((w) => w.start <= ev.charIndex && ev.charIndex < w.end);
      if (i >= 0) reach(i);
    };
    u.onend = end;
    u.onerror = end;
    // The engine does not always report an utterance that was cut (synth.cancel()
    // from a takeover) or one that was still queued when it happened: no onend, no
    // onerror. So also finish when the engine has been silent for a moment.
    let quietMs = 0;
    const poll = setInterval(() => {
      if (done) {
        clearInterval(poll);
        return;
      }
      if (isCanceled() || isFast()) {
        // Canceled: stop. Fast-forward: stop talking, but still fire what was anchored.
        synth.cancel();
        clearInterval(poll);
        end();
        return;
      }
      if (!synth.speaking && !synth.pending) {
        quietMs += 50;
        if (quietMs >= 300) {
          clearInterval(poll);
          end();
        }
      } else quietMs = 0;
    }, 50);
    if (opts.takeover) synth.cancel();
    synth.speak(u);
  });
}
