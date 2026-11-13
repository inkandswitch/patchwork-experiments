// For tests: this package's games (games/*.json), registered as the package
// registers them, and an in-memory repo.

import { plugins } from "../index.js";
import lostCities from "../../games/lost-cities.json" with { type: "json" };
import santorini from "../../games/santorini.json" with { type: "json" };
import dominoes2 from "../../games/draw-dominoes-2.json" with { type: "json" };
import dominoes3 from "../../games/draw-dominoes-3.json" with { type: "json" };
import dominoes4 from "../../games/draw-dominoes-4.json" with { type: "json" };

export const GAMES = Object.freeze({ "lost-cities": lostCities, santorini, "draw-dominoes-2": dominoes2, "draw-dominoes-3": dominoes3, "draw-dominoes-4": dominoes4 });

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
