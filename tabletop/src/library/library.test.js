// The game library: its datatype's init, the launcher's model (pure: the
// folders, listing, naming, which built-in games are missing, a fork's copy),
// and what the launcher does (actions.js) against an in-memory repo: add the
// built-in games (twice: idempotent), start a session (and that it is the
// table the start screen's template lays out), fork it, import a TTS mod.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { GameLibraryDatatype } from "./datatype.js";
import { BAG_TRAIT, descriptionDoc, foldersOf, forkName, forkScene, gamesIn, linksOf, missingBuiltIns, sessionName, sessionsIn, withBags } from "./model.js";
import { cleanObject, copyRules, describesOf } from "./copy-rule.js";
import { addBuiltIns, foldersFor, forkSession, importGame, startSession } from "./actions.js";
import { newSession } from "../table/session.js";
import { setUp } from "../table/template.js";
import { tableLayout, writeTable } from "../setup.js";
import { prepareTable } from "../table/made-with.js";
import { emptyScene } from "../empty-scene.js";
import { fakeRepo, gamePlugins, game as builtIn, seeded } from "../test/games.js";
import { fakeDrop } from "../test/fakes.js";
import { SEATS, inBag, keptIn, registries, seatsPlugin } from "../test/stand-ins.js";
import { inside } from "../bag/contents.js";
import { plugins } from "../index.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => JSON.parse(readFileSync(here(p), "utf8"));
const extensions = plugins.filter((p) => p.type === "scene:extension");
/** What's installed where a library is used: the games, whoever owns seats (a stand-in), this package's extensions. */
const installed = () => {
  const reg = registries(seatsPlugin(), ...gamePlugins(), ...extensions);
  return async (t) => reg[t] ?? null;
};
const RULES = copyRules(describesOf([...extensions, seatsPlugin()]));

/** A library in a fake repo, as the host makes one (init inside the new doc's first change, with the repo). */
function library(repo = fakeRepo()) {
  const doc = {};
  GameLibraryDatatype.init(doc, repo);
  doc["@patchwork"] = { type: "game-library" };
  return { repo, lib: repo.handleFor(repo.create(doc).url) };
}

describe("the game-library datatype", () => {
  it("is made holding two plain folders, Games and Sessions, linked as folders", () => {
    const repo = fakeRepo();
    const doc = {};
    GameLibraryDatatype.init(doc, repo);
    expect(doc.title).toBe("Game library");
    expect(doc.docs.map(({ name, type }) => [name, type])).toEqual([["Games", "folder"], ["Sessions", "folder"]]);
    for (const l of doc.docs) expect(repo.docs.get(l.url)).toEqual({ "@patchwork": { type: "folder" }, title: l.name, docs: [] });
    expect(foldersOf(doc)).toEqual({ games: doc.docs[0].url, sessions: doc.docs[1].url });
    expect(GameLibraryDatatype.getTitle(doc)).toBe("Game library");
    GameLibraryDatatype.setTitle(doc, "Ours");
    expect(GameLibraryDatatype.getTitle(doc)).toBe("Ours");
  });
});

