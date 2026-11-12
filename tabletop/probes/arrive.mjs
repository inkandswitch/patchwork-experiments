// Arriving by link with only the scene package: a Lost Cities table made by
// A, opened by B who has neither tabletop nor the keeper's package.
//
//   (in scene/, tabletop/ and card-table/) pnpm build
//   node probes/arrive.mjs [--shots <dir>] [--show]
//
// Two viewers with different packages installed (arrive-probe.html: an
// iframe each, so a plugin registry each; one set of documents):
// - A, who has the scene, tabletop and card-table packages, sets a Lost
//   Cities table up as the game page does and opens it. A's stage lists the
//   packages the scene is made of: the scene's, tabletop's (hands, cards)
//   and card-table's (the joint keeper, through its trait on every card),
//   and names the scene package as the doc's suggested import.
// - B, who has the scene package only, opens the table's URL. The one
//   packages card offers tabletop and card-table by name. Until B answers:
//   B's stage runs neither; every card is its own back to B; the stage
//   tells B's extensions nothing about who may see what (unknown).
// - FAIL CLOSED: A sits, and B sits too (seats are the scene's own), still
//   without the packages. The deck can't be dealt without B's client: it
//   stays waiting, with A alone joined and NO key handed over by anyone to
//   anyone; A is told who it waits for; B sees sixty backs.
// - B clicks Load (a real click on the card). Both packages are imported
//   at their heads and registered; B's stage starts the table and the
//   keeper; B lands in play.
// - The joint shuffle completes between the two clients, and each player
//   sees the 8 cards of their own hand, the other's as backs, the pile as
//   backs; keys were handed over only for the two hands.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "card-table/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "tabletop-arrive"));

const b = await browser({ root: ROOT, port: 4776, cdp: 9776, page: "/tabletop/probes/arrive-probe.html", width: 1416, height: 530, show: process.argv.includes("--show"), timeout: 300_000 });
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const J = JSON.stringify;
/** call a frame's function: F("a", "tally") */
const F = (w, name, ...args) => js(`window.__p.call(${J(w)}, ${J(name)}${args.map((a) => `, ${J(a)}`).join("")})`);
const until = (expr, ms = 10_000) => b.waitFor(expr, ms, 50);
const fUntil = (w, body, ms = 10_000) => until(`(() => { const f = window.__p.f(${J(w)}); return ${body}; })()`, ms);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `arrive-${name}.png`)));
const sorted = (a) => [...a].sort();

