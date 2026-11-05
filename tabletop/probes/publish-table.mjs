// Publish a Lost Cities game and a table set up from it to a real sync
// server, and print their Patchwork URLs.
//
//   node probes/publish-table.mjs [--sync wss://…] [--settle 8000]
//   node probes/publish-table.mjs --dry-run
//
// Makes NEW docs on every run (no dedupe), the way the package's own UI
// would: a tabletop-game doc filled by the Lost Cities game (games/lost-cities.js
// fill, as "Start from" does), every piece's GLB drawn into a file doc
// (pieces.js ensurePieceGLBs, as the game page does while open), then "Set up
// a table" (tool.js setUpTable): tableScene, a doc per deck, linkDecks, the
// table's scene doc, and the table listed on the game.
//
// Lost Cities' deck is secure, so its doc is a `secure-deck` (the card-table
// package's datatype). Setting up writes it as plain data, waiting for
// players: the encrypted shuffle happens later, in the seated players' own
// browsers, so nothing here needs WebCrypto.
//
// --dry-run makes the docs in a repo with no network and checks them, but
// publishes nothing.

import { fill } from "../src/games/lost-cities.js";
import { ensurePieceGLBs } from "../src/pieces.js";
import { linkDecks, tableScene } from "../src/setup.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";

const { Repo, initSubduction } = await import("@automerge/automerge-repo");
await initSubduction();
const repo = DRY ? new Repo({ network: [] }) : new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
if (!DRY) console.log(`connected to ${SYNC}`);

// ─── the game, as TabletopGameDatatype.init writes it, then filled ──────────
const game = await repo.create2({ "@patchwork": { type: "tabletop-game" }, title: "Untitled game", about: "", pieces: {}, order: [], tables: [] });
game.change((d) => fill(d));
const drawn = await ensurePieceGLBs(repo, game);

// ─── "Set up a table" (tool.js setUpTable) ──────────────────────────────────
const g = game.doc();
const title = `${g.title || "Game"} table ${(g.tables?.length ?? 0) + 1}`;
const { scene: table, decks } = tableScene(g, game.url, { title });
// the decks first, so the scene never names one that isn't there
const deckUrls = {};
for (const [deckId, deck] of Object.entries(decks)) deckUrls[deckId] = (await repo.create2({ ...deck, title: `${title}: ${deck.title}` })).url;
linkDecks(table, deckUrls);
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
const objects = Object.entries(s.objects).filter(([, o]) => o.kind !== "group");
for (const [id, o] of objects) if (!glbs.includes(o.sourceUrl)) problems.push(`${id} (${o.name}) shows a GLB that isn't the game's`);
const hidden = objects.filter(([, o]) => o.traits?.["tabletop.hidden"]);
for (const [id, o] of hidden) if (!Object.values(deckUrls).includes(o.traits["tabletop.hidden"].by)) problems.push(`${id} is hidden by a deck that wasn't made`);
const deckTypes = Object.values(decks).map((dk) => dk["@patchwork"].type);
if (!hidden.length) problems.push("no cards in a deck");
if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`game ${game.url}: ${glbs.length} pieces, each its own GLB`);
console.log(`table ${scene.url}: ${objects.length} objects, ${hidden.length} cards in ${deckTypes.join(", ")} decks, starts in ${s.view.activity}`);
const made = [game.url, scene.url, ...Object.values(deckUrls), ...glbs];

if (DRY) {
  console.log(`dry run: ${made.length} docs (nothing published)`);
  process.exit(0);
}

// ─── flush, then prove every doc is there from a repo that has never seen it ──
await repo.flush?.();
await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
const missing = [];
for (const url of made) {
  try {
    const got = (await within(30000, checker.find(url))).doc();
    if (!got || !Object.keys(got).length) missing.push(`${url} (empty)`);
    else if (url === scene.url && got.view?.activity !== "play") missing.push(`${url} (came back without view.activity "play")`);
    else if (url === game.url && got.tables?.[0] !== scene.url) missing.push(`${url} (came back without its table)`);
    else if (glbs.includes(url) && !(got.content?.byteLength > 0)) missing.push(`${url} (a GLB doc with no bytes)`);
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
console.log(`\n  table  https://patchwork.inkandswitch.com/#doc=${scene.url}`);
console.log(`  game   https://patchwork.inkandswitch.com/#doc=${game.url}\n`);
process.exit(0);