describe("the launcher's model", () => {
  const imm = (s) => ({ val: s, toString: () => s }); // an ImmutableString, as pushwork writes links
  const folder = (...links) => ({ docs: links });

  it("reads a folder's links whatever their strings are, skipping any without a doc's URL", () => {
    const f = folder({ name: imm("a"), type: imm("scene"), url: imm("automerge:a") }, { name: "b", type: "tabletop-game", url: "nope" }, { type: "scene", url: "automerge:c" }, null);
    expect(linksOf(f)).toEqual([{ name: "a", type: "scene", url: "automerge:a" }, { name: "Untitled", type: "scene", url: "automerge:c" }]);
    expect(linksOf({})).toEqual([]);
  });

  it("finds Games and Sessions by name among the folder links (the first of each), and lists each by type, sessions newest first", () => {
    const lib = folder({ name: "Sessions", type: "folder", url: "automerge:s" }, { name: "Games", type: "scene", url: "automerge:x" }, { name: "Games", type: "folder", url: "automerge:g" }, { name: "Games", type: "folder", url: "automerge:g2" });
    expect(foldersOf(lib)).toEqual({ games: "automerge:g", sessions: "automerge:s" });
    expect(foldersOf({})).toEqual({ games: null, sessions: null });
    const f = folder(...["1", "2", "3"].map((n) => ({ name: n, type: "scene", url: `automerge:s${n}` })), { name: "g", type: "tabletop-game", url: "automerge:g" });
    expect(sessionsIn(f).map((l) => l.name)).toEqual(["3", "2", "1"]);
    expect(gamesIn(f).map((l) => l.name)).toEqual(["g"]);
  });

  it("names a session by its game, its variant where there's a choice, and when it started; a fork by its source", () => {
    const at = new Date(2026, 10, 18, 9, 5);
    expect(sessionName("Lost Cities", at)).toBe("Lost Cities, 2026-11-18 09:05");
    expect(sessionName("Draw Dominoes", at, "3 players")).toBe("Draw Dominoes (3 players), 2026-11-18 09:05");
    expect(sessionName("", at)).toBe("Game, 2026-11-18 09:05");
    expect(forkName("Lost Cities, 2026-11-18 09:05")).toBe("Lost Cities, 2026-11-18 09:05 (copy)");
    expect(forkName(forkName("x"))).toBe("x (copy) (copy)");
  });

  it("missing built-ins: exactly the registered games no description names, in registry order, over every subset of three games and every subset already described", () => {
    const ids = ["a", "b", "c"];
    const subsets = [...Array(8).keys()].map((m) => ids.filter((_, i) => m & (1 << i)));
    for (const reg of subsets)
      for (const have of subsets) {
        const descriptions = [...have.map((id) => ({ origin: { builtIn: id } })), { origin: { tts: {} } }, {}];
        const missing = missingBuiltIns(reg.map((id) => ({ id })), descriptions);
        expect(missing.map((p) => p.id)).toEqual(reg.filter((id) => !have.includes(id)));
        // adding them leaves none missing: idempotent
        expect(missingBuiltIns(reg.map((id) => ({ id })), [...descriptions, ...missing.map((p) => ({ origin: { builtIn: p.id } }))])).toEqual([]);
      }
  });

  it("a description is the game, which registered game it is, and a game doc's bookkeeping beside it", () => {
    const g = builtIn("lost-cities");
    const d = descriptionDoc(g, { builtIn: "lost-cities", patchwork: { type: "tabletop-game", suggestedImportUrl: "automerge:pkg" } });
    expect(d).toMatchObject({ "@patchwork": { type: "tabletop-game", suggestedImportUrl: "automerge:pkg" }, title: "Lost Cities", origin: { builtIn: "lost-cities" }, assets: {}, drawn: {}, tables: [] });
    expect(d.pieces).toEqual(g.pieces);
    expect(g.origin).toBeUndefined();
  });
});

