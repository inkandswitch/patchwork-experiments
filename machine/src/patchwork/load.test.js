// The game a file makes (load.js gameOf): every kind of name against every
// kind of bytes.
import { gameOf, doomArgs, doomWads, portsOf } from "./load.js";

/** A WAD of empty lumps with these names, of type `magic`. */
function wad(magic, names) {
  const out = new Uint8Array(12 + 16 * names.length);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode(magic), 0);
  v.setInt32(4, names.length, true);
  v.setInt32(8, 12, true);
  names.forEach((n, i) => out.set(new TextEncoder().encode(n), 12 + 16 * i + 8));
  return out;
}

const BYTES = {
  episodes: wad("IWAD", ["E1M1", "THINGS"]),
  noEpisodes: wad("IWAD", ["MAP01", "THINGS"]),
  pwad: wad("PWAD", ["E1M1"]),
  rom: new Uint8Array(256).fill(7),
  empty: new Uint8Array(),
};
const NAMES = ["game.sfc", "Game.SMC", "doom.wad", "DOOM.WAD", "notes.txt", "noext", "", "a.b.sfc"];

test("a ROM is its own content, an IWAD boots its first map for 4 players, anything else makes no game", () => {
  let cases = 0;
  for (const name of NAMES)
    for (const [what, raw] of Object.entries(BYTES)) {
      const g = gameOf(name, raw);
      const ext = name.split(".").length > 1 ? name.split(".").pop().toLowerCase() : "";
      if ((ext === "sfc" || ext === "smc") && raw.length) {
        expect(g).toEqual({ kind: "snes", title: name.replace(/\.[^.]+$/, ""), content: raw });
      } else if (ext === "wad" && (what === "episodes" || what === "noEpisodes")) {
        expect(g.kind).toBe("doom");
        expect(doomWads(g.content)).toEqual([raw]);
        expect(doomArgs(g.content)).toEqual(["-skill", "3", "-warp", ...(what === "episodes" ? ["1", "1"] : ["1"]), "-players", "4"]);
        expect(portsOf("doom", g.content)).toBe(4);
        expect(g.title).toBe(`${name.replace(/\.[^.]+$/, "")} · ${what === "episodes" ? "E1M1" : "MAP01"} · 4p`);
      } else expect(g).toBe(null);
      cases++;
    }
  expect(cases).toBe(NAMES.length * Object.keys(BYTES).length);
  expect(doomArgs(gameOf("d.wad", BYTES.episodes, { players: 2, skill: 5 }).content)).toEqual(["-skill", "5", "-warp", "1", "1", "-players", "2"]);
});
