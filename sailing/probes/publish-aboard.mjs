// Publish "Lost Cities aboard" to a real sync server, and print its Patchwork
// URL: a Lost Cities table in the cockpit of the sloop, lying at anchor.
//
//   (in scene/, sailing/, tabletop/ and card-table/) pnpm build
//   node probes/publish-aboard.mjs [--sync wss://…] [--settle 8000] [--dry-run] [--show] [--shots <dir>] [--title "…"]
//
// Makes NEW docs on every run (no dedupe).
//
// The scene is made the way a person makes it, by the tools themselves, so
// the doc is exactly what they write: in headless Chrome, the BUILT scene
// tool with the BUILT sailing, tabletop and card-table plugins is mounted on
// an EMPTY scene (aboard-probe.html: an in-memory repo, two views A and B),
// and A picks "Ship at anchor" on the start screen, then puts the parts
// bin's Card table in her cockpit and Lost Cities on the table (api.part),
// and a home view over the cockpit is set. It checks:
// - every piece is under the table and the table under the hull; the deck
//   is a secure-deck (card-table is installed); it opens in play, with the
//   sail down and the anchor down; each seat's view is in the table's frame;
// - every object shows one of the scene's own files;
// - with A and B seated, the secure deck reaches "playing" and each hand's
//   faces reach its player.
// Then (unless --dry-run) it publishes the scene as it was before anyone sat:
// its files, its deck and the scene, each made anew on the server with the
// urls between them rewritten, and the claims of the views that made it
// (who simulated her) left out. It checks every doc from a fresh repo.
//
// --dry-run makes and checks it all in the browser, but publishes nothing.
// (probes/aboard-run.mjs plays it: at anchor, under way, first person.)

import { join, resolve, dirname } from "node:path";
import { packageProblems, withPackages } from "./scene-packages.mjs";

// The published scene names the scene package as its suggested import and
// lists the packages its contents come from (scene/STAGE.md, "Packages"):
// the scene, the ship's, the table's and the secure deck's. In a real shell
// the stage works these out from the registry; the probe page has none that
// says where its plugins come from, so they're stated here.
const PACKAGES = ["scene", "sailing", "tabletop", "card-table"];
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
// It publishes by default, so a flag it doesn't know (--help, a typo of
// --dry-run) stops it here, before any repo exists, with the usage above.
const KNOWN = new Set(["sync", "settle", "dry-run", "show", "shots", "title"]);
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
const TITLE = typeof args.title === "string" ? args.title : "Lost Cities aboard";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene/dist/index.js", "sailing/dist/index.js", "tabletop/dist/index.js", "card-table/dist/index.js", "keep/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const SHOTS = resolve(typeof args.shots === "string" ? args.shots : join(process.env.TMPDIR || tmpdir(), "sailing-aboard"));

// ─── make it in the browser, with the tools ─────────────────────────────────
const { browser, checklist, sleep } = await import("./cdp.mjs");
const b = await browser({ root: ROOT, port: 4796, cdp: 9796, page: "/sailing/probes/aboard-probe.html", width: 1416, height: 530, show: !!args.show, timeout: 600_000 });
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [] };
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const J = JSON.stringify;
let snapshot = null;
try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  check("the start screen offers Ship at anchor", await until("templates('a').includes('ship-at-anchor')", 20_000), await P("templates('a')"));
  const ids = await P(`build({ title: ${J(TITLE)} })`, 120_000);
  check("built through the start screen and the parts bin", !ids.error && ids.table && ids.board, ids);
  const s = await P("shape()");
  check("every piece under the table, the table under the hull", s.pieces === 63 && s.piecesUnderTable === 63 && s.tableParent === ids.hull, s);
  check("a secure deck", s.deckType === "secure-deck", s.deckType);
  check("in play, sail down, anchor down, a home view over the cockpit", s.activity === "play" && s.sail?.raised === 0 && s.anchor?.down === true && !!s.home, { activity: s.activity, sail: s.sail, anchor: s.anchor, home: s.home });
  check("each seat's view is in the table's frame", Object.values(s.seats ?? {}).length === 2 && Object.values(s.seats).every((x) => x.camera?.in === ids.table), s.seats);
  check(`titled “${TITLE}”`, s.title === TITLE && s.deckTitle === `${TITLE}: Deck`, { title: s.title, deck: s.deckTitle });
  check("everything loads", await until("loaded('a').loaded === __p.loaded('a').total", 120_000), await P("loaded('a')"));
  const snap = await P("snapshot()");
  const assets = new Set(Object.values(snap.docs[snap.scene].assets ?? {}).map((a) => a.url));
  const strays = Object.entries(snap.docs[snap.scene].objects).filter(([, o]) => o.kind !== "group" && !assets.has(o.sourceUrl)).map(([id]) => id);
  check("every object shows one of the scene's own files", strays.length === 0, strays);
  snapshot = snap;
  await P("openB()");
  check("B opens it in play", await until("activity('b') === 'play' && __p.picker('a') === 3 && __p.picker('b') === 3", 30_000));
  await P("pick('a', 'p1')");
  await P("pick('b', 'p2')");
  const viewers = await P("viewers");
  check("A and B seated", await until(`seats().p1.player === ${J(viewers.a)} && __p.seats().p2.player === ${J(viewers.b)}`), await P("seats()"));
  const playing = await until("phase() === 'playing' && __p.faces('a').length >= 8 && __p.faces('b').length >= 8", 180_000);
  check("the secure deck reaches playing, each hand's faces delivered", playing, { phase: await P("phase()"), a: (await P("faces('a')")).length, b: (await P("faces('b')")).length });
  await sleep(500);
  report.shots.push(await b.shot(join(SHOTS, "publish-seated.png")));
  check("nothing failed to load", (await P("loading('a')")).errors === 0, await P("loading('a')"));
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors.slice(0, 12));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
if (list.failed || !snapshot) b.stop(1);
else await publish(snapshot);

