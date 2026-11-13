// Plays what the host delivers (host.output(): each tick once, in order).
// The SNES's PCM is queued as it comes; Doom's sound events are played from
// the WAD's own sound lumps at Doom's distance and stereo rules, and its
// music by its own OPL code (doom-music.js). Corrections are not replayed:
// a sound already heard stays heard, as in any rollback game.
import { events, sounds as decodeSounds, lumps, listener, QUERY } from "../doom.js";
import { music as doomMusic } from "../doom-music.js";

const AHEAD = 0.06; // seconds of scheduling slack

export async function audio({ kind, wads, musicWasm }) {
  const ctx = new AudioContext();
  const out = ctx.createGain();
  out.gain.value = 0.8;
  out.connect(ctx.destination);
  let at = 0; // when the next queued chunk starts
  const queue = (samples, rate, channels) => {
    const n = samples.length / channels;
    if (!n) return;
    const buf = ctx.createBuffer(channels, n, rate);
    for (let c = 0; c < channels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < n; i++) ch[i] = samples[i * channels + c];
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(out);
    at = Math.max(at, ctx.currentTime + AHEAD);
    src.start(at);
    at += buf.duration;
  };

  let sfx = null, music = null, mrate = 48000;
  const playing = new Map(); // origin handle -> source: a new sound from an origin replaces the old
  if (kind === "doom") {
    sfx = new Map([...decodeSounds(...wads)].map(([name, s]) => {
      const b = ctx.createBuffer(1, s.samples.length, s.rate);
      b.getChannelData(0).set(s.samples);
      return [name, b];
    }));
    music = await doomMusic(musicWasm, lumps(...wads), ctx.sampleRate);
    mrate = ctx.sampleRate;
  }

  // Doom's rules (s_sound.c): full volume within 200 units, silent past
  // 1200; separation by the angle to the source.
  const place = (ev, ear) => {
    if (!ev.origin || !ear) return { gain: ev.volume / 127, pan: 0 };
    const dx = ev.origin.x - ear.x, dy = ev.origin.y - ear.y;
    const d = Math.hypot(dx, dy);
    if (d > 1200) return null;
    const gain = (ev.volume / 127) * (d < 200 ? 1 : (1200 - d) / 1000);
    const pan = d < 1 ? 0 : -Math.sin(Math.atan2(dy, dx) - ear.angle) * 0.75;
    return { gain, pan };
  };
  const sound = (ev, ear) => {
    const b = sfx.get(`DS${ev.name}`) ?? sfx.get(ev.name);
    if (!b) return;
    const p = place(ev, ear);
    if (!p) return;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const g = ctx.createGain();
    g.gain.value = p.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan;
    src.connect(g).connect(pan).connect(out);
    if (ev.origin) {
      playing.get(ev.origin.handle)?.stop();
      playing.set(ev.origin.handle, src);
      src.onended = () => playing.get(ev.origin.handle) === src && playing.delete(ev.origin.handle);
    }
    src.start();
  };

  return {
    resume: () => ctx.resume(),
    /** items: host.output(); engine: for Doom's listener; view: whose ears. */
    play(items, engine, view, hz) {
      let ear = null;
      for (const it of items) {
        if (it.gap) {
          at = 0;
          continue;
        }
        if (it.was) continue; // a correction: already heard
        if (it.audio?.samples?.length) queue(it.audio.samples, it.audio.rate, it.audio.channels);
        if (kind === "doom" && it.events?.length) {
          for (const ev of events(it.events)) {
            if (ev.kind === "music") music.follow(ev);
            else if (ev.kind === "sound") {
              ear ??= (() => {
                const b = engine.query(QUERY.players);
                return b ? listener(b, view) : null;
              })();
              sound(ev, ear);
            } else if (ev.kind === "stop" && ev.origin) playing.get(ev.origin.handle)?.stop();
          }
        }
        if (music) {
          const m = music.render(Math.round(mrate / hz));
          queue(m.samples, m.rate, m.channels);
        }
      }
    },
    close: () => ctx.close(),
  };
}
