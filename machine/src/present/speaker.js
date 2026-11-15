// A machine's speaker: what it plays (host.output()) made audible on one
// AudioContext, through sound.js. The same for the Machine tool and a scene;
// they differ only in where it comes out (`out`): the context's destination
// for the tool, a panner at the screen in a scene.
//
// The kind decides how its output is heard:
// - Doom: its sound events, from the WAD's own lumps, mixed as Doom mixes
//   them for one player (sound.js screen(): the player whose view the screen
//   shows, so what you hear is what that picture would sound like), and its
//   music by its own OPL code (doom-music.js);
// - any other engine (the Super NES): its PCM stream (sound.js Stream).
//
// Doom's mix needs the player's eyes and where the things making sounds are
// now. Both are read from the host's state (host.query) on the frame they are
// needed, at most once a frame each, and only while a sound is playing: a
// query copies the state.

import { Stream, doom, screen } from "./sound.js";
import { sounds as doomSounds, lumps, listener, things, QUERY } from "../doom.js";
import { music as doomMusic } from "../doom-music.js";

/**
 * @param ctx           an AudioContext
 * @param o.kind        "doom", or any other engine (a PCM stream)
 * @param o.wads        Doom's WADs (load.js doomWads(content))
 * @param o.musicWasm   Doom's music player (engines/doom/dist/music.wasm), or none: no music
 * @param o.out         where it plays (default ctx.destination)
 * @param o.port        whose mix (Doom): the player whose view is shown
 * @returns {{ feed(host): void, port: number, close(): void }}  set `port` to hear another player
 */
export async function speaker(ctx, { kind, wads = [], musicWasm = null, out = ctx.destination, port = 0 }) {
  if (kind !== "doom") {
    const stream = new Stream(ctx, { out });
    return {
      port,
      feed(host) {
        for (const item of host.output()) {
          if (item.gap) stream.gap();
          else if (item.audio) stream.push(item.audio);
        }
      },
      close: () => stream.close(),
    };
  }

  const sounds = doomSounds(...wads);
  const music = musicWasm ? await doomMusic(musicWasm, lumps(...wads), ctx.sampleRate) : null;
  let host = null; // the host being fed, this frame
  let ear; // the player's eyes, this frame: undefined until asked
  const eyes = () => {
    if (ear === undefined) {
      const b = host?.query(QUERY.players);
      ear = b ? listener(b, sink.port) : null;
    }
    return ear;
  };
  const make = (p) => doom(ctx, { sounds, route: screen({ port: p, listener: eyes }), out, music });
  const sink = { port, mix: make(port) };
  return {
    get port() {
      return sink.port;
    },
    set port(p) {
      if (p === sink.port) return;
      sink.mix.close();
      sink.port = p;
      sink.mix = make(p);
    },
    feed(h) {
      host = h;
      ear = undefined;
      for (const item of h.output()) sink.mix.push(item);
      if (sink.mix.playing) {
        const b = h.query(QUERY.things);
        if (b) sink.mix.update(things(b));
      }
    },
    close: () => sink.mix.close(),
  };
}
