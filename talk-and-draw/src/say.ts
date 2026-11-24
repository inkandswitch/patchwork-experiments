/**
 * Speech with word anchors. The AI's text carries inline markers,
 *   "I'll move {s1}this window{/} over {p2}here{/}."
 * and the executor fires the steps anchored to `s1` when the TTS reaches "this",
 * ending them when "window" has been spoken.
 *
 * Every sentence — narration, progress notes, `say` steps — goes through ONE queue
 * and plays in the order it was asked for: a sentence reserves its place the moment
 * `speak` is called and synthesizes meanwhile, so the network round trip overlaps
 * whatever is still playing and nothing jumps the line. ElevenLabs (word times from
 * the API's alignment), the browser's speechSynthesis (word boundary events), and
 * mute (an estimate paces the anchors) all drive the same handlers.
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
  /** Called when the speech actually starts playing (after any queue wait). */
  onStart?(): void;
  /** Called as each word starts (index into parsed.words). */
  onWord?(index: number): void;
  /** `expectedMs`: how long the span's words will take to say, when the voice knows. */
  onSpanStart?(span: AnchorSpan, expectedMs?: number): void;
  onSpanEnd?(span: AnchorSpan): void;
}

export interface TtsWord {
  charIndex: number;
  t0: number;
  t1: number;
}

export interface TtsClip {
  blob: Blob;
  words: TtsWord[];
}

export interface SpeakOptions {
  rate?: number;
  voiceName?: string;
  /** chars/s used to estimate word timing when the engine gives no boundary events */
  estimatedCharsPerSec?: number;
  /** Cut whatever is speaking or queued and start now. Default: queue behind what is
   *  already speaking — sentences play in the order they were asked for. */
  takeover?: boolean;
  /** An external voice (ElevenLabs): audio plus word times. `previous` is the sentence
   *  queued before this one, for prosody continuity. null → the browser's engine. */
  tts?: (text: string, previous?: string) => Promise<TtsClip | null>;
  /** No sound at all: anchors are paced by the estimate, onStart fires at once. */
  mute?: boolean;
}

// ---- the queue: one sentence at a time, in the order asked; a takeover empties it ----

interface Playing {
  stop: () => void;
}
let playing: Playing | null = null;
let queueTail: Promise<void> = Promise.resolve();
let queueGeneration = 0;
/** The text of the last sentence queued (what the next one follows). */
let lastQueuedText = '';
/** An external voice that takes longer than this hands the sentence to the browser. */
export const TTS_TIMEOUT_MS = 8000;

/** The last sentence queued for speech, so a batch synthesized ahead can follow on from it. */
export function lastQueuedSpeech(): string {
  return lastQueuedText;
}

/** Stops every voice: the browser engine, any external clip (queued or playing), and
 *  a muted sentence being paced. */
export function stopAllSpeech(): void {
  queueGeneration++;
  queueTail = Promise.resolve();
  if (playing) playing.stop();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
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
  if (opts.takeover) stopAllSpeech();
  // Reserve a place in line NOW — order of asking is order of speaking — and
  // synthesize meanwhile, so the round trip overlaps whatever is still playing.
  const gen = queueGeneration;
  const mySlot = queueTail;
  let release!: () => void;
  queueTail = new Promise<void>((r) => (release = r));
  const previous = lastQueuedText;
  lastQueuedText = parsed.text;
  const clipP: Promise<TtsClip | null> =
    !opts.mute && opts.tts && parsed.text.trim()
      ? withTimeout(
          opts.tts(parsed.text, previous).catch(() => null),
          TTS_TIMEOUT_MS,
          null,
        )
      : Promise.resolve(null);
  try {
    await mySlot;
    if (gen !== queueGeneration || isCanceled()) return;
    if (opts.mute) return await paceSilently(parsed, handlers, opts, isCanceled, isFast);
    const clip = await clipP;
    if (gen !== queueGeneration || isCanceled()) return;
    if (clip) return await playClip(clip, parsed, handlers, opts, isCanceled, isFast);
    return await speakWithBrowser(parsed, handlers, opts, isCanceled, isFast);
  } finally {
    release();
  }
}

/**
 * Fires the handlers in word order, never skipping one: `reach(i)` catches up to
 * word i (spans ending before it, each word, spans starting on it), `finish()` runs
 * everything left. `spanMs(first, last)` says how long a span's words will take.
 */
function anchorDriver(parsed: ParsedSay, handlers: SpeakHandlers, spanMs: (first: number, last: number) => number | undefined) {
  const starts = new Map<number, AnchorSpan[]>();
  const ends = new Map<number, AnchorSpan[]>();
  for (const s of parsed.spans) {
    const { first, last } = spanWords(parsed, s);
    (starts.get(first) ?? starts.set(first, []).get(first)!).push(s);
    (ends.get(last) ?? ends.set(last, []).get(last)!).push(s);
  }
  let reached = -1;
  const reach = (i: number) => {
    for (let w = reached + 1; w <= i && w < parsed.words.length; w++) {
      if (w > 0) for (const s of ends.get(w - 1) ?? []) handlers.onSpanEnd?.(s);
      handlers.onWord?.(w);
      for (const s of starts.get(w) ?? []) {
        const { first, last } = spanWords(parsed, s);
        handlers.onSpanStart?.(s, spanMs(first, last));
      }
      reached = w;
    }
  };
  const finish = () => {
    reach(parsed.words.length - 1);
    if (reached >= 0 && reached < parsed.words.length) for (const s of ends.get(reached) ?? []) handlers.onSpanEnd?.(s);
    reached = parsed.words.length;
  };
  return {
    reach,
    finish,
    get reached() {
      return reached;
    },
  };
}

