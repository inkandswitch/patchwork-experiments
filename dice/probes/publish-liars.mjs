// Publish a Liar's dice table to a real sync server, and print its Patchwork URL.
//
//   (in scene/ and dice/) pnpm build
//   node probes/publish-liars.mjs [--sync wss://…] [--settle 8000] [--dry-run] [--show] [--shots <dir>]
//
// Makes NEW docs on every run (no dedupe).
//
// The table is made the way a person makes it: from the scene's start
// screen. In headless Chrome, the BUILT scene tool with the BUILT dice
// plugins (exactly the packages stated below, nothing else, each registered
// with its package URL) is mounted on one EMPTY scene (liars-template-probe.html: real
// Automerge docs, two peers A and B, each with its own replica), and A picks
// "Liar's dice" (scene:template `dice.liars-dice`) on the start screen, by a
// real click once the template list has held still (it reflows as packages
// register). B opens the scene after. It checks:
// - the start screen offers it;
// - A's replica has the table: 6 cups (each lifted, nobody's, nothing
//   shaken, no draw), 30 dice, the table and the pool, and nothing else;
// - doc.assets has a file for each thing drawn (table, pool, a cup and a die
//   per colour: 14), every object shows one of them, every one of them is
//   shown, and every file is a GLB with bytes;
// - six seats, nobody in them, and A's seat picker offers each;
// - the view starts in "play", in the hand, and A lands in play;
// - every piece is built in A, every die read from its GLB as a d6;
// - everything the doc calls for (each object's provider, each trait, the
//   activity it starts in) is answered by a plugin installed here (scene's
//   and dice's, nothing else), and A's stage, given each plugin's package
//   URL as the host gives it, lists exactly those two packages and names
//   the scene package as the suggested import;
// - B opens it in play, its replica holds the same table, every piece built;
// - nothing failed to load in either view, and no errors on the page;
// - the scene names no doc but its own files and its packages (no viewer,
//   no contact).
// Then (unless --dry-run) it publishes the table as the template left it
// (before B opened it, before anyone sat): its files first, then the scene,
// each made anew on the server with the urls between them rewritten,
// checked from a repo that has never seen them, and prints the scene's URL.
//
// The published scene names the scene package as its suggested import and
// lists the two packages it is made of: the scene's (seats are its part) and
// dice's (the dice, the cups, their draws and the template). Nothing of
// keep's: a liar's dice table has no deck, and the dice draw their own lots.
// Each package's URL is its `pushwork url` (probes/scene-packages.mjs). The
// list is stated here (PACKAGES) and must be the one A's stage made from
// what the table calls for: a table that needs a package not stated here
// fails, and nothing is published.
//
// --dry-run makes the table in the page and checks it, but publishes
// nothing. --show runs Chrome with a window; --shots <dir> is where the
// screenshots go; --settle <ms> is how long to wait after writing before
// checking the server has every doc; --sync <url> (or PATCHWORK_SYNC) is the
// sync server.

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { packageProblems, pushworkUrl, scenePackages, withPackages } from "./scene-packages.mjs";
import { browser, checklist, sleep } from "./cdp.mjs";