describe("a fork's copy (model.js forkScene, by the scene's copy rule)", () => {
  // every combination of what an object may carry that a copy treats specially: 2^7 objects
  const FEATURES = ["claims", "saved", "plainKept", "jointKept", "die", "rendered", "bag"];
  const objectOf = (mask) => {
    const has = (f) => !!(mask & (1 << FEATURES.indexOf(f)));
    const o = { name: `o${mask}`, transform: { position: [mask, 0, 0], rotation: [0, 0, 0], scale: 1 }, sourceUrl: "automerge:glb", traits: { "tabletop.card": {} } };
    if (has("claims")) o.claims = { carry: { by: "viewer:x" } };
    if (has("saved")) o.saved = 7;
    if (has("plainKept")) o.traits["keep.plain"] = { by: "automerge:plain", slot: mask };
    if (has("jointKept")) o.traits["card-table.kept"] = { by: "automerge:deck", slot: mask };
    if (has("die")) o.traits["dice.die"] = { round: { seed: 1 }, face: 3 };
    if (has("rendered")) Object.assign(o, { renderUrl: "automerge:render", providerId: "die" });
    if (has("bag")) o.traits[BAG_TRAIT] = { doc: `automerge:bag${mask}` };
    return o;
  };
  const scene = () => {
    const s = emptyScene({ title: "Lost Cities, 2026-11-18 09:05" });
    for (let m = 0; m < 1 << FEATURES.length; m++) {
      s.objects[`o${m}`] = objectOf(m);
      s.order.push(`o${m}`);
    }
    s.traits[SEATS] = { p1: { name: "Player 1", player: "viewer:a", camera: { position: [0, 1, 1], target: [0, 0, 0] } }, p2: { name: "Player 2", player: null } };
    s.objects.o0.traits[SEATS] = { port: { name: "Port", player: "viewer:b", lasting: false } };
    return s;
  };

  it("keeps every object under its id, all but what is about now; empties every seat; lists the bags; says where it came from", () => {
    const src = scene();
    const before = structuredClone(src);
    const { doc, bags } = forkScene(src, { rules: RULES, url: "automerge:src", heads: ["h1", "h2"] });
    expect(src).toEqual(before); // the session is never written
    expect(doc.order).toEqual(src.order);
    expect(Object.keys(doc.objects)).toEqual(Object.keys(src.objects));
    for (let m = 0; m < 1 << FEATURES.length; m++) {
      const o = doc.objects[`o${m}`];
      const was = src.objects[`o${m}`];
      expect(o).not.toHaveProperty("claims");
      expect(o).not.toHaveProperty("saved");
      // a keeper's binding is about this object in this scene: a copy is a bare back
      expect(o.traits).not.toHaveProperty("keep.plain");
      expect(o.traits).not.toHaveProperty("card-table.kept");
      expect(o.traits["tabletop.card"]).toEqual({});
      // a die's draw is about now; what it shows is kept
      if (was.traits["dice.die"]) expect(o.traits["dice.die"]).toEqual({ face: 3 });
      expect(o.renderUrl ?? null).toBe(null);
      if (was.renderUrl) expect(o.providerId).toBe("die");
      // everything else as it was
      const rest = (x) => {
        const { claims, saved, renderUrl, traits, ...r } = structuredClone(x);
        return r;
      };
      expect(rest(o)).toEqual(rest(was));
      expect(o.traits[BAG_TRAIT]).toEqual(was.traits[BAG_TRAIT]);
    }
    expect(bags).toEqual(Object.keys(src.objects).filter((id) => src.objects[id].traits[BAG_TRAIT]).map((id) => ({ id, url: src.objects[id].traits[BAG_TRAIT].doc })));
    expect(bags).toHaveLength(64);
    expect(doc.traits[SEATS]).toEqual({ p1: { name: "Player 1", player: null, camera: { position: [0, 1, 1], target: [0, 0, 0] } }, p2: { name: "Player 2", player: null } });
    expect(doc.objects.o0.traits[SEATS]).toEqual({ port: { name: "Port", player: null, lasting: false } });
    expect(doc.title).toBe("Lost Cities, 2026-11-18 09:05 (copy)");
    expect(doc.forkedFrom).toEqual({ url: "automerge:src", heads: ["h1", "h2"] });
    // the scene's other parts as they were
    for (const k of ["@patchwork", "assets", "packages", "view", "clock", "dimensions"]) expect(doc[k]).toEqual(src[k]);
  });

  it("a fork of a fork says the fork it came from, and names each bag's copy where it's told", () => {
    const one = forkScene(scene(), { rules: RULES, url: "automerge:src", heads: null }).doc;
    const two = forkScene(one, { rules: RULES, url: "automerge:one", heads: ["h"] }).doc;
    expect(two.forkedFrom).toEqual({ url: "automerge:one", heads: ["h"] });
    const named = withBags(two, { o64: "automerge:copy", o0: "automerge:not-a-bag" });
    expect(named.objects.o64.traits[BAG_TRAIT].doc).toBe("automerge:copy");
    expect(named.objects.o0.traits[BAG_TRAIT]).toBeUndefined();
    expect(two.objects.o64.traits[BAG_TRAIT].doc).toBe("automerge:bag64");
  });
});

