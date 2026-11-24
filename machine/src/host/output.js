// What a machine plays, under rollback. Each step leaves an output (ENGINE.md:
// audio samples and engine-defined event bytes), and a re-simulated tick
// leaves another, the same or not. A listener hears each tick once, in order,
// and cannot be made to unhear one. So, the same for every engine:
//
// - A tick is delivered once: when it is confirmed (below the frontier, where
//   no input can change it), or once the head is `lag` ticks past it,
//   whichever comes first. Until then a re-simulation just replaces it.
// - A re-simulation of a delivered tick whose output is the same as what was
//   delivered changes nothing: it is not delivered again.
// - One whose events differ is delivered as a correction, { tick, events,
//   was }, while it is at most `late` ticks old: the engine's interpreter
//   starts late what is new and stops what is gone (for Doom, a sound record
//   that appears or disappears). Older ones are dropped; nobody would hear the
//   difference in time.
// - Samples cannot be corrected, only continued. If the last delivered tick's
//   samples were re-simulated differently, the stream is now on another
//   timeline, and the next tick is crossfaded over its length from what the
//   old timeline would have played next (or, if it never got that far, the
//   last delivered sample held) into the new one. Otherwise the new timeline
//   continues what was delivered exactly, by construction, since its samples
//   up to the boundary are the delivered ones.
// - Ticks more than `stale` behind where the stream should be (`lag` behind
//   the clock) are never delivered: a joiner catching up, a stall. That is a
//   gap, after which the stream fades in from silence.
//
// Nothing here knows about engines or networks; the host calls stepped() as the
// timeline steps, and skip() and deliver() each frame.

export class Outputs {
  #lag;
  #late;
  #stale;
  #next = null; // the first tick not yet delivered or skipped
  #latest = new Map(); // tick -> the newest stepping's output, ticks >= next - late
  #sent = new Map(); // tick -> the output whose events were delivered (or last corrected to)
  #on = null; // the output whose samples the stream last played (a timeline's tick next - 1)
  #ahead = null; // that timeline's output for `next`, if it got that far
  #last = null; // the samples last played, as played
  #gap = false; // the stream restarts from silence
  #queue = [];
  /** Counts, for measuring: delivered, corrected, spliced (crossfades between timelines), skipped (ticks). */
  stats = { delivered: 0, corrected: 0, spliced: 0, skipped: 0 };

  /**
   * @param lag    ticks behind the head at which an unconfirmed tick is delivered
   * @param late   how many ticks back a correction is still delivered
   * @param stale  ticks behind the clock past which ticks are skipped
   */
  constructor({ lag = 0, late = 8, stale = 16 } = {}) {
    this.#lag = lag;
    this.#late = Math.max(1, late);
    this.#stale = stale;
  }

  /** Starts the stream at a tick (where the timeline starts); later calls do nothing. */
  start(tick) {
    this.#next ??= tick;
  }

  /** Whether tick's output is still wanted, so a caller can skip reading it. */
  wants(t) {
    return this.#next !== null && t >= this.#next - this.#late;
  }

  /** The timeline stepped tick t, and this is the output it left. */
  stepped(t, out) {
    if (this.wants(t)) this.#latest.set(t, out);
  }

  /**
   * The clock is at `target`: ticks more than `stale` behind where the
   * stream should be (lag behind the clock, or stale if lag is longer, as
   * when only confirmed ticks are delivered) will not be heard.
   */
  skip(target) {
    const to = target - Math.min(this.#lag, this.#stale);
    if (this.#next === null || this.#next >= to - this.#stale) return;
    this.#queue.push({ gap: [this.#next, to] });
    this.stats.skipped += to - this.#next;
    this.#next = to;
    this.#gap = true;
    this.#prune();
  }

  /** Delivers what is due, with the head at `now` and the frontier at `frontier`. */
  deliver(now, frontier) {
    if (this.#next === null) return;
    // Delivered ticks stepped again with other events: corrections.
    for (let t = this.#next - this.#late; t < this.#next; t++) {
      const sent = this.#sent.get(t);
      const out = this.#latest.get(t);
      if (!sent || !out || out === sent) continue;
      if (!same(out.events, sent.events)) {
        this.#queue.push({ tick: t, events: out.events, was: sent.events });
        this.stats.corrected++;
      }
      this.#sent.set(t, out);
    }
    while (this.#next < now && (this.#next < frontier || this.#next < now - this.#lag)) {
      const t = this.#next;
      const out = this.#latest.get(t);
      if (!out) break;
      let audio = out.audio;
      if (audio && this.#joins(t)) {
        audio = { ...audio, samples: fade(this.#from(), audio) };
        if (!this.#gap) this.stats.spliced++;
      }
      this.#queue.push({ tick: t, audio, events: out.events });
      this.#sent.set(t, out);
      if (audio) [this.#on, this.#last, this.#gap] = [out, audio, false];
      this.#next = t + 1;
      this.stats.delivered++;
    }
    // While the timeline still continues what was played, remember how.
    if (!this.#joins(this.#next)) this.#ahead = this.#latest.get(this.#next) ?? null;
    this.#prune();
  }

  /** Everything delivered since the last call, in order. */
  take() {
    return this.#queue.splice(0);
  }

  // Whether tick t's samples would not continue what was played: after a gap,
  // or when tick t - 1 has been stepped again with other samples.
  #joins(t) {
    if (this.#gap) return true;
    const prev = this.#latest.get(t - 1);
    const on = this.#on;
    return !!(on && prev && prev !== on && !same(prev.audio?.samples, on.audio?.samples));
  }

  // What the played stream would have gone on with: the old timeline's next
  // tick, or else the last frame played, held; silence after a gap.
  #from() {
    if (this.#gap) return null;
    if (this.#ahead?.audio) return this.#ahead.audio;
    const l = this.#last;
    const c = l.channels;
    const n = l.samples.length / c;
    return { channels: c, samples: n ? l.samples.subarray((n - 1) * c, n * c) : new Float32Array(c) };
  }

  #prune() {
    const low = this.#next - this.#late;
    for (const t of this.#latest.keys()) if (t < low) this.#latest.delete(t);
    for (const t of this.#sent.keys()) if (t < low) this.#sent.delete(t);
  }
}

/**
 * Linear crossfade over the length of `to`: frame i is (1 - w) of `from` and
 * w = (i + 1) / n of `to`, so the last frame is `to`'s own. `from` shorter
 * than `to` holds its last frame; null is silence.
 */
export function fade(from, to) {
  const c = to.channels;
  const n = to.samples.length / c;
  const out = new Float32Array(to.samples.length);
  const m = from && from.channels === c ? from.samples.length / c : 0;
  for (let i = 0; i < n; i++) {
    const w = (i + 1) / n;
    const j = Math.min(i, m - 1);
    for (let k = 0; k < c; k++) {
      const a = m ? from.samples[j * c + k] : 0;
      out[i * c + k] = (1 - w) * a + w * to.samples[i * c + k];
    }
  }
  return out;
}

function same(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return !a?.length && !b?.length;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