/** Span length from the character count, for voices that give no word times. */
function estimatedSpanMs(parsed: ParsedSay, cps: number) {
  return (first: number, last: number) => ((parsed.words[last].end - parsed.words[first].start) / cps) * 1000;
}

/** Plays one synthesized clip (the queue slot is already ours), driving anchors from its word times. */
function playClip(
  clip: TtsClip,
  parsed: ParsedSay,
  handlers: SpeakHandlers,
  opts: SpeakOptions,
  isCanceled: () => boolean,
  isFast: () => boolean,
): Promise<void> {
  // Word start times by word index (words the alignment missed inherit the previous).
  const wordStart: number[] = parsed.words.map(() => 0);
  for (const w of clip.words) {
    const i = parsed.words.findIndex((x) => x.start === w.charIndex);
    if (i >= 0) wordStart[i] = w.t0;
  }
  for (let i = 1; i < wordStart.length; i++) if (wordStart[i] < wordStart[i - 1]) wordStart[i] = wordStart[i - 1];
  let clipDuration = NaN;
  // No alignment (a model without timestamps): spread the words over the clip's
  // duration by character position, once the duration is known.
  const estimateFromDuration = (duration: number) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    clipDuration = duration;
    if (clip.words.length > 0) return;
    const total = Math.max(1, parsed.text.length);
    for (let i = 0; i < parsed.words.length; i++) wordStart[i] = (parsed.words[i].start / total) * duration;
  };
  const cps = opts.estimatedCharsPerSec ?? 15;
  const estimate = estimatedSpanMs(parsed, cps);
  const driver = anchorDriver(parsed, handlers, (first, last) => {
    const t0 = wordStart[first];
    const t1 = last + 1 < wordStart.length ? wordStart[last + 1] : clipDuration;
    return Number.isFinite(t1) && t1 > t0 ? (t1 - t0) * 1000 : estimate(first, last);
  });

  return new Promise<void>((resolve) => {
    const url = URL.createObjectURL(clip.blob);
    const audio = new Audio(url);
    let done = false;
    let raf: number | null = null;
    const end = () => {
      if (done) return;
      done = true;
      if (raf != null) cancelAnimationFrame(raf);
      clearInterval(poll);
      if (playing && playing.stop === stop) playing = null;
      URL.revokeObjectURL(url);
      driver.finish();
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
    playing = { stop };
    const tick = () => {
      if (done) return;
      const t = audio.currentTime;
      let i = driver.reached;
      while (i + 1 < wordStart.length && wordStart[i + 1] <= t + 0.02) i++;
      if (i > driver.reached) driver.reach(i);
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
    handlers.onStart?.();
    audio.play().catch(() => end());
  });
}

/** Mute: no engine; the words are paced by the estimate so anchored steps still happen. */
function paceSilently(
  parsed: ParsedSay,
  handlers: SpeakHandlers,
  opts: SpeakOptions,
  isCanceled: () => boolean,
  isFast: () => boolean,
): Promise<void> {
  const cps = opts.estimatedCharsPerSec ?? 15;
  const driver = anchorDriver(parsed, handlers, estimatedSpanMs(parsed, cps));
  return new Promise((resolve) => {
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const end = () => {
      if (done) return;
      done = true;
      timers.forEach((t) => clearTimeout(t));
      clearInterval(poll);
      if (playing && playing.stop === end) playing = null;
      driver.finish();
      resolve();
    };
    playing = { stop: end };
    handlers.onStart?.();
    for (let i = 0; i < parsed.words.length; i++) timers.push(setTimeout(() => driver.reach(i), (parsed.words[i].start / cps) * 1000));
    timers.push(setTimeout(end, (parsed.text.length / cps) * 1000 + 50));
    const poll = setInterval(() => {
      if (isCanceled() || isFast()) end();
    }, 50);
  });
}

function speakWithBrowser(
  parsed: ParsedSay,
  handlers: SpeakHandlers,
  opts: SpeakOptions = {},
  isCanceled: () => boolean = () => false,
  isFast: () => boolean = () => false,
): Promise<void> {
  const cps = opts.estimatedCharsPerSec ?? 15;
  const driver = anchorDriver(parsed, handlers, estimatedSpanMs(parsed, cps));

  return new Promise((resolve) => {
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const end = () => {
      if (done) return;
      done = true;
      timers.forEach((t) => clearTimeout(t));
      if (playing && playing.stop === end) playing = null;
      driver.finish();
      resolve();
    };
    // Estimated pacing: a timer per word, skipped once real boundaries show up.
    let sawBoundary = false;
    const schedule = () => {
      for (let i = 0; i < parsed.words.length; i++) {
        const at = (parsed.words[i].start / cps) * 1000;
        timers.push(
          setTimeout(() => {
            if (!sawBoundary && !done) driver.reach(i);
          }, at),
        );
      }
    };
    const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
    if (!synth || !parsed.text.trim()) {
      playing = { stop: end };
      handlers.onStart?.();
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
    u.onstart = () => {
      handlers.onStart?.();
      schedule();
    };
    u.onboundary = (ev) => {
      if (ev.name && ev.name !== 'word') return;
      sawBoundary = true;
      const i = parsed.words.findIndex((w) => w.start <= ev.charIndex && ev.charIndex < w.end);
      if (i >= 0) driver.reach(i);
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
    playing = {
      stop: () => {
        synth.cancel();
        end();
      },
    };
    synth.speak(u);
  });
}
