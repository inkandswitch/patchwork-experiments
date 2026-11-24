// Doom's music, made audible: Chocolate Doom's own OPL music player and OPL
// emulator, as a module of their own (engines/doom/music, dist/music.wasm).
// Music is presentation, not simulation: the engine's first event of every
// step names the song that should be playing (doom.js events()), and this
// player follows it. Its state is never in a snapshot, and a peer that
// never plays music stays in the same state as one that does.

/**
 * A player for the songs of WAD files. `lumps` is doom.js lumps(...wads),
 * which must hold GENMIDI (the instruments); `rate` is the output's sample
 * rate.
 *
 *   follow(record)   the engine's music record: plays, switches, pauses, stops
 *   play(name, loops), stop(), pause(paused)
 *   render(frames)   the next frames: { rate, channels: 2, samples: Float32Array }
 *
 * A song starts from its beginning when it starts playing here, so a peer
 * that joins late hears it from the top, as Doom's own player would after
 * loading a save.
 */
export async function music(wasm, lumps, rate = 48000) {
  // Its one import is emscripten's growth notice; memory is read afresh anyway.
  const { instance } = await WebAssembly.instantiate(wasm, { env: { emscripten_notify_memory_growth() {} } });
  const x = instance.exports;
  x._initialize?.();
  const call = (name, ...args) => {
    try {
      return x[name](...args);
    } catch (e) {
      if (!(e instanceof WebAssembly.RuntimeError)) throw e;
      const bytes = new Uint8Array(x.memory.buffer, x.music_fault());
      throw new Error(`music: ${new TextDecoder().decode(bytes.subarray(0, bytes.indexOf(0))) || e.message}`, { cause: e });
    }
  };
  const load = (bytes) => new Uint8Array(x.memory.buffer, x.music_buffer(bytes.length), bytes.length).set(bytes);

  const genmidi = lumps.get("GENMIDI");
  if (!genmidi) throw new Error("music: the WADs have no GENMIDI lump");
  load(genmidi);
  if (call("music_init", rate) !== 0) throw new Error("music: GENMIDI refused");

  let song = null; // { name, loops }
  let paused = false;
  const player = {
    rate,
    get song() {
      return song && { ...song, paused };
    },
    play(name, loops = true) {
      const lump = lumps.get(name);
      if (!lump) throw new Error(`music: no lump ${name}`);
      load(lump);
      if (call("music_play", loops ? 1 : 0) !== 0) throw new Error(`music: ${name} is not a song`);
      song = { name, loops };
      paused = false;
    },
    stop() {
      call("music_stop");
      song = null;
    },
    pause(p) {
      call("music_pause", p ? 1 : 0);
      paused = !!p;
    },
    /** Makes what plays what the engine's music record says should. */
    follow({ name, loops, paused: p }) {
      if (!name) {
        if (song) player.stop();
      } else if (song?.name !== name || song.loops !== loops) player.play(name, loops);
      if (song && paused !== p) player.pause(p);
    },
    render(frames) {
      const at = call("music_render", frames);
      const pcm = new Int16Array(x.memory.buffer, at, frames * 2);
      return { rate, channels: 2, samples: Float32Array.from(pcm, (s) => s / 32768) };
    },
  };
  return player;
}
