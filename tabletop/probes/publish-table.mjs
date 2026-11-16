// Publish a game table to a real sync server, and print its Patchwork URLs.
// Two ways, the two ways a table is made:
//
//   node probes/publish-table.mjs [--sync wss://…] [--settle 8000] [--dry-run]
//   node probes/publish-table.mjs --template lost-cities|santorini|dominoes-2 [--sync …] [--dry-run] [--show] [--shots <dir>]
//
// Makes NEW docs on every run (no dedupe).
//
// The game page (default): the Lost Cities game, as the package's own UI
// would make it. A tabletop-game doc holding the Lost Cities game
// (games/lost-cities.json, as "Start from" writes it), every piece's GLB drawn
// into a file doc (pieces.js ensurePieceGLBs, as the game page does while
// open), then "Set up a table" (tool.js setUpTable): tableLayout with the
// game's GLBs, a container per deck from a keeper and the seats from their
// owner (both found, as the game page finds them, by their plugins'
// metadata: here in the BUILT seats, card-table and keep packages, so build
// those first), writeTable onto a skeleton scene doc with every map a scene
// has, the scene doc, and the table listed on the game (its only one: the
// game is new).
//
// --template <game>: the scene's start screen. Needs scene/, seats/,
// tabletop/, card-table/ and keep/ built. In headless Chrome, the BUILT scene tool with the BUILT
// seats, tabletop and keeper plugins is mounted twice on one EMPTY scene
// (template-probe.html; an in-memory repo, two views A and B), and A picks
// the template on the start screen (api.template); B opens it after. It checks:
// - the start screen offers it;
// - doc.assets has a file under its versioned key for every kind, and every
//   object shows one of them (no game doc, no About);
// - the view starts people in the seat body (view.start) and A arrives
//   watching from a seat (every built-in game has seats; Santorini's are
//   its three workers' colours);
// - A's stage lists the package of every plugin the scene calls for, each
//   one this script states (PACKAGES), and names the scene package as the
//   suggested import (the page registers each built package's plugins from
//   its pushwork URL, as a host does, so the list is the stage's own);
// - the deck is kept by the joint keeper (a secure-deck: card-table is
//   installed), every card bound to it by that keeper's own trait;
// - with A and B seated, the deck reaches phase "playing" and each hand's
//   faces reach its player (8 each);
// - nothing failed to load (in either view, once B is there), and the page
//   logged no errors.
// What differs between games is data (TABLES, below), not branches. Draw
// Dominoes for two (dominoes-2) deals nothing (each player draws), so for it:
// - the table lays 2 seats, and the boneyard's 28 tiles are kept by the
//   joint keeper on 28 slots of one container;
// - with A and B seated, the first joint shuffle reaches every tile (each
//   shuffled exactly once, nothing under way) and nothing is dealt: no
//   tile in a rack, no face to either player;
// - neither view veils a tile: all 28 are backs to both.
// Then (unless --dry-run) it publishes the table as the template left it
// (before anyone sat): its files, its deck and the scene, each made anew on
// the server with the urls between them rewritten.
//
// Lost Cities' deck asks for its players to shuffle it, so its container is
// the joint keeper's (a `secure-deck`, the card-table package's). Setting up
// writes it as plain data, waiting for players: the encrypted shuffle
// happens later, in the seated players' own browsers, so nothing here needs
// WebCrypto. The published scene lists the packages it is made of, exactly
// (the stage takes off a listed package nothing in it calls for): the
// scene's, the seats' when it has seats, and with a deck tabletop's (hands
// and cards) and card-table's (the keeper). A table with no deck
// (Santorini) lists neither.
//
// --dry-run makes the docs in a repo with no network and checks them, but
// publishes nothing.
//
// Simulated time: the page's stages run on its manual clock (window.__time):
// a pause is frames of it (b.rest); waits on conditions (b.waitFor) poll the
// wall, as they wait on the secure deck's crypto and on loading, stepping a
// frame each time round.

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import lostCities from "../games/lost-cities.json" with { type: "json" };
import { ensurePieceGLBs } from "../src/pieces.js";
import { tableLayout, writeTable } from "../src/setup.js";
import { emptyScene } from "../src/empty-scene.js";
import { prepareTable } from "../src/table/made-with.js";
import { TabletopGameDatatype } from "../src/datatype.js";
import { gameOf, writeGame } from "../src/game.js";
import { packageProblems, pushworkUrl, scenePackages, scenePatchwork, withPackages } from "./scene-packages.mjs";

