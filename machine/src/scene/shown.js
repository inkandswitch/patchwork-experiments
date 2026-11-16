// What a machine's screen in a scene shows each frame, and the note under it.
// Pure: extension.js asks these every frame and draws what they answer.

import { blank } from "../present/poster.js";

/** The note under a stopped screen nobody holds a port of: how to start it. */
export const STOPPED = "Stopped while nobody plays: click it, or point at it and press P";

/**
 * This frame's picture for a machine's screen. `now` is the engine's picture
 * this frame (null where it drew none), and becomes the `last` kept; a
 * machine that isn't running whose last picture is blank (poster.js `blank`)
 * shows `poster()` instead (null while it's being found, which keeps what's
 * shown), and `poster` is asked only then (asking starts the search).
 * → { last, show }: the picture to keep, and the one to show (null keeps
 * what's shown: Screen.show).
 */
export function screenShows({ running, now, last, poster }) {
  const kept = now ?? last;
  return { last: kept, show: !running && blank(kept) ? poster() : now };
}

/**
 * The note under a machine's screen, once it has started (`started`): none
 * while it runs or the world is paused (the world's pause says so already);
 * "Paused" while someone holds a port (`holders`, the session's); else how
 * to start it (STOPPED).
 */
export function stoppedNote({ started, running, world, holders }) {
  if (!started || running || !world) return null;
  return holders.some(Boolean) ? "Paused" : STOPPED;
}
