// Publish a game table to a real sync server, and print its Patchwork URLs.
// Two ways, the two ways a table is made:
//
//   node probes/publish-table.mjs [--sync wss://…] [--settle 8000] [--dry-run]
//   node probes/publish-table.mjs --template lost-cities|santorini [--sync …] [--dry-run] [--show] [--shots <dir>]
//
// Makes NEW docs on every run (no dedupe).
//
// The game page (default): the Lost Cities game, as the package's own UI
// would make it. A tabletop-game doc filled by the Lost Cities game
// (games/lost-cities.js fill, as "Start from" does), every piece's GLB drawn
// into a file doc (pieces.js ensurePieceGLBs, as the game page does while
// open), then "Set up a table" (tool.js setUpTable): tableLayout with the
// game's GLBs, a container per deck from a keeper and the seats from their
// owner (both found, as the game page finds them, by their plugins'
// metadata: here in the BUILT scene, card-table and keep packages, so build
// those first), writeTable onto a skeleton scene doc with every map a scene
// has, the scene doc, and the table listed on the game (its only one: the
// game is new).
//
// --template <game>: the scene's start screen. Needs scene/, tabletop/,
// card-table/ and keep/ built. In headless Chrome, the BUILT scene tool with the BUILT
// tabletop and keeper plugins is mounted twice on one EMPTY scene
// (template-probe.html; an in-memory repo, two views A and B), and A picks
// the template on the start screen (api.template); B opens it after. It checks:
// - the start screen offers it;
// - doc.assets has a file under its versioned key for every kind, and every
//   object shows one of them (no game doc, no About);
// - the view starts in play, and A is playing (a game with no seats, zones
//   or hidden cards, Santorini, gives play nothing to run, so its doc
//   writes no view.activity: A is in the editor, in the hand);
// - the deck is kept by the joint keeper (a secure-deck: card-table is
//   installed), every card bound to it by that keeper's own trait;
// - with A and B seated, the deck reaches phase "playing" and each hand's
//   faces reach its player (8 each).
// Then (unless --dry-run) it publishes the table as the template left it
// (before anyone sat): its files, its deck and the scene, each made anew on
// the server with the urls between them rewritten.
//
// Lost Cities' deck asks for its players to shuffle it, so its container is
// the joint keeper's (a `secure-deck`, the card-table package's). Setting up
// writes it as plain data, waiting for players: the encrypted shuffle
// happens later, in the seated players' own browsers, so nothing here needs
// WebCrypto. The published scene lists the three packages it is made of:
// the scene's (seats are its own), tabletop's (hands and cards) and
// card-table's (the keeper).
//
// --dry-run makes the docs in a repo with no network and checks them, but
// publishes nothing.

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { fill } from "../src/games/lost-cities.js";
import { ensurePieceGLBs } from "../src/pieces.js";
import { tableLayout, writeTable } from "../src/setup.js";
import { emptyScene } from "../src/empty-scene.js";
import { containDecks, findSeats } from "../src/table/made-with.js";
import { packageProblems, scenePackages, scenePatchwork, withPackages } from "./scene-packages.mjs";

// A published table names the scene package as its suggested import and
// lists the packages its contents come from (scene/STAGE.md, "Packages"):
// the scene (the seats are its part), the table's own, and the keeper's. In
// the browser the stage works these out from the registry; here they're
// stated.
const PACKAGES = ["scene", "tabletop", "card-table"];

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

// ─── the game, as TabletopGameDatatype.init writes it, then filled ──────────
const game = await repo.create2({ "@patchwork": { type: "tabletop-game" }, title: "Untitled game", about: "", pieces: {}, order: [], tables: [] });
game.change((d) => fill(d));
const drawn = await ensurePieceGLBs(repo, game);