// A published table names the scene package as its suggested import and
// lists the packages its contents come from (scene/STAGE.md, "Packages"):
// the scene, the seats (where anyone sits at it), and with a deck the
// table's own and the keeper's. In the browser the stage works these out
// from the registry; here they're stated, and --template checks them
// against the stage's.
const packagesOf = ({ seats = 0, deck = null }) => ["scene", ...(seats > 0 ? ["seats"] : []), ...(deck ? ["tabletop", "card-table"] : [])];
const PACKAGES = packagesOf({ seats: 2, deck: "deck" });

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
// It publishes by default, so a flag it doesn't know (--help, a typo of
// --dry-run) stops it here, before any repo exists, with the usage above.
const KNOWN = new Set(["sync", "settle", "dry-run", "template", "show", "shots"]);
const unknown = Object.keys(args).filter((k) => !KNOWN.has(k));
const stray = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--") && args[all[i - 1].slice(2)] === a));
if (unknown.length || stray.length) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  const usage = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n");
  if (!unknown.includes("help")) console.error(`unknown argument${unknown.length + stray.length === 1 ? "" : "s"}: ${[...unknown.map((k) => `--${k}`), ...stray].join(" ")}\n`);
  console.error(usage);
  process.exit(unknown.includes("help") && unknown.length === 1 && !stray.length ? 0 : 2);
}
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";

const TEMPLATE = typeof args.template === "string" ? args.template : null;

// What each template's table must be, for --template's checks:
//   seats  how many seats it lays (A and B sit in the first two)
//   deck   what its hidden pieces' pile is called, and `piece` one of them
//          (none: nothing is kept or shuffled)
//   count  how many pieces the deck keeps (null: not counted). Where it is
//          counted, the first joint shuffle must reach every one, and
//          neither view may veil one
//   hand   how many faces reach each player once both sit (0: nothing is
//          dealt, and no piece lies in a hand)
const TABLES = {
  "lost-cities": { seats: 2, deck: "deck", piece: "card", count: null, hand: 8 },
  santorini: { seats: 3 },
  "dominoes-2": { seats: 2, deck: "boneyard", piece: "tile", count: 28, hand: 0 },
};
if (TEMPLATE && !TABLES[TEMPLATE]) {
  console.error(`no template ${JSON.stringify(TEMPLATE)}: one of ${Object.keys(TABLES).join(", ")}`);
  process.exit(2);
}

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const repo = DRY ? new Repo({ network: [] }) : new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
if (!DRY) console.log(`connected to ${SYNC}`);

/** Flush, wait, then prove every doc is there from a repo that has never seen it. `expect(url, doc)` → a problem or null. */
async function verify(made, expect) {
  await repo.flush?.();
  await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
  const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const missing = [];
  for (const url of made) {
    try {
      const got = (await within(30000, checker.find(url))).doc();
      const problem = !got || !Object.keys(got).length ? "empty" : expect(url, got);
      if (problem) missing.push(`${url} (${problem})`);
    } catch (err) {
      missing.push(`${url} (${err?.message ?? err})`);
    }
  }
  console.log(`verified ${made.length - missing.length}/${made.length} docs from a fresh repo`);
  if (missing.length) {
    for (const m of missing) console.error(`  missing ${m}`);
    console.error(`\nNOT verified: re-run, or raise --settle.`);
    process.exit(1);
  }
}

if (TEMPLATE) {
  await fromTemplate(TEMPLATE);
  await new Promise(() => {}); // the browser's stop() exits
}

// ─── the game, as TabletopGameDatatype.init writes it, then started from Lost Cities ──
// It suggests this package, so a viewer who has nothing installed is offered
// the tool that opens it (a scene suggests the scene package the same way).
const init = { "@patchwork": { type: "tabletop-game", suggestedImportUrl: pushworkUrl("tabletop") } };
TabletopGameDatatype.init(init);
const game = await repo.create2(init);
game.change((d) => writeGame(d, lostCities));
const { drawn } = await ensurePieceGLBs(repo, game);

