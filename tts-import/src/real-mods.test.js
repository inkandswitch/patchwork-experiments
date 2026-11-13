// @vitest-environment node
// Real mods, from this machine's Tabletop Simulator cache (when there is one:
// ~/Library/Tabletop Simulator/Mods, as the README's probe reads it). Each is
// imported whole, its assets dropped as a folder, and the game it makes is
// checked against the format: valid, every image and model a piece names is a
// file doc the import stored, every card in a deck a card, every
// seat's hand a hand. Nothing is sampled: the same five mods every time.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runImport, source } from "./importer.js";
import { FakeRepo } from "./test/fake-repo.js";
import { validate, errorText } from "./test/contract/validate.js";

const MODS = join(homedir(), "Library", "Tabletop Simulator", "Mods");
/**
 * Five mods with decks, bags, dice and seats between them (Workshop ids), and
 * what each must make. The first three are the ones whose assets this
 * machine's cache holds (`cached`: at least that many found there); the other two have their
 * JSON and next to none of their files, so they check the translation alone.
 */
const CASES = [
  { id: "3477136430", name: "Earthborne Rangers [By iakona]", decks: 21, seats: 4, cached: 32 },
  { id: "2899603882", name: "Earthborne Rangers Demo", decks: 16, seats: 4, cached: 13 },
  { id: "3307604810", name: "Frosthaven Enhanced", decks: 164, seats: 5, cached: 145 },
  { id: "2282689090", name: "The Search For Planet X", decks: 0, seats: 4 },
  { id: "2099164206", name: "Mantis Falls", decks: 15, seats: 3 },
];
const present = CASES.filter((c) => existsSync(join(MODS, "Workshop", `${c.id}.json`)));

/** The cache's asset folders as dropped files (only those the mod refers to are ever read). */
function cacheSources() {
  const out = [];
  for (const dir of ["Images", "Models", "Images Raw", "Models Raw", "PDF"]) {
    const d = join(MODS, dir);
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) out.push(source(`Mods/${dir}/${name}`, 0, async () => new Uint8Array(readFileSync(join(d, name)))));
  }
  return out;
}

describe.skipIf(!present.length)(`real mods from the TTS cache (${present.length} of ${CASES.length} here)`, () => {
  const assets = present.length ? cacheSources() : [];
  for (const c of present) {
    it(`${c.name} (${c.id}): a valid game, its assets stored, its cards kept, its seats with hands`, async () => {
      const json = join(MODS, "Workshop", `${c.id}.json`);
      const repo = new FakeRepo();
      const sources = [source(`Mods/Workshop/${c.id}.json`, statSync(json).size, async () => new Uint8Array(readFileSync(json))), ...assets];
      const { game, report, gameUrl } = await runImport({ sources, repo, settings: { fetchMissing: false } });
      const r = validate(game);
      expect(r.ok, errorText(r).slice(0, 2000)).toBe(true);
      expect(game.origin.tts.workshopId).toBe(c.id);
      expect(repo.handles.get(gameUrl).doc()["@patchwork"].type).toBe("tabletop-game");
      // what pieces name is stored, each stored file saying where it came from
      const stored = new Map(Object.values(report.assets).filter((a) => a.fileUrl).map((a) => [a.fileUrl, a.url]));
      for (const p of Object.values(game.pieces))
        for (const part of p.parts ?? [])
          for (const u of [part.top?.file, part.bottom?.file, part.file, part.texture]) {
            if (!u) continue;
            expect(stored.has(u)).toBe(true);
            expect(repo.handles.get(u).doc().origin).toEqual({ urls: [stored.get(u)] });
          }
      // a cached mod's assets are mostly in the cache
      const a = report.counts.assets;
      if (c.cached) expect(a.cache).toBeGreaterThanOrEqual(c.cached);
      // decks: every card a card
      const decks = [];
      const walk = (things) => things.forEach((t) => (t.deck ? decks.push(t.deck) : null, walk(t.contents ?? [])));
      walk(game.setup);
      expect(decks.length).toBeGreaterThanOrEqual(c.decks);
      for (const d of decks) for (const k of d.cards) expect(typeof game.pieces[k].back).toBe("string");
      // seats: one hand each, a zone placed for it
      expect(Object.keys(game.seats ?? {})).toHaveLength(c.seats);
      for (const sid of Object.keys(game.seats ?? {})) expect(game.setup.filter((t) => t.seat === sid && game.pieces[t.piece].zone)).toHaveLength(1);
      console.log(`${c.name}: ${report.counts.placed} placed, ${report.counts.pieces} pieces, ${report.counts.cards} cards in ${report.counts.decks} decks, ${report.counts.bags} bags, ${report.counts.dice} dice, ${report.counts.seats} seats; assets ${a.cache}/${a.needed} from the cache`);
    }, 120_000);
  }
});