// ─── "Set up a table" (tool.js setUpTable) ──────────────────────────────────
const g = game.doc();
const title = `${g.title || "Game"} table ${(g.tables?.length ?? 0) + 1}`;
const fileOf = (kind) => (g.pieces[kind]?.glbUrl ? { url: g.pieces[kind].glbUrl, hint: g.pieces[kind].bounds ? { bounds: g.pieces[kind].bounds } : null } : null);
const layout = tableLayout(g, { fileOf, gameUrl: game.url });
const decks = layout.decks;
// What's installed, for setting up: the built scene (seats), card-table (the
// joint keeper) and keep (the plain one), as a registry the game page's own
// lookups read (src/table/made-with.js).
const here = (p) => resolve(dirname(fileURLToPath(import.meta.url)), "../..", p);
const installed = [];
for (const pkg of ["scene", "card-table", "keep"]) {
  const entry = here(`${pkg}/dist/index.js`);
  if (!existsSync(entry)) throw new Error(`no ${pkg}/dist/index.js: build it first`);
  installed.push(...(await import(entry)).plugins);
}
const registry = async (type) => {
  const all = new Map(installed.filter((p) => p.type === type).map((p) => [p.id, { ...p }]));
  return { filter: (fn) => [...all.values()].filter(fn), load: async (id) => { const p = all.get(id); if (p && !p.module) p.module = await p.load(); return p; } };
};
// the decks' containers first, so the scene never names one that isn't there
const { binds, kinds } = await containDecks({ repo, registry }, decks, (deck) => `${title}: ${deck.title}`);
const lay = await findSeats(registry);
if (!lay) throw new Error("nothing built here owns seats (the scene's seats part)");
const table = emptyScene({ "@patchwork": scenePatchwork(), title, packages: scenePackages(PACKAGES) });
writeTable(table, layout, binds, { seats: lay });
// each deck's container, as its cards name it
const keptBy = (o) => Object.values(o?.traits ?? {}).find((v) => v && typeof v === "object" && typeof v.by === "string" && Number.isInteger(v.slot)) ?? null;
const deckUrls = Object.fromEntries(Object.keys(decks).map((deckId) => [deckId, binds[deckId](0)]).map(([deckId, t]) => [deckId, Object.values(t)[0].by]));
const scene = await repo.create2(table);
game.change((d) => {
  if (!d.tables) d.tables = [];
  d.tables.push(scene.url);
});

// ─── checks ─────────────────────────────────────────────────────────────────
const glbs = Object.values(game.doc().pieces).map((p) => p.glbUrl);
const s = scene.doc();
const problems = [];
if (drawn !== glbs.length || glbs.some((u) => !u)) problems.push(`${drawn} of ${glbs.length} piece GLBs drawn`);
if (s.view?.activity !== "play") problems.push(`view.activity is ${JSON.stringify(s.view?.activity)}, not "play"`);
if ("kits" in (s.view ?? {})) problems.push("view still has kits");
problems.push(...packageProblems(s, PACKAGES));
const objects = Object.entries(s.objects).filter(([, o]) => o.kind !== "group");
for (const [id, o] of objects) if (!glbs.includes(o.sourceUrl)) problems.push(`${id} (${o.name}) shows a GLB that isn't the game's`);
const hidden = objects.filter(([, o]) => o.traits?.["tabletop.card"]);
for (const [id, o] of hidden) if (!Object.values(deckUrls).includes(keptBy(o)?.by)) problems.push(`${id} is a card no container that was made keeps`);
if (new Set(hidden.map(([, o]) => `${keptBy(o)?.by}#${keptBy(o)?.slot}`)).size !== hidden.length) problems.push("two cards name one slot");
const deckTypes = Object.keys(decks).map((deckId) => `${kinds[deckId]} keeper`);
if (!hidden.length) problems.push("no cards in a deck");
if (Object.entries(decks).some(([deckId, dk]) => dk.secure && kinds[deckId] !== "joint")) problems.push("a deck that asks for its players to shuffle it went to a plain keeper");
// no trace of the old shapes, and the traits of the three packages the scene lists
const text = JSON.stringify(s);
for (const old of ["tabletop.hidden", "tabletop.seats", "plain-deck"]) if (text.includes(old)) problems.push(`the scene still says ${old}`);
if (JSON.stringify(Object.keys(s.traits?.["scene.seats"] ?? {})) !== JSON.stringify(Object.keys(layout.seats))) problems.push(`its seats are ${JSON.stringify(Object.keys(s.traits?.["scene.seats"] ?? {}))}`);
if (!hidden.every(([, o]) => o.traits["card-table.kept"])) problems.push("its cards aren't bound by the joint keeper's trait");
// the new game lists the one table made here, and nothing older
if (JSON.stringify(game.doc().tables) !== JSON.stringify([scene.url])) problems.push(`the game lists tables ${JSON.stringify(game.doc().tables)}, not just ${scene.url}`);
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`game ${game.url}: ${glbs.length} pieces, each its own GLB`);
console.log(`table ${scene.url}: ${objects.length} objects, ${hidden.length} cards kept by the ${deckTypes.join(", ")}, ${Object.keys(s.traits["scene.seats"]).length} seats, starts in ${s.view.activity}; packages: ${s.packages.map((e) => e.url).join(" ")}`);
const made = [game.url, scene.url, ...Object.values(deckUrls), ...glbs];