// ─── "Set up a table" (tool.js setUpTable) ──────────────────────────────────
const g = game.doc();
const title = `${g.title || "Game"} table ${(g.tables?.length ?? 0) + 1}`;
const fileOf = (kind) => (g.drawn?.[kind]?.url ? { url: g.drawn[kind].url, hint: g.drawn[kind].bounds ? { bounds: g.drawn[kind].bounds } : null } : null);
const layout = tableLayout(gameOf(g), { fileOf, gameUrl: game.url });
const decks = layout.containers;
// What's installed, for setting up: the built seats, card-table (the joint
// keeper) and keep (the plain one), as a registry the game page's own
// lookups read (src/table/made-with.js).
const here = (p) => resolve(dirname(fileURLToPath(import.meta.url)), "../..", p);
const installed = [];
for (const pkg of ["seats", "card-table", "keep"]) {
  const entry = here(`${pkg}/dist/index.js`);
  if (!existsSync(entry)) throw new Error(`no ${pkg}/dist/index.js: build it first`);
  installed.push(...(await import(entry)).plugins);
}
const registry = async (type) => {
  const all = new Map(installed.filter((p) => p.type === type).map((p) => [p.id, { ...p }]));
  return { filter: (fn) => [...all.values()].filter(fn), load: async (id) => { const p = all.get(id); if (p && !p.module) p.module = await p.load(); return p; } };
};
// the decks' containers and the seats' owner first, so the scene never names one that isn't there;
// a published example is made with everything, so any warning is a failure
const prepared = await prepareTable({ repo, registry }, layout);
const { binds, kinds } = prepared;
if (prepared.notes.length) throw new Error(`the table was made short: ${prepared.notes.join(" ")}`);
const table = emptyScene({ "@patchwork": scenePatchwork(), title, packages: scenePackages(PACKAGES) });
writeTable(table, layout, prepared);
// each deck's container, as its cards name it
const keptBy = (o) => Object.values(o?.traits ?? {}).find((v) => v && typeof v === "object" && typeof v.by === "string" && Number.isInteger(v.slot)) ?? null;
const deckUrls = Object.fromEntries(Object.keys(decks).map((deckId) => [deckId, binds[deckId](0)]).map(([deckId, t]) => [deckId, Object.values(t)[0].by]));
const scene = await repo.create2(table);
game.change((d) => {
  if (!d.tables) d.tables = [];
  d.tables.push(scene.url);
});

// ─── checks ─────────────────────────────────────────────────────────────────
const glbs = Object.keys(game.doc().pieces).map((k) => game.doc().drawn?.[k]?.url);
const s = scene.doc();
const problems = [];
if (drawn !== glbs.length || glbs.some((u) => !u)) problems.push(`${drawn} of ${glbs.length} piece GLBs drawn`);
if (s.view?.start?.body !== "seat") problems.push(`view.start is ${JSON.stringify(s.view?.start)}, not the seat body`);
if ("kits" in (s.view ?? {})) problems.push("view still has kits");
problems.push(...packageProblems(s, PACKAGES));
const objects = Object.entries(s.objects).filter(([, o]) => o.kind !== "group");
for (const [id, o] of objects) if (!glbs.includes(o.sourceUrl)) problems.push(`${id} (${o.name}) shows a GLB that isn't the game's`);
const hidden = objects.filter(([, o]) => o.traits?.["tabletop.card"]);
for (const [id, o] of hidden) if (!Object.values(deckUrls).includes(keptBy(o)?.by)) problems.push(`${id} is a card no container that was made keeps`);
if (new Set(hidden.map(([, o]) => `${keptBy(o)?.by}#${keptBy(o)?.slot}`)).size !== hidden.length) problems.push("two cards name one slot");
const deckTypes = Object.keys(decks).map((deckId) => `${kinds[deckId]} keeper`);
if (!hidden.length) problems.push("no cards in a deck");
// no trace of the old shapes, and the traits of the three packages the scene lists
const text = JSON.stringify(s);
for (const old of ["tabletop.hidden", "tabletop.seats", "scene.seats", "plain-deck"]) if (text.includes(old)) problems.push(`the scene still says ${old}`);
if (JSON.stringify(Object.keys(s.traits?.seats ?? {})) !== JSON.stringify(Object.keys(layout.seats))) problems.push(`its seats are ${JSON.stringify(Object.keys(s.traits?.seats ?? {}))}`);
if (!hidden.every(([, o]) => o.traits["card-table.kept"])) problems.push("its cards aren't bound by the joint keeper's trait");
// the new game lists the one table made here, and nothing older
if (JSON.stringify(game.doc().tables) !== JSON.stringify([scene.url])) problems.push(`the game lists tables ${JSON.stringify(game.doc().tables)}, not just ${scene.url}`);
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`game ${game.url}: ${glbs.length} pieces, each its own GLB`);
console.log(`table ${scene.url}: ${objects.length} objects, ${hidden.length} cards kept by the ${deckTypes.join(", ")}, ${Object.keys(s.traits.seats).length} seats, starts people ${JSON.stringify(s.view.start?.body ?? "look")}; packages: ${s.packages.map((e) => e.url).join(" ")}`);
const made = [game.url, scene.url, ...Object.values(deckUrls), ...glbs];

