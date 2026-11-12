// Seats held by claims, at a Lost Cities table, by two people in headless Chrome.
//
//   (in scene/, tabletop/ and keep/) pnpm build
//   node probes/seats.mjs [--shots <dir>] [--show]
//
// Mounts the BUILT scene tool (the seats are its own part) with the BUILT
// tabletop and keep plugins on a Lost
// Cities table set up as the game page does, twice on one doc (A is Ana, B is
// Ben, with real presence between them; seats-probe.html). Then:
// - A sits in Player 1, and claims it;
// - B opens the table and, within a second, chooses Player 1: B is refused
//   with a notice, never asked to confirm, and A keeps the seat;
// - each view's name tags say who sits where;
// - A drops off the network without a goodbye (still running); after the
//   presence TTL B sees Player 1 as away, and takes it only after confirming;
// - A, back to hearing the doc, is told its seat was taken, and writes nothing.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "keep/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "tabletop-seats"));
const PEER_TTL_MS = 15_000; // scene/src/stage/presence.js

const b = await browser({ root: ROOT, port: 4771, cdp: 9771, page: "/tabletop/probes/seats-probe.html", width: 1416, height: 530, show: process.argv.includes("--show"), timeout: 180_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `seats-${name}.png`)));

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const viewers = await P("viewers");
  check("A's picker is up, playing", await until("options('a')?.length === 3 && __p.activity('a') === 'play'"), { options: await P("options('a')") });

  // ── A sits in Player 1 ──
  await P("pick('a', 'p1')");
  const sessionA = await P("session('a')");
  check("A sits in Player 1, and holds its claim", await until(`seats().p1.player === ${JSON.stringify(viewers.a)} && __p.claim('p1')?.session === ${JSON.stringify(sessionA)}`), { seats: await P("seats()"), claim: await P("claim('p1')") });
  check("A is told it sat down", await until("notices('a').includes('You sat down as Player 1')", 2000), await P("notices('a')"));
  mark("A sat in p1");

  // ── B opens the table and, within a second, chooses Player 1 ──
  // B opens before it has heard a word from A (A's presence held back): only
  // the claim in the doc, read inside its grace period, says A is here.
  // (mounting is one synchronous call on the page: B is open once it returns)
  await P("cut('a')");
  await P("joinB()");
  const opened = Date.now();
  const shown = await until("options('b')?.length === 3", 1000);
  mark("B's picker up", { ms: Date.now() - opened, shown });
  const firstOptions = await P("options('b')");
  // whether B has heard A's presence yet: if not, it's the claim's grace that stops B
  const heardA = await P(`heard('b', ${JSON.stringify(sessionA)})`);
  await P("pick('b', 'p1', true)");
  const pickedAfter = Date.now() - opened;
  mark("B chose p1", { ms: pickedAfter, heardA, options: firstOptions });
  check("B chose within a second of opening", pickedAfter < 1000, pickedAfter);
  check("B hadn't heard from A when it chose", heardA === false, heardA);
  check("B saw Player 1 as taken from its first look", firstOptions?.[1]?.[1] === "Player 1 (taken)", firstOptions);
  await sleep(300);
  check("B is refused with a notice naming who sits there", (await P("notices('b')")).includes("Ana is sitting there."), await P("notices('b')"));
  check("B was never asked to confirm", (await P("confirms()")).length === 0, await P("confirms()"));
  check("A keeps Player 1", (await P("seats()")).p1.player === viewers.a && (await P("claim('p1')"))?.session === sessionA, { seats: await P("seats()"), claim: await P("claim('p1')") });
  check("B's picker is back on Watching", (await P("picked('b')")) === "", await P("picked('b')"));
  check("A heard no one take its seat", !(await P("notices('a')")).some((n) => /first|while you were away/.test(n)), await P("notices('a')"));
  check("B's name tags say who sits where", await until("tags('b').join('|') === 'Player 1 · Ana|Player 2 · free'", 3000), await P("tags('b')"));
  check("A's name tags too", await until("tags('a').join('|') === 'Player 1 · Ana|Player 2 · free'", 3000), await P("tags('a')"));
  await shot("refused");

  // ── A's presence arrives: B still can't take the seat, now because A is here ──
  await P("uncut('a')");
  check("B hears from A", await until(`heard('b', ${JSON.stringify(sessionA)})`, 8000));
  mark("B heard A");
  await P("pick('b', 'p1', true)");
  check("B is refused again, without a confirm", await until("notices('b').filter((n) => n === 'Ana is sitting there.').length === 2", 2000) && (await P("confirms()")).length === 0, { notices: await P("notices('b')"), confirms: await P("confirms()") });
  check("A still has Player 1", (await P("claim('p1')"))?.session === sessionA, await P("claim('p1')"));

  // ── A drops off the network (no goodbye); after the presence TTL, B can take the seat, asking first ──
  await P("cut('a')");
  mark("A cut off");
  check("while A might still be here, B still sees Player 1 taken", (await P("options('b')"))[1][1] === "Player 1 (taken)", await P("options('b')"));
  const away = await until("options('b')[1][1] === 'Player 1 (away)'", PEER_TTL_MS + 6000);
  mark("B sees p1 away");
  check("after the presence TTL, B sees Player 1 as away", away, await P("options('b')"));
  check("…and its name tag says so", (await P("tags('b')"))[0] === "Player 1 · Ana (away)", await P("tags('b')"));
  await P("pick('b', 'p1', false)");
  check("taking it asks first, naming who's away", (await P("confirms()")).at(-1) === "Ana is away. Take their seat? You'll see what's theirs.", await P("confirms()"));
  check("saying no leaves it", (await P("seats()")).p1.player === viewers.a && (await P("picked('b')")) === "", await P("seats()"));
  await P("pick('b', 'p1', true)");
  const sessionB = await P("session('b')");
  check("saying yes, B sits in Player 1 and holds its claim", await until(`seats().p1.player === ${JSON.stringify(viewers.b)} && __p.claim('p1')?.session === ${JSON.stringify(sessionB)}`, 3000), { seats: await P("seats()"), claim: await P("claim('p1')") });
  mark("B took p1");
  // A still hears the doc (only its presence was cut): told, and it writes nothing back
  check("A is told its seat was taken while it was away", await until("notices('a').includes(\"Ben took Player 1 while you were away; you're watching\")", 3000), await P("notices('a')"));
  await sleep(500);
  check("A wrote nothing back: Ben keeps Player 1", (await P("seats()")).p1.player === viewers.b && (await P("claim('p1')"))?.session === sessionB, { seats: await P("seats()"), claim: await P("claim('p1')") });
  check("A's picker shows it watching", (await P("picked('a')")) === "", await P("picked('a')"));
  await shot("taken-over");

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