if (DRY) {
  console.log(`dry run: ${made.length} docs (nothing published)`);
  process.exit(0);
}

await verify(made, (url, got) => {
  if (url === scene.url && packageProblems(got, PACKAGES).length) return `came back wrong: ${packageProblems(got, PACKAGES).join("; ")}`;
  if (url === scene.url && got.view?.activity !== "play") return 'came back without view.activity "play"';
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
  for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "card-table/dist/index.js", "keep/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
  const SHOTS = resolve(typeof args.shots === "string" ? args.shots : join(process.env.TMPDIR || tmpdir(), "tabletop-template"));
  const id = `tabletop.${gameId}`;
  const b = await browser({ root: ROOT, port: 4773, cdp: 9773, page: `/tabletop/probes/template-probe.html?game=${encodeURIComponent(gameId)}`, width: 1416, height: 530, show: !!args.show, timeout: 240_000 });
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
    // play is on offer only where the table extension has a trait to run on
    // (hands, cards); Santorini has none, so its doc doesn't claim play, and
    // it opens in the editor, in the hand
    const tabled = (await P("cards()")) > 0;
    const lands = tabled ? "play" : "edit";
    check(`the view starts in ${tabled ? '"play"' : "the editor (no view.activity)"}, in the hand`, (tabled ? d.view?.activity === "play" : !("activity" in (d.view ?? {}))) && d.view?.tool === "hand", d.view);
    check(`A lands in ${lands}`, await until(`activity('a') === ${JSON.stringify(lands)}`, 5000), await P("activity('a')"));
    snapshot = await P("snapshot()");
    const seated = Object.keys(await P("seats()"));
    if (seated.length) {
      check("the deck is kept by the joint keeper (a secure-deck), every card bound by that keeper's trait", (await P("deckType()")) === "secure-deck" && (await P("keptBy()")).join() === "card-table.kept", { type: await P("deckType()"), traits: await P("keptBy()") });
      check("A is told to pick a seat", await until("notices('a').includes('Pick a seat (top right) to play.')", 3000), await P("notices('a')"));
      await P("openB()");
      check("B opens the table in play, and both pickers are up", await until("activity('b') === 'play' && __p.picker('a') === 3 && __p.picker('b') === 3", 15_000), { b: await P("activity('b')"), a: await P("picker('a')"), pb: await P("picker('b')") });
      await P(`pick('a', ${JSON.stringify(seated[0])})`);
      await P(`pick('b', ${JSON.stringify(seated[1])})`);
      const viewers = await P("viewers");
      check("A and B seated", await until(`seats()[${JSON.stringify(seated[0])}].player === ${JSON.stringify(viewers.a)} && __p.seats()[${JSON.stringify(seated[1])}].player === ${JSON.stringify(viewers.b)}`), await P("seats()"));
      const playing = await until("phase() === 'playing' && __p.faces('a').length === 8 && __p.faces('b').length === 8", 120_000);
      check("the deck reaches phase playing, and each hand's 8 faces reach its player", playing, { phase: await P("phase()"), faces: { a: (await P("faces('a')")).length, b: (await P("faces('b')")).length } });
    }
    await sleep(500);
    check("nothing failed to load", (await P("loading('a')")).errors === 0, await P("loading('a')"));
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
    if (url === table.url && got.view?.activity !== docs[snapshot.scene].view?.activity) return `came back with view.activity ${JSON.stringify(got.view?.activity)}`;
    if (glbs.includes(url) && !(got.content?.byteLength > 0)) return "a GLB doc with no bytes";
    return null;
  });
  console.log(`\n  table  https://patchwork.inkandswitch.com/#doc=${table.url}\n`);
  return done(0);
}