if (DRY) {
  console.log(`dry run: ${made.length} docs (nothing published)`);
  process.exit(0);
}

await verify(made, (url, got) => {
  if (url === scene.url && packageProblems(got, PACKAGES).length) return `came back wrong: ${packageProblems(got, PACKAGES).join("; ")}`;
  if (url === game.url && got["@patchwork"]?.suggestedImportUrl !== pushworkUrl("tabletop")) return "came back without the tabletop package as its suggested import";
  if (url === scene.url && got.view?.start?.body !== "seat") return "came back without view.start in the seat body";
  if (url === game.url && JSON.stringify(got.tables) !== JSON.stringify([scene.url])) return `came back listing tables ${JSON.stringify(got.tables)}, not just its own`;
  if (glbs.includes(url) && !(got.content?.byteLength > 0)) return "a GLB doc with no bytes";
  return null;
});
console.log(`\n  table  https://patchwork.inkandswitch.com/#doc=${scene.url}`);
console.log(`  game   https://patchwork.inkandswitch.com/#doc=${game.url}\n`);
process.exit(0);

// ─── --template: the start screen, in a mounted scene ───────────────────────
async function fromTemplate(gameId) {
  const { browser, checklist, sleep } = await import("./cdp.mjs");
  const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const ROOT = resolve(PKG, "..");
  for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "seats/dist/index.js", "card-table/dist/index.js", "keep/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
  // the packages this template's table is made of: the seats' only where anyone sits at it
  const PACKAGES = packagesOf(TABLES[gameId]);
  const SHOTS = resolve(typeof args.shots === "string" ? args.shots : join(process.env.TMPDIR || tmpdir(), "tabletop-template"));
  const id = `tabletop.${gameId}`;
  // where each built package is published (its pushwork URL), so the page
  // registers its plugins from there, as a host does, and the stage lists
  // the scene's packages itself
  const urls = {};
  for (const dir of ["scene", "seats", "tabletop", "card-table", "keep"]) {
    try {
      urls[dir] = pushworkUrl(dir);
    } catch {
      // not synced: its plugins come from nowhere, so a scene that needs them fails the packages check
    }
  }
  const folderOf = (url) => Object.keys(urls).find((dir) => urls[dir] === url) ?? url;
  const b = await browser({ root: ROOT, port: 4773, cdp: 9773, page: `/tabletop/probes/template-probe.html?game=${encodeURIComponent(gameId)}&urls=${encodeURIComponent(JSON.stringify(urls))}`, width: 1416, height: 530, show: !!args.show, timeout: 240_000 });
  // b.stop() exits the process; this keeps it alive until the publish is done
  const done = (code) => b.stop(code);
  const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
  const P = (e) => js(`window.__p.${e}`);
  const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
  const list = checklist();
  const { check } = list;
  const report = { template: id, checks: list.checks, details: list.details, shots: [] };
  const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
  const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `template-${name}.png`)));
  let snapshot = null;
  try {
    check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
    check("the start screen offers the template", await until(`templates('a').includes(${JSON.stringify(id)})`, 15_000), await P("templates('a')"));
    await shot("start");
    await P(`start('a', ${JSON.stringify(id)})`);
    const keys = await P("expectedKeys()");
    const laid = await until(`doc().count > 0 && ${JSON.stringify(keys)}.every((k) => __p.doc().assets?.[k]?.url)`, 30_000);
    const d = await P("doc()");
    // (nothing else is ever filed: a veil is the stage's drawing, not a file)
    const art = Object.keys(d.assets ?? {});
    check("doc.assets has a file under its versioned key for every kind", laid && art.length === keys.length, { want: keys.length, have: art.length, missing: keys.filter((k) => !d.assets?.[k]) });
    check("every object shows one of the scene's files, and none names a game as About", (await P("strays()")).length === 0, await P("strays()"));
    // a game with seats starts people in the seat body (view.start), where a press picks a piece up
    const tabled = TABLES[gameId].seats > 0;
    const lands = tabled ? "Watching" : "Look";
    check(`the view starts people ${tabled ? "in the seat body" : "in Look (no body named)"}, with no view.activity or view.tool`, (tabled ? d.view?.start?.body === "seat" : !("body" in (d.view?.start ?? {}))) && !("activity" in (d.view ?? {})) && !("tool" in (d.view ?? {})), d.view);
    check(`every piece not fixed to the table carries scene.carry (${d.loose})`, d.loose > 0 && d.carried === d.loose, { loose: d.loose, carried: d.carried });
    check(`A lands ${lands === "Look" ? "in Look" : "watching from a seat"}`, await until(`bodyLabel('a') === ${JSON.stringify(lands)}`, 20_000), await P("bodyLabel('a')"));
    // What the table needs is the stage's to say, not this script's: A's stage
    // lists the package of every plugin the scene calls for and names the
    // scene package as the suggested import. They must be exactly what this
    // script states: one more and the published table would ask for a
    // package nobody uses (and lose it on the first writable visit), one
    // fewer and it wouldn't ask for one it needs.
    const stated = PACKAGES.map((dir) => urls[dir]);
    const listedAll = await until("packages('a') && ((k) => k.suggested !== null && k.answering.length > 0 && k.answering.every((p) => p.importUrl && k.listed.includes(p.importUrl)))(__p.packages('a'))", 10_000);
    const pk = await P("packages('a')");
    check(
      `A's stage lists the package of every plugin the table calls for, exactly ${PACKAGES.join(", ")}, and names the scene package as its suggested import`,
      listedAll && pk.listed.every((u) => stated.includes(u)) && new Set(pk.answering.map((p) => p.importUrl)).size === stated.length && stated.every((u) => pk.answering.some((p) => p.importUrl === u)) && pk.suggested === urls.scene,
      { answering: pk.answering.map((p) => `${p.id} ← ${p.importUrl ? folderOf(p.importUrl) : "nowhere"}`), listed: pk.listed.map(folderOf), suggested: folderOf(pk.suggested), stated: PACKAGES }
    );
    snapshot = await P("snapshot()");
    const seated = Object.keys(await P("seats()"));
    const { seats = 0, deck, piece, count = null, hand = 0 } = TABLES[gameId];
    check(`the table lays ${seats} seat${seats === 1 ? "" : "s"}`, seated.length === seats, seated);
    if (seats) {
      const type = await P("deckType()"), traits = await P("keptBy()"), cards = await P("cards()"), slots = await P("slots()");
      const kept = type === "secure-deck" && traits.join() === "card-table.kept";
      if (deck) check(
        count == null
          ? "the deck is kept by the joint keeper (a secure-deck), every card bound by that keeper's trait"
          : `the ${deck}'s ${count} ${piece}s are kept by the joint keeper (a secure-deck), each bound by card-table.kept to its own slot of one container`,
        kept && (count == null || (cards === count && slots.slots === count && slots.containers === 1)),
        { type, traits, cards, ...slots }
      );
      check("A is told to pick a seat", await until("notices('a').includes('Pick a seat (top right) to play.')", 3000), await P("notices('a')"));
      await P("openB()");
      check("B opens the table watching from a seat, and both pickers are up", await until(`bodyLabel('b') === 'Watching' && __p.picker('a') === ${seats + 1} && __p.picker('b') === ${seats + 1}`, 20_000), { b: await P("bodyLabel('b')"), a: await P("picker('a')"), pb: await P("picker('b')") });
      await P(`pick('a', ${JSON.stringify(seated[0])})`);
      await P(`pick('b', ${JSON.stringify(seated[1])})`);
      const viewers = await P("viewers");
      check("A and B seated", await until(`seats()[${JSON.stringify(seated[0])}].player === ${JSON.stringify(viewers.a)} && __p.seats()[${JSON.stringify(seated[1])}].player === ${JSON.stringify(viewers.b)}`), await P("seats()"));
      // a table with a deck: its first shuffle, and what reaches each hand
      if (deck) {
        // the first shuffle, done: every counted piece shuffled exactly once, by every seat, nothing under way
        const shuffled = count == null ? "true" : `((s) => !!s && s.phase === 'playing' && s.op === null && s.queue === 0 && s.participants === ${seats} && s.epochs.length === ${count} && s.epochs.every((e) => e === 1))(__p.shuffle())`;
        const playing = await until(`phase() === 'playing' && ${shuffled} && __p.faces('a').length === ${hand} && __p.faces('b').length === ${hand}`, 120_000);
        const faces = { a: (await P("faces('a')")).length, b: (await P("faces('b')")).length };
        if (count == null) check(`the deck reaches phase playing, and each hand's ${hand} faces reach its player`, playing, { phase: await P("phase()"), faces });
        else {
          const where = await P("where()");
          const zones = await P("zones()");
          const inHands = Object.entries(where).filter(([at]) => at !== "table").reduce((n, [, ids]) => n + ids.length, 0);
          check(
            `the first joint shuffle reaches all ${count} ${piece}s (each shuffled once, by both players, nothing under way), and ${hand ? `each hand's ${hand} faces reach its player` : `nothing is dealt: no ${piece} in any of the ${seats} hands, no face to either player`}`,
            playing && zones === seats && inHands === hand * seats,
            { shuffle: await P("shuffle()"), faces, zones, where: Object.fromEntries(Object.entries(where).map(([at, ids]) => [at, ids.length])) }
          );
          // a veil is a piece kept from you; nothing on this table is kept from anyone who sits at it, so no view shows one
          const shown = async () => Object.fromEntries(await Promise.all(["a", "b"].map(async (w) => [w, { faces: (await P(`faces('${w}')`)).length, veils: (await P(`veils('${w}')`)).length, backs: (await P(`backs('${w}')`)).length }])));
          await until(`backs('a').length + __p.faces('a').length === ${count} && __p.backs('b').length + __p.faces('b').length === ${count}`, 10_000);
          await b.rest(500);
          const now = await shown();
          check(`neither view veils a ${piece}: each sees ${hand} faces and ${count - hand} backs`, ["a", "b"].every((w) => now[w].veils === 0 && now[w].faces === hand && now[w].backs === count - hand), now);
        }
      }
    }
    await b.rest(500);
    const views = seats ? ["a", "b"] : ["a"];
    const loads = Object.fromEntries(await Promise.all(views.map(async (w) => [w, await P(`loading('${w}')`)])));
    check(`nothing failed to load in ${views.length === 2 ? "either view" : "A's view"}`, views.every((w) => loads[w].errors === 0), loads);
    await shot("seated");
    const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
    check("no errors on the page", errors.length === 0, errors);
  } catch (err) {
    check("ran to the end", false, String(err?.stack ?? err));
  }
  console.log(JSON.stringify(report, null, 2));
  if (list.failed || !snapshot) return done(1);
  // the page had no registry to say where its packages come from: stated here
  const docs = { ...snapshot.docs, [snapshot.scene]: withPackages(snapshot.docs[snapshot.scene], PACKAGES) };
  const count = Object.keys(docs).length;
  const stamped = packageProblems(docs[snapshot.scene], PACKAGES);
  if (stamped.length) {
    for (const p of stamped) console.error(`  ${p}`);
    return done(1);
  }
  if (DRY) {
    console.log(`dry run: ${count} docs (nothing published)`);
    return done(0);
  }

  // ─── publish the table as the template left it ────────────────────────────
  // files first, then the deck, then the scene, each pointing at the new urls
  const fromBytes = (v) => (v && typeof v === "object" && typeof v.$bytes === "string" ? new Uint8Array(Buffer.from(v.$bytes, "base64")) : v);
  const revive = (doc) => JSON.parse(JSON.stringify(doc), (k, v) => fromBytes(v));
  const renamed = new Map();
  const rewrite = (doc) => {
    let text = JSON.stringify(doc);
    for (const [from, to] of renamed) text = text.split(from).join(to);
    return revive(JSON.parse(text));
  };
  const files = Object.keys(docs).filter((u) => u !== snapshot.scene && u !== snapshot.deck);
  for (const u of files) renamed.set(u, (await repo.create2(revive(docs[u]))).url);
  if (snapshot.deck) renamed.set(snapshot.deck, (await repo.create2(rewrite(docs[snapshot.deck]))).url);
  const table = await repo.create2(rewrite(docs[snapshot.scene]));
  const made = [table.url, ...renamed.values()];
  const glbs = files.map((u) => renamed.get(u));
  await verify(made, (url, got) => {
    if (url === table.url && packageProblems(got, PACKAGES).length) return `came back wrong: ${packageProblems(got, PACKAGES).join("; ")}`;
    if (url === table.url && JSON.stringify(got.view?.start ?? null) !== JSON.stringify(docs[snapshot.scene].view?.start ?? null)) return `came back with view.start ${JSON.stringify(got.view?.start)}`;
    if (glbs.includes(url) && !(got.content?.byteLength > 0)) return "a GLB doc with no bytes";
    return null;
  });
  console.log(`\n  table  https://patchwork.inkandswitch.com/#doc=${table.url}\n`);
  return done(0);
}
