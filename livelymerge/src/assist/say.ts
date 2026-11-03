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

/** Strips `{id}` / `{/}` markers and records the spans they delimit. */
export function parseAnchors(raw: string): ParsedSay {
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

export interface SpeakOptions {
  rate?: number;
  voiceName?: string;
  /** chars/s used to estimate word timing when the engine gives no boundary events */
  estimatedCharsPerSec?: number;
}

/**
 * Speaks `parsed.text`, firing span handlers from the engine's word boundaries;
 * with no boundary events (some voices, no engine) an estimate paces them instead.
 * Resolves when speech ends or `isCanceled()` turns true.
 */
export function speak(
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
    const poll = setInterval(() => {
      if (isCanceled() || isFast()) {
        // Canceled: stop. Fast-forward: stop talking, but still fire what was anchored.
        synth.cancel();
        clearInterval(poll);
        end();
      } else if (done) clearInterval(poll);
    }, 50);
    synth.cancel(); // drop anything still queued from a canceled performance
    synth.speak(u);
  });
}