// the packages the published scene lists (scene/STAGE.md, "Packages")
const PACKAGES = ["scene", "dice"];
const TEMPLATE = "dice.liars-dice";
const CUPS = 6;
const DICE = 30;
// table, pool, and a cup and a die for each of the six colours
const FILES = 2 + 2 * CUPS;
const SEATS = ["seat1", "seat2", "seat3", "seat4", "seat5", "seat6"];

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
// It publishes by default, so a flag it doesn't know (--help, a typo of
// --dry-run) stops it here, before anything starts, with the usage above.
const KNOWN = new Set(["sync", "settle", "dry-run", "show", "shots"]);
const unknown = Object.keys(args).filter((k) => !KNOWN.has(k));
const stray = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--") && args[all[i - 1].slice(2)] === a));
// the flags that take a value must have one, and --dry-run and --show none
const VALUED = ["sync", "settle", "shots"];
const valueless = VALUED.filter((k) => k in args && typeof args[k] !== "string");
const valued = ["dry-run", "show"].filter((k) => k in args && args[k] !== true);
const badSettle = typeof args.settle === "string" && !(Number(args.settle) >= 0);
if (unknown.length || stray.length || valueless.length || valued.length || badSettle) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  const usage = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n");
  if (!unknown.includes("help")) {
    const said = [];
    if (unknown.length + stray.length) said.push(`unknown argument${unknown.length + stray.length === 1 ? "" : "s"}: ${[...unknown.map((k) => `--${k}`), ...stray].join(" ")}`);
    for (const k of valueless) said.push(`--${k} needs a value`);
    for (const k of valued) said.push(`--${k} takes no value (got ${JSON.stringify(args[k])})`);
    if (badSettle) said.push(`--settle is a number of ms, not ${JSON.stringify(args.settle)}`);
    console.error(`${said.join("\n")}\n`);
  }
  console.error(usage);
  process.exit(unknown.includes("help") && unknown.length === 1 && !stray.length ? 0 : 2);
}
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const SETTLE = Number(args.settle ?? 8000);

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of PACKAGES) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist/index.js: build it first`);
// every package's URL is known before anything is made (this throws if one isn't synced)
withPackages({ "@patchwork": { type: "scene" } }, PACKAGES);
const STATED = scenePackages(PACKAGES).map((e) => e.url);
const SCENE_URL = pushworkUrl("scene");
/** The same package URLs, each once, in any order? */
const sameSet = (a, b) => new Set(a).size === a.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const SHOTS = resolve(typeof args.shots === "string" ? args.shots : join(process.env.TMPDIR || tmpdir(), "liars-template"));

const b = await browser({ root: ROOT, port: 4894, cdp: 9894, page: `/dice/probes/liars-template-probe.html?${PACKAGES.map((p) => `${p}=${encodeURIComponent(pushworkUrl(p))}`).join("&")}`, width: 1416, height: 530, show: !!args.show, timeout: 600_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
// (an expression for until() starts with one of __p's own: it is read as window.__p.<expr>)
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const Q = JSON.stringify;
const list = checklist();
const { check } = list;
const report = { template: TEMPLATE, checks: list.checks, details: list.details, shots: [] };
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `liars-${name}.png`)));
const AM = /automerge:[1-9A-HJ-NP-Za-km-z]+/g;

let snapshot = null;
try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  check("A's start screen offers Liar's dice", await until(`templates('a').includes(${Q(TEMPLATE)})`, 15_000), await P("templates('a')"));
  // the start screen rebuilds its list whenever another package registers templates, so a button found
  // early can move before the click lands (on another template, or Blank): click once it has held still
  let tpl = await until(`template('a', ${Q(TEMPLATE)})`, 15_000);
  let still = 0;
  for (const t0 = Date.now(); still < 3 && Date.now() - t0 < 15_000; ) {
    await sleep(400);
    const now = await P(`template('a', ${Q(TEMPLATE)})`);
    still = now && tpl && now.x === tpl.x && now.y === tpl.y ? still + 1 : 0;
    tpl = now;
  }
  check("its button held still for 1.2 s before the click", !!tpl && still >= 3, { tpl, still });
  await shot("start");
  await b.click(tpl.x, tpl.y);

  // ── the table, in A's replica ──
  const want = `count('a').cups === ${CUPS} && __p.count('a').dice === ${DICE}`;
  const laid = await until(want, 15_000);
  const c = await P("count('a')");
  const names = [...c.names].sort();
  const SETS = ["Red", "Blue", "Green", "Yellow", "Purple", "Black"];
  const wantNames = ["Table", "Pool", ...SETS.flatMap((s) => [`${s} cup`, ...[1, 2, 3, 4, 5].map((i) => `${s} die ${i}`)])].sort();
  check(`the table is laid out: ${CUPS} cups, ${DICE} dice, the table and the pool, and nothing else`, laid && Q(names) === Q(wantNames), { cups: c.cups, dice: c.dice, all: c.all, missing: wantNames.filter((n) => !names.includes(n)), extra: names.filter((n) => !wantNames.includes(n)) });
  check("every cup is as the template lays one out: lifted, nobody's, nothing shaken, no draw", c.freshCups === CUPS, c.freshCups);
  const assetsLaid = await until(`doc('a').assets && Object.keys(__p.doc('a').assets).length === ${FILES} && Object.values(__p.doc('a').assets).every((a) => a.url)`, 30_000);
  const d = await P("doc('a')");
  check(`doc.assets has a file for each thing drawn (${FILES})`, assetsLaid, { have: Object.keys(d.assets ?? {}) });
  check("every object shows one of the scene's files, and every file is shown", (await P("strays()")).length === 0 && (await P("unshown()")).length === 0, { strays: await P("strays()"), unshown: await P("unshown()") });
  const seats = await P("seats('a')");
  check(`six seats (${SEATS.join(", ")}), each named and with a camera, nobody in them`, Q(Object.keys(seats ?? {}).sort()) === Q(SEATS) && Object.values(seats).every((s) => typeof s.name === "string" && s.name && s.camera?.position?.length === 3 && s.camera?.target?.length === 3 && !s.player), seats);
  check("A is told to pick a seat (the seats' owner was found)", await until("notices('a').some((n) => /^Pick a seat \\(top right\\)\\. Hover your cup/.test(n))", 5000), await P("notices('a')"));
  check("A's seat picker offers every seat", await until(`picker('a').filter((s) => ${Q(SEATS)}.includes(s)).length === ${SEATS.length}`, 10_000), await P("picker('a')"));
  check(`the doc says it's Liar's dice and starts in "play", in the hand`, d.title === "Liar's dice" && d.view?.activity === "play" && d.view?.tool === "hand", { title: d.title, view: d.view });
  check("A lands in play", await until("activity('a') === 'play'", 5000), await P("activity('a')"));
  const builtA = await until(`built('a').loaded === ${CUPS + DICE + 2} && __p.built('a').diceRead === ${DICE}`, 120_000);
  check(`every piece is built in A (${CUPS + DICE + 2}), every die read from its GLB as a d6`, builtA, await P("built('a')"));
  check("the cups and the dice's own lots run in A", await until("running('a').includes('dice.cup') && __p.running('a').includes('dice.lots')", 5000), await P("running('a')"));
  // what the table needs, from the doc: all of it installed here (scene and dice only), and the
  // stage's own list of the packages it comes from (true by construction) is exactly the one stated
  check(`everything the doc calls for is answered by a plugin installed here (${PACKAGES.join(" and ")}'s only)`, (await P("unanswered()")).length === 0, await P("unanswered()"));
  const listedOk = await until(`doc('a') && ((d) => d.patchwork?.suggestedImportUrl === ${Q(SCENE_URL)} && ${Q(JSON.stringify([...STATED].sort()))} === JSON.stringify((d.packages ?? []).map((e) => e?.url).sort()))(__p.doc('a'))`, 10_000);
  const listed = await P("doc('a')");
  check(`A's stage lists exactly the stated packages (${PACKAGES.join(", ")}) and the scene package as the suggested import`, listedOk, { stated: STATED, listed: listed.packages, suggestedImportUrl: listed.patchwork?.suggestedImportUrl });
  await shot("laid");
  // the table as the template left it: before B opened it, before anyone sat
  snapshot = await P("snapshot()");

  // ── B opens it ──
  await P("openB()");
  check("B's replica has the same table", await until(`count('b').cups === ${CUPS} && __p.count('b').dice === ${DICE} && __p.count('b').all === ${CUPS + DICE + 2}`, 15_000), await P("count('b')"));
  check("B opens it in play", await until("activity('b') === 'play'", 15_000), await P("activity('b')"));
  check("B's seat picker offers every seat", await until(`picker('b').filter((s) => ${Q(SEATS)}.includes(s)).length === ${SEATS.length}`, 10_000), await P("picker('b')"));
  check(`every piece is built in B, every die read as a d6`, await until(`built('b').loaded === ${CUPS + DICE + 2} && __p.built('b').diceRead === ${DICE}`, 120_000), await P("built('b')"));
  check("both replicas hold the same scene (the same heads)", await until("same()", 10_000), null);
  await sleep(500);
  const loading = { a: await P("loading('a')"), b: await P("loading('b')") };
  check("nothing failed to load, and nothing is still loading, in either view", loading.a.errors === 0 && loading.b.errors === 0 && loading.a.loading === 0 && loading.b.loading === 0, loading);
  await shot("both");
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors);

  // ── what would be published ──
  const files = Object.keys(snapshot.docs).filter((u) => u !== snapshot.scene);
  const sceneDoc = snapshot.docs[snapshot.scene];
  const isGLB = (f) => f?.["@patchwork"]?.type === "file" && f.mimeType === "model/gltf-binary" && f.extension === "glb" && typeof f.content?.$bytes === "string" && f.content.$bytes.length > 0;
  check(`the snapshot is the scene and its ${FILES} files, each a GLB with bytes`, files.length === FILES && files.every((u) => isGLB(snapshot.docs[u])), files.map((u) => ({ u, type: snapshot.docs[u]?.["@patchwork"]?.type, mimeType: snapshot.docs[u]?.mimeType, bytes: snapshot.docs[u]?.content?.$bytes?.length ?? 0 })));
  const named = [...new Set(JSON.stringify(sceneDoc).match(AM) ?? [])];
  const outside = named.filter((u) => u !== snapshot.scene && !files.includes(u) && !STATED.includes(u));
  check("the scene names no doc but its own files and its packages (no viewer, no contact)", outside.length === 0 && !snapshot.contacts.some((u) => named.includes(u)), { outside });
  check(`the snapshot is the laid-out table, starting in play`, Object.values(sceneDoc.objects ?? {}).filter((o) => o.kind !== "group").length === CUPS + DICE + 2 && sceneDoc.view?.activity === "play", { objects: Object.keys(sceneDoc.objects ?? {}).length, view: sceneDoc.view });
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
if (list.failed || !snapshot) b.stop(1);
else await publish(snapshot).then((code) => b.stop(code), (err) => {
  console.error(err?.stack ?? err);
  b.stop(1);
});

