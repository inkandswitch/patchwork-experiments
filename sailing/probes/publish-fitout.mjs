// Publish "Fitting out" to a real sync server, and print its Patchwork URLs:
// pins and mirrors (scene/COMPOSITION.md §7; worked example 2, and a part
// repeated live). A sloop at anchor whose companionway is a fit-out F,
// linked and fixed at a version, with F changed since (its hatch open: the
// boat still shows it shut, until someone chooses Follow latest); and one
// hatch W that closes itself, linked live twice on her cabin top (the first
// acts, the second is its mirror: open one and both open).
//
//   (in scene/, sailing/, water/, weather/, joints/ and traversal/) pnpm build
//   node probes/publish-fitout.mjs [--sync wss://…] [--settle 8000] [--dry-run] [--show] [--shots <dir>] [--title "…"]
//
// Makes NEW docs on every run (no dedupe).
//
// The docs are made the way a person makes them, by the tools themselves
// (pins-probe.html: an in-memory repo, the BUILT scene, sailing, joints and
// traversal plugins): W and F from the parts bin's companionway, each in a
// view of its own; S from the start screen's "Ship at anchor", her own
// companionway taken out, F linked where it was and fixed there by the
// inspector's Fix at this version, W linked twice. Then F, open alone, has
// its hatch opened by its verb. It checks:
// - S holds the hull and the rig and none of F's or W's pieces; its link to
//   F is fixed, with F's files in its deps; its two links to W are live;
// - S's view opens F pinned (its hatch shut, as fixed) and W acting and
//   mirrored; F alone shows its hatch open.
// Then (unless --dry-run) it publishes: the files, W, F as it was when fixed,
// then F's change (so F's history holds both, and the pin's heads are F's
// heads on the server, not the probe's), then S, its link to F fixed at
// F's server heads, with its deps the files' server heads. It checks every
// doc from a fresh repo, and that F at the pinned heads has its hatch shut
// and F now has it open.
//
// --dry-run makes and checks it all in the browser, but publishes nothing.
// (probes/pins-run.mjs plays it: the pin drawn and never acted on, the
// mirror following the acting hatch, Follow latest and Fix at this version.)
//
// Simulated time: the page's stages run on its manual clock (window.__time).

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { packageProblems, pushworkUrl, withPackages } from "./scene-packages.mjs";
import { clipProblems } from "./clip-check.mjs";

// What each doc's contents come from (scene/STAGE.md, "Packages"): each
// lists its own only (the view's one prompt covers every open doc's:
// COMPOSITION.md, Decisions, links loose ends 1), and the page checks that
// each, open alone, calls for plugins of exactly those packages. (The docs
// as the page made them list more: a doc's packages list grows as parts are
// added and isn't pruned when they go, so S still lists the companionway's
// joints and traversal. Published, each lists the packages here.)
const PACKAGES = { s: ["scene", "sailing", "water", "weather"], f: ["scene", "joints", "traversal"], w: ["scene", "joints"] };
const SLIDE = "joints.slide";

