// What a machine's screen shows each frame and the note under it (shown.js),
// over their whole domains: running or not × this frame's picture (none,
// blank, drawn) × the last one kept (none, blank, drawn) × the poster (none
// yet, found); and started or not × running or not × the world running or
// paused × every holding of two ports.
import { screenShows, stoppedNote, STOPPED } from "./shown.js";

const pic = (rgba) => ({ width: 2, height: 1, rgba: new Uint8Array(rgba) });
const PICTURES = { none: null, blank: pic([9, 9, 9, 255, 9, 9, 9, 255]), drawn: pic([0, 0, 0, 255, 200, 10, 10, 255]) };

test("screenShows: the picture drawn now is kept; a stopped screen whose kept picture is blank shows the poster (asked only then), else what's drawn now", () => {
  const POSTER = { none: null, found: pic([1, 2, 3, 255, 4, 5, 6, 255]) };
  let cases = 0;
  for (const running of [true, false])
    for (const [nowName, now] of Object.entries(PICTURES))
      for (const [lastName, last] of Object.entries(PICTURES))
        for (const [posterName, poster] of Object.entries(POSTER)) {
          let asked = 0;
          const got = screenShows({ running, now, last, poster: () => (asked++, poster) });
          const kept = now ?? last;
          const keptBlank = (now ? nowName : lastName) !== "drawn";
          const usePoster = !running && keptBlank;
          const label = [running, nowName, lastName, posterName];
          expect([label, got.last, got.show, asked]).toEqual([label, kept, usePoster ? poster : now, usePoster ? 1 : 0]);
          cases++;
        }
  expect(cases).toBe(2 * 3 * 3 * 2);
});

test("stoppedNote: none until started, while running, or while the world is paused; Paused while a port is held; else how to start it", () => {
  const HOLDINGS = [[null, null], [{ by: "a" }, null], [null, { by: "b" }], [{ by: "a" }, { by: "b" }], []];
  let cases = 0;
  for (const started of [true, false])
    for (const running of [true, false])
      for (const world of [true, false])
        for (const holders of HOLDINGS) {
          const want = !started || running || !world ? null : holders.some(Boolean) ? "Paused" : STOPPED;
          expect([started, running, world, holders, stoppedNote({ started, running, world, holders })]).toEqual([started, running, world, holders, want]);
          cases++;
        }
  expect(cases).toBe(2 * 2 * 2 * HOLDINGS.length);
  // and the note says both ways in: a click, and P where it's pointed at
  expect(STOPPED).toMatch(/click it/);
  expect(STOPPED).toMatch(/point at it and press P/);
});
