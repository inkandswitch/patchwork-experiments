// Publish "Lost Cities aboard" to a real sync server, and print its Patchwork
// URL: a Lost Cities table in the cockpit of the sloop, lying at anchor.
//
//   (in scene/, sailing/, tabletop/, card-table/, keep/, joints/ and traversal/) pnpm build
//   node probes/publish-aboard.mjs [--sync wss://…] [--settle 8000] [--dry-run] [--show] [--shots <dir>] [--title "…"] [--below <url>]
//   node probes/publish-aboard.mjs --set-below <scene url> <url> [--sync wss://…] [--settle 8000] [--dry-run]
//
// Makes NEW docs on every run (no dedupe).
//
// Her companionway is an exit (traversal's) that leads nowhere: --below
// <url> publishes it leading there (its `to`). --set-below changes only that,
// on a scene already published (one change to its doc, checked from a fresh
// repo), and makes nothing new.
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
// the scene, the ship's, the table's and the secure deck's, and the two her
// companionway's traits are for (its hatch's slide, its exit). In a real
// shell the stage works these out from the registry; the probe page has none
// that says where its plugins come from, so they're stated here.
const PACKAGES = ["scene", "sailing", "tabletop", "card-table", "joints", "traversal"];
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

// --flag (no value), --flag <value>, and --set-below <scene> <url>
const ARITY = { sync: 1, settle: 1, "dry-run": 0, show: 0, shots: 1, title: 1, below: 1, "set-below": 2 };
const args = {};
const bad = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const k = a.startsWith("--") ? a.slice(2) : null;
  if (k == null || !(k in ARITY)) {
    bad.push(a);
    continue;
  }
  const vals = process.argv.slice(i + 1, i + 1 + ARITY[k]);
  if (vals.length < ARITY[k] || vals.some((v) => v.startsWith("--"))) {
    bad.push(`${a} (wants ${ARITY[k]} value${ARITY[k] === 1 ? "" : "s"})`);
    continue;
  }
  args[k] = ARITY[k] === 0 ? true : ARITY[k] === 1 ? vals[0] : vals;
  i += ARITY[k];
}
const LINK = /^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}$/;
if (typeof args.below === "string" && !LINK.test(args.below)) bad.push(`--below ${args.below} (not a bare automerge URL)`);
if (args["set-below"] && !args["set-below"].every((u) => LINK.test(u))) bad.push(`--set-below ${args["set-below"].join(" ")} (not two bare automerge URLs)`);
if (args.below && args["set-below"]) bad.push("--below with --set-below (one publishes a new scene, the other changes a published one)");
// It publishes by default, so a flag it doesn't know (--help, a typo of
// --dry-run) stops it here, before any repo exists, with the usage above.
if (bad.length) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  const usage = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n");
  const help = bad.length === 1 && bad[0] === "--help";
  if (!help) console.error(`unknown or bad argument${bad.length === 1 ? "" : "s"}: ${bad.join(" ")}\n`);
  console.error(usage);
  process.exit(help ? 0 : 2);
}
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const TITLE = typeof args.title === "string" ? args.title : "Lost Cities aboard";
const BELOW = args.below ?? null;
const EXIT = "traversal.exit";

if (args["set-below"]) {
  await setBelow(...args["set-below"]);
  process.exit(0);
}

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene/dist/index.js", "sailing/dist/index.js", "tabletop/dist/index.js", "card-table/dist/index.js", "keep/dist/index.js", "joints/dist/index.js", "traversal/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
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
  check("her companionway is under her, an exit that leads nowhere (\"Go below\"), the only exit; its hatch under it, shut", s.companionway?.parent === ids.hull && JSON.stringify(s.companionway.exit) === JSON.stringify({ verb: "Go below" }) && s.exits === 1 && s.hatch?.parent === ids.companionway && s.hatch.slide?.at === "closed", { companionway: s.companionway, hatch: s.hatch, exits: s.exits });
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
  // where her companionway leads, when asked: its exit's `to`, and nothing else
  const exits = Object.entries(docs[snap.scene].objects).filter(([, o]) => o.traits?.[EXIT]);
  if (BELOW) {
    const scene = structuredClone(docs[snap.scene]);
    for (const [id] of exits) scene.objects[id].traits[EXIT].to = BELOW;
    docs[snap.scene] = scene;
  }
  const leads = Object.values(docs[snap.scene].objects).filter((o) => o.traits?.[EXIT]).map((o) => o.traits[EXIT].to ?? null);
  if (exits.length !== 1 || leads[0] !== BELOW) {
    console.error(`  her companionway should lead to ${BELOW ?? "nowhere"}; the exits lead to ${JSON.stringify(leads)}`);
    return b.stop(1);
  }
  console.log(`her companionway leads ${BELOW ? `to ${BELOW}` : "nowhere"}`);
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
        else if ((Object.values(got.objects).find((o) => o.traits?.[EXIT])?.traits[EXIT].to ?? null) !== BELOW) problem = `came back with her companionway leading somewhere else than ${BELOW ?? "nowhere"}`;
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

// ─── --set-below: where a published scene's companionway leads ──────────────
async function setBelow(sceneUrl, url) {
  if (DRY) {
    console.log(`dry run: would set ${sceneUrl}'s companionway to lead to ${url} (one change), and check it from a fresh repo; nothing touched`);
    return;
  }
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  console.log(`connected to ${SYNC}`);
  const handle = await within(30000, repo.find(sceneUrl));
  const doc = handle.doc();
  const exits = Object.entries(doc?.objects ?? {}).filter(([, o]) => o.traits?.[EXIT]);
  const ship = Object.values(doc?.objects ?? {}).some((o) => o.traits?.["sailing.ship"]);
  if (doc?.["@patchwork"]?.type !== "scene" || !ship || exits.length !== 1 || exits[0][1].name !== "Companionway") {
    console.error(`  ${sceneUrl} isn't a scene with a ship and one exit, her companionway (it has ${exits.length} exit${exits.length === 1 ? "" : "s"}: ${exits.map(([, o]) => o.name).join(", ") || "none"})`);
    process.exit(1);
  }
  const [id] = exits[0];
  const before = exits[0][1].traits[EXIT].to ?? null;
  handle.change((d) => {
    d.objects[id].traits[EXIT].to = url;
  });
  await repo.flush?.();
  await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
  const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const got = (await within(30000, checker.find(sceneUrl))).doc();
  const now = got?.objects?.[id]?.traits?.[EXIT]?.to ?? null;
  console.log(`her companionway led to ${before ?? "nowhere"}; from a fresh repo it now leads to ${now ?? "nowhere"}`);
  if (now !== url) {
    console.error(`\nNOT verified: re-run, or raise --settle.`);
    process.exit(1);
  }
  process.exit(0);
}
