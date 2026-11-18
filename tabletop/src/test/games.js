// For tests: this package's games (games/*.json), registered as the package
// registers them, and an in-memory repo.

import { plugins } from "../index.js";
import lostCities from "../../games/lost-cities.json" with { type: "json" };
import santorini from "../../games/santorini.json" with { type: "json" };
import dominoes from "../../games/draw-dominoes.json" with { type: "json" };
import { applyVariant } from "../../contract/v2/validate.js";

/** The games, and Draw Dominoes as each of its variants sets it up (`draw-dominoes-2` …: the game for that many). */
export const GAMES = Object.freeze({
  "lost-cities": lostCities,
  santorini,
  "draw-dominoes": dominoes,
  ...Object.fromEntries([2, 3, 4].map((n) => [`draw-dominoes-${n}`, applyVariant(dominoes, `${n} players`)])),
});

/** A fresh copy of a built-in game. */
export const game = (id) => structuredClone(GAMES[id]);

/** The package's own `tabletop:game` plugins (index.js), as a registry would list them. */
export const gamePlugins = () => plugins.filter((p) => p.type === "tabletop:game");

/** A doc handle and repo that keep docs in memory. */
export function fakeRepo() {
  const docs = new Map();
  let n = 0;
  const handleFor = (url) => ({
    url,
    doc: () => docs.get(url),
    change(fn) {
      const d = structuredClone(docs.get(url));
      fn(d);
      docs.set(url, d);
    },
  });
  return {
    docs,
    async create2(init) {
      const url = `automerge:doc${n++}`;
      docs.set(url, structuredClone(init));
      return handleFor(url);
    },
    async find(url) {
      if (!docs.has(url)) throw new Error("unavailable");
      return handleFor(url);
    },
    handleFor,
  };
}

/** Deterministic random numbers, for shuffles. */
export function seeded(seed = 1) {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646;
}