try {
  check("the page set up", (await until("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const urls = await js("window.__p.urls");
  const viewers = await js("window.__p.viewers");
  const name = { [urls.scene]: "scene", [urls.tabletop]: "tabletop", [urls["card-table"]]: "card-table" };

  // ── A: has everything; makes the table and opens it ──
  await js(`window.__p.start("a", ["scene", "tabletop", "card-table"])`);
  const made = await F("a", "makeTable");
  await F("a", "open", made.scene);
  mark("A made and opened the table", made);
  check("A's table: 60 cards, each a tabletop card bound by the joint keeper's own trait", (await F("a", "cards")) === 60 && J(await F("a", "keptBy")) === J(["card-table.kept"]) && made.kinds.main === "joint", { cards: await F("a", "cards"), keptBy: await F("a", "keptBy"), kinds: made.kinds });
  const traits = await F("a", "traits");
  check("the scene's traits are three packages' own, and no old ones", J(traits) === J(["card-table.kept", "scene.seats", "tabletop.card", "tabletop.zone"]), traits);
  check("A's stage lists the packages the scene is made of: the scene's, tabletop's and the keeper's", await fUntil("a", `f.listed().length === 3`, 10_000) && J(sorted((await F("a", "listed")).map((u) => name[u]))) === J(["card-table", "scene", "tabletop"]), (await F("a", "listed")).map((u) => name[u] ?? u));
  check("…and names the scene package as the doc's suggested import", (await F("a", "suggested")) === urls.scene, await F("a", "suggested"));
  check("A is playing, with the table and the keeper running", await fUntil("a", `f.activity()?.current === "play" && ["tabletop", "tabletop.rule", "card-table", "scene.seats"].every((id) => f.running().includes(id))`, 10_000), { activity: await F("a", "activity"), running: await F("a", "running") });
  check("A's deck waits for players", await fUntil("a", `f.hud().some((t) => /is shuffled once someone sits as Player 1 and Player 2/.test(t))`, 10_000), await F("a", "hud"));

  // ── B: has only the scene package; opens the URL ──
  await js(`window.__p.start("b", ["scene"])`);
  check("B has the scene package and nothing of tabletop's or card-table's", (await F("b", "hasPlugin", "patchwork:tool", "scene")) && !(await F("b", "registered")).some((p) => /tabletop|card-table|secure-deck/.test(p)), (await F("b", "registered")).filter((p) => !/scene/.test(p)));
  await F("b", "open", made.scene);
  mark("B opened the URL");
  const asked = await fUntil("b", `f.packages()?.ask?.length === 2 && f.packages().ask.every((e) => e.name) && f.card() && !f.card().hidden`, 15_000);
  const card = await F("b", "card");
  check("B is offered both packages on the one packages card, by name, with Load", asked && J(sorted(card.rows.map((r) => r.name))) === J(["@tiny-patchwork/card-table", "@tiny-patchwork/tabletop"]) && J(sorted(card.rows.map((r) => name[r.url]))) === J(["card-table", "tabletop"]) && card.actions.includes("Load them"), card);
  check("nothing was imported before a yes", (await F("b", "imported")).length === 0, await F("b", "imported"));
  check("B's stage runs neither the table nor the keeper", !(await F("b", "running")).some((id) => /tabletop|card-table/.test(id)), await F("b", "running"));
  check("B's seats are there all the same (the scene's own part): the picker is up", await fUntil("b", `f.picker()?.length === 3`, 5000), await F("b", "picker"));
  await fUntil("b", `f.loading().loading === 0`, 30_000);
  const b0 = await F("b", "tally");
  check("to B every card is its own back: no face, no veil", Object.values(b0).every((t) => t.face === 0 && t.veil === 0) && Object.values(b0).reduce((n, t) => n + t.back, 0) === 60, b0);
  check("the stage tells B's extensions nothing about who may see what: unknown for every card", J(await F("b", "audiences")) === J({ unknown: 60, known: 0 }) && (await F("b", "packages")).missing === true, { audiences: await F("b", "audiences"), packages: await F("b", "packages") });
  check("…while A's stage knows", J(await F("a", "audiences")) === J({ unknown: 0, known: 60 }), await F("a", "audiences"));
  await shot("1-offered");

  // ── fail closed: both sit, B still without the packages ──
  await F("a", "pick", "p1");
  await F("b", "pick", "p2");
  check("A sits in Player 1 and B in Player 2 (B without the packages)", await until(`(() => { const s = window.__p.f("a").seats(); return s.p1?.player === ${J(viewers.a)} && s.p2?.player === ${J(viewers.b)}; })()`, 5000), await F("a", "seats"));
  mark("both seated, B without packages");
  check("A is told who it waits for", await fUntil("a", `f.hud().some((t) => /Waiting for Player 2 to shuffle/.test(t))`, 10_000), await F("a", "hud"));
  await sleep(3000);
  const waiting = await js(`window.__p.docOf(${J(made.deck)})`);
  check("the deck is not dealt: still waiting, A alone joined", waiting.phase === "waiting" && waiting.cards === null && J(waiting.participants.map((p) => p.id)) === J([viewers.a]), { phase: waiting.phase, participants: waiting.participants.map((p) => p.id) });
  check("A's client has released nothing, to B or anyone: no key handed over", J(waiting.shares) === "{}" && J(waiting.epochs) === "{}", { shares: waiting.shares });
  const b1 = await F("b", "tally");
  const a1 = await F("a", "tally");
  check("B still sees sixty backs; A too (nothing is anyone's yet)", [a1, b1].every((t) => Object.values(t).every((x) => x.face === 0 && x.veil === 0)), { a: a1, b: b1 });
  check("B's stage still answers unknown", J(await F("b", "audiences")) === J({ unknown: 60, known: 0 }), await F("b", "audiences"));
  await shot("2-waiting-for-b");

  // ── B says Load, with a real click ──
  const at = await js(`window.__p.button("b", "load")`);
  check("the card's Load button is on screen in B's view", !!at, at);
  await b.click(at.x, at.y);
  mark("B clicked Load");
  const loaded = await fUntil("b", `["tabletop", "tabletop.rule", "card-table"].every((id) => f.running().includes(id))`, 30_000);
  check("B's stage starts the table, its rule and the keeper", loaded, await F("b", "running"));
  const imported = await F("b", "imported");
  check("both packages were imported, each at its heads, and nothing else", imported.length === 2 && J(sorted(imported.map((u) => name[u.split("#")[0]]))) === J(["card-table", "tabletop"]) && imported.every((u) => u.includes("#")), imported);
  check("the card is gone, and nothing is missing any more", await fUntil("b", `(!f.card() || f.card().hidden) && f.packages().missing === false`, 5000), { card: await F("b", "card"), packages: await F("b", "packages") });
  check("B lands in play", await fUntil("b", `f.activity()?.current === "play"`, 5000), await F("b", "activity"));
  check("B's stage knows who may see what now", await fUntil("b", `f.audiences().unknown === 0`, 5000), await F("b", "audiences"));

  // ── the joint shuffle completes, and deals 8 each ──
  const dealt = await until(`(() => { const a = window.__p.f("a").tally(), b = window.__p.f("b").tally(); return a.p1?.face === 8 && b.p2?.face === 8; })()`, 180_000);
  mark("dealt");
  const a2 = await F("a", "tally");
  const b2 = await F("b", "tally");
  const deck = await js(`window.__p.docOf(${J(made.deck)})`);
  check("the joint shuffle completes: both joined, every card shuffled once", deck.phase === "playing" && deck.op === null && deck.queue.length === 0 && J(sorted(deck.participants.map((p) => p.id))) === J(sorted([viewers.a, viewers.b])) && Object.keys(deck.epochs).length === 60 && Object.values(deck.epochs).every((n) => n === 1), { phase: deck.phase, participants: deck.participants.length, epochs: Object.keys(deck.epochs).length });
  check("A sees the 8 faces of its own hand", dealt && a2.p1?.face === 8 && a2.p1.back === 0 && a2.p1.veil === 0, a2);
  check("B sees the 8 faces of its own hand", dealt && b2.p2?.face === 8 && b2.p2.back === 0 && b2.p2.veil === 0, b2);
  check("each sees the other's hand as 8 backs, and the pile as 44 backs: no veil anywhere", a2.p2?.back === 8 && b2.p1?.back === 8 && a2.table?.back === 44 && b2.table?.back === 44 && [a2, b2].every((t) => Object.values(t).every((x) => x.veil === 0)), { a: a2, b: b2 });
  // keys follow the table: 16 positions have shares (the two hands), each handed over by the other player, sealed to the owner
  const shares = Object.values(deck.shares ?? {});
  const sealed = shares.every((s) => Object.values(s.by).every((x) => !x.open && Object.keys(x.to ?? {}).length === 1));
  check("keys were handed over for the two hands only (16 cards), each sealed to its owner, none in the open", shares.length === 16 && sealed, { n: shares.length, sealed });
  check("the deck's status lines are gone from both HUDs", !(await F("a", "hud")).some((t) => /Waiting|shuffl/i.test(t)) && !(await F("b", "hud")).some((t) => /Waiting|shuffl/i.test(t)), { a: await F("a", "hud"), b: await F("b", "hud") });
  check("nothing failed to load in either view", (await F("a", "loading")).errors === 0 && (await F("b", "loading")).errors === 0, { a: await F("a", "loading"), b: await F("b", "loading") });
  await sleep(600);
  await shot("3-dealt");
  report.times = Object.fromEntries(report.timeline.map((e) => [e.what, e.t]));

  const errors = (await js("window.__p.errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