/** Stamp the packages, then (unless a dry run) publish files first and the scene last. Resolves to an exit code. */
async function publish(snapshot) {
  // the packages are stated here, and must be the ones A's stage listed from what the table calls for:
  // stating them changes nothing, and nothing else is listed
  const asMade = snapshot.docs[snapshot.scene];
  const docs = { ...snapshot.docs, [snapshot.scene]: withPackages(asMade, PACKAGES) };
  const stamped = packageProblems(docs[snapshot.scene], PACKAGES);
  const urls = (doc) => (Array.isArray(doc.packages) ? doc.packages.map((e) => e?.url) : []);
  if (!sameSet(urls(asMade), STATED)) stamped.push(`the stage listed ${Q(urls(asMade))}, not the stated ${Q(STATED)}`);
  if (Q(urls(docs[snapshot.scene])) !== Q(urls(asMade)) || asMade["@patchwork"]?.suggestedImportUrl !== SCENE_URL) stamped.push("stating the packages changed the scene the stage made");
  if (stamped.length) {
    for (const p of stamped) console.error(`  ${p}`);
    return 1;
  }
  const scene = docs[snapshot.scene];
  console.log(`table: ${Object.keys(scene.objects).length} objects, ${Object.keys(scene.assets).length} files, ${Object.keys(scene.traits["scene.seats"]).length} seats, starts in ${scene.view.activity}; suggested import ${scene["@patchwork"].suggestedImportUrl}; packages: ${scene.packages.map((e) => e.url).join(" ")}`);
  if (DRY) {
    console.log(`dry run: ${Object.keys(docs).length} docs (nothing published)`);
    return 0;
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
  // files first, then the scene, pointing at the new urls
  const files = Object.keys(docs).filter((u) => u !== snapshot.scene);
  for (const u of files) renamed.set(u, (await repo.create2(revive(docs[u]))).url);
  const table = await repo.create2(rewrite(scene));
  const glbs = [...renamed.values()];
  const made = [table.url, ...glbs];
  const bytesOf = Object.fromEntries(files.map((u) => [renamed.get(u), Buffer.from(docs[u].content.$bytes, "base64").length]));

  await repo.flush?.();
  await new Promise((r) => setTimeout(r, SETTLE));
  const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const missing = [];
  for (const url of made) {
    try {
      const got = (await within(30000, checker.find(url))).doc();
      let problem = !got || !Object.keys(got).length ? "empty" : null;
      if (!problem && url === table.url) {
        const pp = packageProblems(got, PACKAGES);
        const sources = Object.values(got.objects ?? {}).filter((o) => o.kind !== "group").map((o) => o.sourceUrl);
        if (pp.length) problem = `came back wrong: ${pp.join("; ")}`;
        else if (!sameSet(urls(got), STATED)) problem = `came back listing ${Q(urls(got))}, not ${Q(STATED)}`;
        else if (got.view?.activity !== "play") problem = `came back with view.activity ${JSON.stringify(got.view?.activity)}`;
        else if (sources.length !== CUPS + DICE + 2 || !sources.every((s) => glbs.includes(s))) problem = "came back with objects that don't show the published files";
        else if (files.some((u) => JSON.stringify(got).includes(u))) problem = "still names a doc from the page";
      }
      if (!problem && glbs.includes(url) && got.content?.byteLength !== bytesOf[url]) problem = `a GLB doc with ${got.content?.byteLength ?? 0} bytes, not ${bytesOf[url]}`;
      if (problem) missing.push(`${url} (${problem})`);
    } catch (err) {
      missing.push(`${url} (${err?.message ?? err})`);
    }
  }
  console.log(`verified ${made.length - missing.length}/${made.length} docs from a fresh repo`);
  if (missing.length) {
    for (const m of missing) console.error(`  missing ${m}`);
    console.error(`\nNOT verified: re-run, or raise --settle.`);
    return 1;
  }
  console.log(`\n  table  https://patchwork.inkandswitch.com/#doc=${table.url}\n`);
  return 0;
}