const ARITY = { sync: 1, settle: 1, "dry-run": 0, show: 0, shots: 1, title: 1 };
const args = {};
const bad = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  const k = a.startsWith("--") ? a.slice(2) : null;
  if (k == null || !(k in ARITY)) {
    bad.push(a);
    continue;
  }
  const v = process.argv[i + 1];
  if (ARITY[k] && (v == null || v.startsWith("--"))) {
    bad.push(`${a} (wants a value)`);
    continue;
  }
  args[k] = ARITY[k] ? v : true;
  i += ARITY[k];
}
// It publishes by default, so a flag it doesn't know (--help, a typo of --dry-run) stops it here, with the usage above.
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
const TITLE = typeof args.title === "string" ? args.title : "Fitting out";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "sailing", "water", "weather", "joints", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist: build it first`);
const SHOTS = resolve(typeof args.shots === "string" ? args.shots : join(process.env.TMPDIR || tmpdir(), "sailing-fitout"));

// ─── make it in the browser, with the tools ─────────────────────────────────
// each package's plugins registered from its URL, so the page can say which package each plugin is from
const urls = Object.fromEntries(["scene", "sailing", "water", "weather", "joints", "traversal"].map((p) => [p, pushworkUrl(p)]));
const folderOf = (u) => Object.entries(urls).find(([, v]) => v === u)?.[0] ?? u;
const { browser, checklist, sleep } = await import("./cdp.mjs");
const b = await browser({ root: ROOT, port: 4797, cdp: 9797, page: `/sailing/probes/pins-probe.html?urls=${encodeURIComponent(JSON.stringify(urls))}`, width: 1700, height: 570, show: !!args.show, timeout: 600_000 });
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const loads = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 60);
const until = (expr, ms = 10_000) => b.soon(`window.__p.${expr}`, { frames: Math.ceil(ms / (1000 / 60)) });
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [] };
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const J = JSON.stringify;
let snapshot = null;
try {
  check("the page set up", (await b.waitFor("window.__ready", 60_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const ids = await P(`build({ title: ${J(TITLE)} })`, 300_000);
  check("made through the parts bin, the start screen and the inspector", ids && !ids.error && ids.fixed === true, ids);
  const s = await P("shape()");
  const fit = s.links.find((l) => l.id === ids.fitout);
  const hatches = s.links.filter((l) => l.id === ids.acting || l.id === ids.mirror);
  check("S holds the hull and the rig, none of F's or W's pieces; F fixed with its files in the deps; W linked live twice", s.hull && s.rig && s.boatSlides === 0 && s.boatExits === 0 && fit?.at && s.fAssets.every((u) => fit.at.deps.includes(u)) && hatches.length === 2 && hatches.every((l) => l.url === ids.w && !l.at), s);
  const links = await P("links()");
  check("S's view opens F pinned, W acting and mirrored", links.fitout?.role === "pinned" && links.acting?.role === "acting" && links.mirror?.role === "mirror" && Object.values(links).every((l) => l.open), links);
  check("everything loads", await loads("loaded().loaded === __p.loaded().total", 120_000), await P("loaded()"));
  // each doc, open alone, calls for plugins of exactly its stated packages: the boat none of F's or W's
  // (joints, traversal), which they list themselves (what the page's docs list is shown, not checked: see PACKAGES)
  for (const [w, who] of [["s", "the boat"], ["f", "the fit-out"], ["w", "the hatch"]]) {
    const pk = await P(`packages(${J(w)})`);
    const answering = [...new Set((pk?.answering ?? []).map((p) => folderOf(p.importUrl)))];
    const listed = (pk?.listed ?? []).map(folderOf);
    const stated = PACKAGES[w];
    check(`${who} calls for plugins of exactly its stated packages`, !!pk && answering.includes("scene") && answering.every((p) => stated.includes(p)) && stated.every((p) => answering.includes(p)), { answering, stated, listedInPage: listed });
  }
  check("F alone opens its hatch: F has changed since it was fixed", (await P("openF()")) === true && (await until("slideOf('f')?.at === 'open'", 6000)), await P("slideOf('f')"));
  await b.step(30);
  check("the boat still shows F's hatch shut, as fixed", (await P("pinnedSlide()"))?.at === "closed", await P("pinnedSlide()"));
  await P("frame()");
  await b.step(2);
  report.shots.push(await b.shot(join(SHOTS, "publish-fitout.png")));
  // the probe held her world still; she is published running, as every example is
  await P("resume()");
  const snap = await P("snapshot()");
  check("her world is published running", snap.docs[snap.scene]?.clock?.running !== false, snap.docs[snap.scene]?.clock);
  // S's weather is what the start screen's Ship at anchor writes, the air only (WEATHER.md Decision 43): every
  // other field the weather package's default, a fair afternoon at Cadboro Bay. F and W are dry: no weather.
  const air = snap.docs[snap.scene]?.traits?.weather;
  check("S has the template's weather (wind, from and seed; the rest Cadboro Bay's defaults), and F and W have none", J(Object.keys(air ?? {}).sort()) === J(["from", "seed", "wind"]) && [air.wind, air.from].every(Number.isFinite) && Number.isSafeInteger(air.seed) && [snap.f, snap.w].every((u) => snap.docs[u] && !snap.docs[u].traits?.weather), { s: air, f: snap.docs[snap.f]?.traits, w: snap.docs[snap.w]?.traits });
  // S is Ship at anchor's shape: her Sea keeps the box her layout covers where her world offers no open water (water/WATER.md, "Clipped open water")
  const clipped = clipProblems(snap.docs[snap.scene], { anchored: true });
  check("S's Sea clip covers her swing circle and the landmarks, with the margin (clip-check.mjs)", clipped.length === 0, clipped);
  check("the snapshot has F as fixed (its hatch shut) and F now (open)", snap.fThen?.objects?.[ids.fHatch]?.traits?.[SLIDE]?.at === "closed" && snap.docs[snap.f].objects[ids.fHatch].traits[SLIDE].at === "open", { then: snap.fThen?.objects?.[ids.fHatch]?.traits?.[SLIDE], now: snap.docs[snap.f]?.objects?.[ids.fHatch]?.traits?.[SLIDE] });
  snapshot = { ...snap, fHatch: ids.fHatch, wHatch: ids.wHatch };
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors.slice(0, 12));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
if (list.failed || !snapshot) b.stop(1);
else await publish(snapshot);

// ─── publish ────────────────────────────────────────────────────────────────

/** Make `d` (an automerge draft) equal `want`, key by key: maps recursed into, anything else set where it differs, keys `want` lacks deleted. */
function assignDeep(d, want) {
  const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array);
  for (const k of Object.keys(d)) if (!(k in want)) delete d[k];
  for (const [k, v] of Object.entries(want)) {
    if (isMap(v) && isMap(d[k])) assignDeep(d[k], v);
    else if (J(d[k]) !== J(v)) d[k] = structuredClone(v);
  }
}

async function publish(snap) {
  const docs = { ...snap.docs, [snap.scene]: withPackages(snap.docs[snap.scene], PACKAGES.s), [snap.f]: withPackages(snap.docs[snap.f], PACKAGES.f), [snap.w]: withPackages(snap.docs[snap.w], PACKAGES.w) };
  const fThen = withPackages(snap.fThen, PACKAGES.f);
  const stamped = [...packageProblems(docs[snap.scene], PACKAGES.s), ...packageProblems(docs[snap.f], PACKAGES.f), ...packageProblems(docs[snap.w], PACKAGES.w)];
  if (stamped.length) {
    for (const p of stamped) console.error(`  ${p}`);
    return b.stop(1);
  }
  const files = Object.keys(docs).filter((u) => u !== snap.scene && u !== snap.f && u !== snap.w);
  if (DRY) {
    console.log(`dry run: ${files.length + 3} docs (the boat, F at two versions, W and ${files.length} files; nothing published)`);
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
    let text = J(doc);
    for (const [from, to] of renamed) text = text.split(from).join(to);
    return revive(JSON.parse(text));
  };
  // nobody who made them is here: their claims (who computed what) don't travel
  const unclaimed = (doc) => {
    const d = structuredClone(doc);
    delete d.claims;
    for (const o of Object.values(d.objects ?? {})) delete o.claims;
    return d;
  };
  // files, then W, then F as it was fixed and F's change since, then the boat
  const heads = new Map(); // new url → its heads on the server, where the pin holds it
  for (const u of files) {
    const h = await repo.create2(revive(docs[u]));
    renamed.set(u, h.url);
    heads.set(h.url, h.heads());
  }
  const w = await repo.create2(rewrite(unclaimed(docs[snap.w])));
  renamed.set(snap.w, w.url);
  const f = await repo.create2(rewrite(unclaimed(fThen)));
  const fixedAt = f.heads();
  const fNow = rewrite(unclaimed(docs[snap.f]));
  f.change((d) => assignDeep(d, fNow));
  renamed.set(snap.f, f.url);
  const scene = rewrite(unclaimed(docs[snap.scene]));
  // the pin, at F's heads here: F's own, and the files reached through it at theirs
  const deps = Object.fromEntries(snap.deps.map((u) => renamed.get(u)).filter((u) => heads.has(u)).map((u) => [u, heads.get(u)]));
  scene.objects[snap.fitout].at = { heads: [...fixedAt], ...(Object.keys(deps).length ? { deps } : {}) };
  const s = await repo.create2(scene);
  const made = [s.url, f.url, w.url, ...files.map((u) => renamed.get(u))];

  await repo.flush?.();
  await new Promise((r) => setTimeout(r, Number(args.settle ?? 8000)));
  const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  const missing = [];
  for (const url of made) {
    try {
      const h = await within(30000, checker.find(url));
      const got = h.doc();
      let problem = !got || !Object.keys(got).length ? "empty" : null;
      if (!problem && url === s.url) {
        const links = Object.entries(got.objects ?? {}).filter(([, o]) => o.providerId === "scene.link");
        const pin = got.objects?.[snap.fitout];
        if (packageProblems(got, PACKAGES.s).length) problem = `came back wrong: ${packageProblems(got, PACKAGES.s).join("; ")}`;
        else if (links.length !== 3) problem = `came back with ${links.length} links`;
        else if (pin?.sourceUrl !== f.url || J(pin.at?.heads) !== J(fixedAt)) problem = "came back without F fixed at its heads";
        else if (links.filter(([, o]) => o.sourceUrl === w.url && !o.at).length !== 2) problem = "came back without W linked live twice";
        else if (got.claims) problem = "came back with claims";
      }
      if (!problem && url === f.url) {
        const then = h.view([...fixedAt]).doc();
        if (then?.objects?.[snap.fHatch]?.traits?.[SLIDE]?.at !== "closed") problem = "F at the pinned heads hasn't its hatch shut";
        else if (got.objects?.[snap.fHatch]?.traits?.[SLIDE]?.at !== "open") problem = "F now hasn't its hatch open";
      }
      if (!problem && url === w.url && !(got.objects?.[snap.wHatch]?.traits?.[SLIDE]?.wait > 0)) problem = "W's hatch doesn't close itself";
      if (!problem && files.map((u) => renamed.get(u)).includes(url) && !(got.content?.byteLength > 0)) problem = "a GLB doc with no bytes";
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
  console.log(`\n  scene   https://patchwork.inkandswitch.com/#doc=${s.url}\n  fit-out https://patchwork.inkandswitch.com/#doc=${f.url}\n  hatch   https://patchwork.inkandswitch.com/#doc=${w.url}\n`);
  return b.stop(0);
}