describe("the launcher's actions", () => {
  it("Add the built-in games: a description of each registered game in Games, once, however often it's pressed", async () => {
    const { repo, lib } = library();
    const registry = installed();
    const made = await addBuiltIns({ repo, registry, library: lib });
    const { games } = await foldersFor(repo, lib);
    expect(gamesIn(games.doc()).map((l) => [l.name, l.type])).toEqual([["Santorini", "tabletop-game"], ["Lost Cities", "tabletop-game"], ["Draw Dominoes", "tabletop-game"], ["Liar's dice", "tabletop-game"]]);
    expect(made).toEqual(gamesIn(games.doc()).map((l) => l.url));
    for (const l of gamesIn(games.doc())) {
      const d = repo.docs.get(l.url);
      expect(d["@patchwork"].type).toBe("tabletop-game");
      expect(d).toMatchObject({ assets: {}, drawn: {}, tables: [] });
      expect(d.origin.builtIn).toMatch(/^(santorini|lost-cities|draw-dominoes|liars-dice)$/);
    }
    expect(await addBuiltIns({ repo, registry, library: lib })).toEqual([]);
    expect(gamesIn(games.doc())).toHaveLength(4);
  });

  it("New game: a description rendered into a fresh scene, as its variant, linked in Sessions by game and date; the description lists it", async () => {
    const { repo, lib } = library();
    const registry = installed();
    await addBuiltIns({ repo, registry, library: lib });
    const { games, sessions } = await foldersFor(repo, lib);
    const dominoes = repo.handleFor(gamesIn(games.doc()).find((l) => l.name === "Draw Dominoes").url);
    const now = () => new Date(2026, 10, 18, 21, 30);
    const { url, name } = await startSession({ repo, registry, library: lib, game: dominoes, variant: 1, now });
    expect(name).toBe("Draw Dominoes (3 players), 2026-11-18 21:30");
    expect(sessionsIn(sessions.doc())).toEqual([{ name, type: "scene", url }]);
    const scene = repo.docs.get(url);
    expect(scene.title).toBe(name);
    expect(Object.keys(scene.traits[SEATS])).toEqual(["p1", "p2", "p3"]);
    expect(dominoes.doc().tables).toEqual([url]);
    // what the table lays out is drawn into the description, which every session of it shares
    expect(Object.keys(dominoes.doc().drawn).sort()).toEqual(["back", "rack", "table"]);
    // a game without variants is named without one
    const santorini = repo.handleFor(gamesIn(games.doc()).find((l) => l.name === "Santorini").url);
    expect((await startSession({ repo, registry, library: lib, game: santorini, now })).name).toBe("Santorini, 2026-11-18 21:30");
    expect(sessionsIn(sessions.doc()).map((l) => l.name)).toEqual(["Santorini, 2026-11-18 21:30", name]);
    await expect(startSession({ repo, registry, library: lib, game: dominoes, variant: "9 players", now })).rejects.toThrow(/no variant/);
  }, 30_000);

  for (const [id, variant] of [["lost-cities", null], ["santorini", null], ["draw-dominoes", "4 players"]])
    it(`New game lays ${id}${variant ? ` (${variant})` : ""} out as the start screen's template does: the same things, in the same places, kept the same way`, async () => {
      const registry = installed();
      // the template's table, in a scene of its own (its art the scene's files)
      const doc = emptyScene();
      const reg = registries(seatsPlugin(), ...gamePlugins());
      const { ctx, calls } = fakeDrop(doc, { registries: reg });
      await setUp(ctx, id, { variant, rng: seeded(7) });
      // the session's, from a description (its art the description's)
      const repo = fakeRepo();
      const game = repo.handleFor(repo.create(descriptionDoc(builtIn(id), { builtIn: id })).url);
      const { url } = await newSession({ repo, registry, handle: game, variant, rng: seeded(7) });
      const session = repo.docs.get(url);
      // objects in the same order, each the same but for its ids, its file and its About
      const norm = (d) => {
        const index = new Map(d.order.map((oid, i) => [oid, i]));
        return d.order.map((oid) => {
          const { sourceUrl, infoUrl, infoToolId, parent, group, traits, ...o } = structuredClone(d.objects[oid]);
          const k = keptIn(d.objects[oid]);
          const t = { ...traits };
          delete t["keep.plain"];
          delete t["card-table.kept"];
          if (t[BAG_TRAIT]) t[BAG_TRAIT] = "a bag";
          return { ...o, parent: parent == null ? null : index.get(parent), group: group == null ? null : index.get(group), traits: t, kept: k ? [k.kind, k.slot] : null };
        });
      };
      expect(norm(session)).toEqual(norm(doc));
      for (const k of ["view", "dimensions"]) expect(session[k]).toEqual(doc[k]);
      expect(session.traits[SEATS]).toEqual(doc.traits[SEATS]);
      // the containers hold the same cards: by name (the template's names the face's file; the session's, the game and kind)
      const containers = (all) => all.filter((d) => /secure-deck|keep-plain/.test(d?.["@patchwork"]?.type)).map((d) => [d.title, (d.faces ?? d.items ?? []).map((i) => i.name)]);
      expect(containers([...repo.docs.values()])).toEqual(containers(calls.created));
    }, 30_000);

  it("Fork: the session copied by the copy rule (bare backs, empty seats, bags copied), linked as its copy; the session untouched", async () => {
    // a session with one of everything: decks (secure and not), loose cards, a bag holding cards, hands, dice
    const { repo, lib } = library();
    const registry = installed();
    const g = read("../../contract/v2/fixtures/valid/every-feature.json");
    const layout = tableLayout(g, { fileOf: (kind) => ({ url: `automerge:${kind}`, hint: null }), rng: seeded(3) });
    const made = await prepareTable({ repo, registry }, layout);
    const table = emptyScene({ title: "Every feature, 2026-11-18 09:00" });
    writeTable(table, layout, made);
    const sid = Object.keys(table.traits[SEATS])[0];
    table.traits[SEATS][sid].player = "viewer:a";
    const src = repo.create(table);
    const { sessions } = await foldersFor(repo, lib);
    sessions.change((d) => d.docs.push({ name: table.title, type: "scene", url: src.url }));
    const before = structuredClone(src.doc());
    const docsBefore = repo.docs.size;

    const { url, name } = await forkSession({ repo, registry, library: lib, session: sessionsIn(sessions.doc())[0] });
    expect(name).toBe("Every feature, 2026-11-18 09:00 (copy)");
    expect(sessionsIn(sessions.doc()).map((l) => l.name)).toEqual([name, table.title]);
    expect(src.doc()).toEqual(before);
    const fork = repo.docs.get(url);
    expect(fork.forkedFrom).toEqual({ url: src.url, heads: null });
    expect(Object.keys(fork.objects)).toEqual(Object.keys(before.objects));
    expect(Object.values(fork.objects).filter((o) => keptIn(o))).toEqual([]);
    expect(Object.values(fork.traits[SEATS]).map((s) => s.player)).toEqual(Object.values(before.traits[SEATS]).map(() => null));
    // each bag is a doc of its own, holding what the session's held, its cards bare backs too
    const bagIds = Object.keys(before.objects).filter((id) => before.objects[id].traits?.[BAG_TRAIT]);
    expect(bagIds.length).toBeGreaterThan(0);
    for (const id of bagIds) {
      const was = repo.docs.get(before.objects[id].traits[BAG_TRAIT].doc);
      const now = repo.docs.get(fork.objects[id].traits[BAG_TRAIT].doc);
      expect(fork.objects[id].traits[BAG_TRAIT].doc).not.toBe(before.objects[id].traits[BAG_TRAIT].doc);
      expect(inBag(now).map((o) => o.name)).toEqual(inBag(was).map((o) => o.name));
      expect(inBag(now).filter((o) => keptIn(o))).toEqual([]);
      expect(inBag(was).some((o) => keptIn(o))).toBe(true);
      expect(inside(now).map((x) => x.entry.object)).toEqual(inside(was).map((x) => cleanObject(x.entry.object, RULES)));
    }
    // the fork, and a doc for each bag: nothing else
    expect(repo.docs.size - docsBefore).toBe(1 + bagIds.length);
  });

  it("Import: a TTS mod's files → the importer (assets with the mod stored, the rest by URL) → a game in Games", async () => {
    const { repo, lib } = library();
    const dir = here("../../fixtures/tiny-mod");
    const files = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (!/\.md$/.test(e.name)) files.push(p);
      }
    };
    walk(dir);
    const sources = files.map((p) => ({ path: p.slice(dir.length + 1), size: readFileSync(p).byteLength, read: async () => new Uint8Array(readFileSync(p)) }));
    const { url, name, report } = await importGame({ repo, library: lib, sources, shrink: null });
    const { games } = await foldersFor(repo, lib);
    expect(gamesIn(games.doc())).toEqual([{ name, type: "tabletop-game", url }]);
    const game = repo.docs.get(url);
    expect(game["@patchwork"].type).toBe("tabletop-game");
    expect(game.origin.tts.fileName).toMatch(/1234567890\.json$/);
    expect(report.counts.assets.cache).toBeGreaterThan(0);
    expect(report.counts.assets.fetched).toBe(0);
  });
});