// ─── publish the scene as it was before anyone sat ──────────────────────────
async function publish(snap) {
  const docs = { ...snap.docs, [snap.scene]: withPackages(snap.docs[snap.scene], PACKAGES) };
  const count = Object.keys(docs).length;
  const stamped = packageProblems(docs[snap.scene], PACKAGES);
  if (stamped.length) {
    for (const p of stamped) console.error(`  ${p}`);
    return b.stop(1);
  }
  if (DRY) {
    console.log(`dry run: ${count} docs (the scene, its deck and ${count - 2} files; nothing published)`);
    return b.stop(0);
  }
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  console.log(`connected to ${SYNC}`);
  const fromBytes = (v) => (v && typeof v === "object" && typeof v.$bytes === "string" ? new Uint8Array(Buffer.from(v.$bytes, "base64")) : v);
  const revive = (doc) => JSON.parse(JSON.stringify(doc), (k, v) => fromBytes(v));
  const renamed = new Map();
  const rewrite = (doc) => {
    let text = JSON.stringify(doc);
    for (const [from, to] of renamed) text = text.split(from).join(to);
    return revive(JSON.parse(text));
  };
  // nobody who made it is here: their claims (who simulated her) don't travel
  const unclaimed = (doc) => {
    const d = structuredClone(doc);
    delete d.claims;
    for (const o of Object.values(d.objects ?? {})) delete o.claims;
    return d;
  };
  // files first, then the deck, then the scene, each pointing at the new urls
  const files = Object.keys(docs).filter((u) => u !== snap.scene && u !== snap.deck);
  for (const u of files) renamed.set(u, (await repo.create2(revive(docs[u]))).url);
  if (snap.deck) renamed.set(snap.deck, (await repo.create2(rewrite(docs[snap.deck]))).url);
  const scene = await repo.create2(rewrite(unclaimed(docs[snap.scene])));
  const made = [scene.url, ...renamed.values()];
  const glbs = files.map((u) => renamed.get(u));

  await repo.flush?.();
  await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
  const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const missing = [];
  for (const url of made) {
    try {
      const got = (await within(30000, checker.find(url))).doc();
      let problem = !got || !Object.keys(got).length ? "empty" : null;
      if (!problem && url === scene.url) {
        const hull = Object.values(got.objects ?? {}).find((o) => o.traits?.["sailing.ship"]);
        const under = Object.values(got.objects ?? {}).filter((o) => o.traits?.["tabletop.card"]).length;
        if (packageProblems(got, PACKAGES).length) problem = `came back wrong: ${packageProblems(got, PACKAGES).join("; ")}`;
        else if (got.view?.activity !== "play") problem = `came back with view.activity ${J(got.view?.activity)}`;
        else if (!hull) problem = "came back without the ship";
        else if (under !== 60) problem = `came back with ${under} cards`;
        else if (got.claims) problem = "came back with claims";
      }
      if (!problem && glbs.includes(url) && !(got.content?.byteLength > 0)) problem = "a GLB doc with no bytes";
      if (problem) missing.push(`${url} (${problem})`);
    } catch (err) {
      missing.push(`${url} (${err?.message ?? err})`);
    }
  }
  console.log(`verified ${made.length - missing.length}/${made.length} docs from a fresh repo`);
  if (missing.length) {
    for (const m of missing) console.error(`  missing ${m}`);
    console.error(`\nNOT verified: re-run, or raise --settle.`);
    return b.stop(1);
  }
  console.log(`\n  scene  https://patchwork.inkandswitch.com/#doc=${scene.url}\n`);
  return b.stop(0);
}
