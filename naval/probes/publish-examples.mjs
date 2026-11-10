// Publish the rig's example docs to a real sync server, and print their
// Patchwork URLs:
//
//   (in naval/) pnpm build; (in camber/patchwork) npm run build; camber's own npm install (for its tsx)
//   node probes/publish-examples.mjs [--sync wss://…] [--settle 8000] [--dry-run] [--show] [--camber ~/dev/camber]
//   (PROBE_PORT / PROBE_CDP in the environment move its local ports, 4791 / 9791, when another probe has them)
//
// Makes NEW docs on every run (no dedupe):
// 1. "Catalina 30": a Rig doc, "New from… Catalina 30 (masthead)", titled.
// 2. "Laser (ILCA 7)": the same from "Laser / ILCA 7 (cat)".
//    Each is the datatype's init, then the fixture's doc part as the tool
//    writes it (normalize(fixtureDoc(...)): its prov and sources kept, the
//    validation-only `published` block left out, as the tool leaves it).
// 3. "Camber hull with a rig": a camber-hull doc from camber's example
//    narrow-transom.json, at REAL SIZE (10 m LOA, in metres, scaled by
//    camber's own setUnit/setLoa) with its design waterline set 2.2 m below
//    the deck datum by camber's own setWaterline, in camber's stored form
//    (probes/camber-hull-doc.mts, camber's own datatype and docFormat); and a
//    Rig doc linked to that hull doc itself (never a scene render: real size
//    only) through the tool's Link field, then "New from… First guess from
//    this hull". If the first guess lands out of the lead or the helm band,
//    the Helm helper (its default target, 3° weather) moves the rig, and the
//    script says what it did. No render doc is published: a scene makes its
//    own when the hull is put in one.
//
//    Why this hull, at this waterline. Every example in camber/examples (and
//    its editor's default hull) was screened at real size through the tool's
//    own analysis, statics from camber's own table. Five are drawn with the
//    waterline at the deck and state no floating hull; the rest float heavy
//    as drawn (D/L 355–650), and every one but this has Cp 0.66–0.76 at any
//    waterline, outside what the resistance method was fitted to (DSYHS: Cp
//    0.52–0.60). narrow-transom is the one with a yacht's prismatic (Cp
//    0.56–0.58). At the waterline it is drawn with (1.5 m of 10) it floats
//    at 12.1 t, D/L 599, five DSYHS parameters of eight out; with the
//    waterline at 2.2 m it is a light, long-ended sloop (LWL 6.39 m of
//    9.92 m): 2.28 t, D/L 244, Cp 0.558, LCB −4.7% of LWL, one DSYHS
//    parameter just outside (Cm 0.575 for 0.646: "near"), and the rig ends
//    at helm 3° with a lead of 8.4%, inside its 5–9% band. Only the waterline
//    was moved: the geometry is camber's example, untouched. (Still no
//    production yacht: the lowest freeboard is 1.5 m, and she is tender, at
//    the 25° heel limit at the reference point. A waterline 0.05 m either
//    way loses the lead band or the "near" grade.)
//    The example this replaced, cuvature-kink-with-unmodified-pchip at 12 m,
//    floats at 23.7 t (D/L 647, Cp 0.74, LCB −8.8%), far outside every
//    method's range, and its rig ended with a lead of 20%. It is left out of
//    what is published: as a second hull example it would only show the
//    warnings. probes/study-run.mjs still screens it, as its agreement case.
//
// Everything is made in headless Chrome with the BUILT rig and camber plugins
// on an in-memory repo (probes/publish-examples.html; camber's dist served at
// /camber/, a dev-time borrow: no package imports another), then published
// from here: each doc made anew on the server, the urls between them
// rewritten. Every doc is then read back from a fresh repo and compared with
// what was sent.
//
// --dry-run makes and checks everything in the browser, but publishes nothing.

import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), [])
);
// It publishes by default, so a flag it doesn't know (--help, a typo of
// --dry-run) stops it here, before any repo exists, with the usage above.
const KNOWN = new Set(["sync", "settle", "dry-run", "show", "camber"]);
const unknown = Object.keys(args).filter((k) => !KNOWN.has(k));
const stray = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--") && args[all[i - 1].slice(2)] === a));
const badValue = ["sync", "settle", "camber"].filter((k) => k in args && typeof args[k] !== "string");
if (unknown.length || stray.length || badValue.length || ("settle" in args && !(Number(args.settle) >= 0))) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  const usage = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n");
  if (!unknown.includes("help")) {
    const bad = [...unknown.map((k) => `--${k}`), ...stray, ...badValue.map((k) => `--${k} (needs a value)`), ...("settle" in args && typeof args.settle === "string" && !(Number(args.settle) >= 0) ? [`--settle ${args.settle}`] : [])];
    console.error(`bad argument${bad.length === 1 ? "" : "s"}: ${bad.join(" ")}\n`);
  }
  console.error(usage);
  process.exit(unknown.includes("help") && unknown.length === 1 && !stray.length ? 0 : 2);
}
const DRY = !!args["dry-run"];
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const SETTLE = Number(args.settle ?? 8000);

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CAMBER = resolve(typeof args.camber === "string" ? args.camber.replace(/^~(?=\/)/, homedir()) : join(homedir(), "dev/camber"));
const EXAMPLE = "narrow-transom.json";
const LENGTH_M = 10;
/** The design waterline, m below camber's deck datum (the example is drawn with 1.5 m at this length: see the header). */
const WATERLINE_M = 2.2;
const TSX = join(CAMBER, "node_modules/.bin/tsx");
for (const p of [join(PKG, "dist/index.js"), join(CAMBER, "patchwork/dist/index.js"), join(CAMBER, "examples", EXAMPLE), TSX]) if (!existsSync(p)) throw new Error(`no ${p}: build (or install) it first`);

const FIXTURES = [
  { id: "catalina-30", title: "Catalina 30" },
  { id: "laser-ilca7", title: "Laser (ILCA 7)" },
];
const HULL_TITLE = "Narrow-transom hull, 10 m (camber example)";
const RIG_TITLE = "Camber hull with a rig";

// ─── the camber hull doc, from camber's own source ─────────────────────────
const hullDoc = JSON.parse(execFileSync(TSX, [join(PKG, "probes/camber-hull-doc.mts"), CAMBER, EXAMPLE, HULL_TITLE, String(LENGTH_M), String(WATERLINE_M)], { encoding: "utf8", maxBuffer: 64 << 20 }));

// ─── make it all in the browser, with the tools ────────────────────────────
const { browser, checklist, sleep } = await import("./cdp.mjs");
const b = await browser({
  root: PKG, port: Number(process.env.PROBE_PORT) || 4791, cdp: Number(process.env.PROBE_CDP) || 9791, page: "/probes/publish-examples.html", width: 1400, height: 1000,
  show: !!args.show, timeout: 900_000,
  mounts: { "/camber/": join(CAMBER, "patchwork/dist") },
});
const js = (expr, ms = 120_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const J = JSON.stringify;
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, examples: {} };
const n3 = (v) => (v == null ? null : +(+v).toFixed(3));
let snap = null;
let roles = null;
try {
  check("the page set up: rig and camber plugins registered, no errors", (await b.waitFor("window.__ready === true", 60_000)) && (await P("errors")).length === 0, await P("errors"));
  const fixtures = {};
  for (const f of FIXTURES) {
    const r = await P(`fixture(${J(f.id)}, ${J(f.title)})`);
    fixtures[f.id] = r;
    report.examples[f.title] = { status: r.status.text, ...r.readouts };
    check(`${f.title}: made from "New from…", its readouts render`, r.status.tone !== "error" && Number.isFinite(r.readouts.saD) && Number.isFinite(r.readouts.helmDeg), r);
  }
  const hull = await P(`camber(${J(hullDoc)})`, 180_000);
  // camber's LOA runs from its plan's first control point (the transom) to its last (the bow); the drawn hull is
  // trimmed at its transom, so the mesh is a little shorter than the LOA
  const span = hull.bounds ? hull.bounds.max[0] - hull.bounds.min[0] : NaN;
  report.hull = { unit: hullDoc.unit, waterlineM: hullDoc.waterline, bounds: hull.bounds, meshLengthM: n3(span), glbBytes: hull.bytes };
  check(`the hull doc is at real size: camber's scene:source with its DEFAULT params (document size) builds it ${LENGTH_M} m long (the bow at x ≈ ${LENGTH_M} m, the mesh over 90% of it)`, hullDoc.unit === "m" && hull.params.size === "document" && Math.abs(hull.bounds?.max[0] - LENGTH_M) < 0.1 && span > 0.9 * LENGTH_M, report.hull);
  const rig = await P(`rigOn(${J(hull.hullUrl)}, ${J(RIG_TITLE)})`, 300_000);
  report.examples[RIG_TITLE] = rig;
  check("the rig reads the linked hull itself, built at its own size", /^Hull: built by /.test(rig.chip ?? "") && /own size/.test(rig.chip ?? ""), { chip: rig.chip, status: rig.linkStatus });
  check("the first guess applied", !!rig.firstGuess.status && Number.isFinite(rig.firstGuess.helmDeg), rig.firstGuess);
  check("the hull's statics are camber's own (its chartroom:source), not the mesh's", /statics from/.test(rig.chip ?? ""), { chip: rig.chip });
  check("it opens within the helm band (0–5° weather)", !rig.final.helmOut, rig.final);
  check("it opens within the lead band", !rig.final.leadOut && Number.isFinite(rig.final.lead), rig.final);
  check("the hull is a plausible sloop's: D/L 150–300", rig.final.dL >= 150 && rig.final.dL <= 300, { dL: rig.final.dL, displacementKg: rig.final.displacementKg });
  snap = await P("snapshot()", 120_000);
  roles = { fixtures: Object.fromEntries(FIXTURES.map((f) => [f.id, fixtures[f.id].url])), hull: hull.hullUrl, rig: rig.url };
  // every doc made is complete on its own: the rig docs are exactly what normalize() gives back
  const { normalize } = await import("../src/doc.js");
  for (const url of [...Object.values(roles.fixtures), roles.rig]) {
    const { "@patchwork": meta, ...doc } = snap[url];
    check(`${doc.title}: a complete rig-design doc (normalize() changes nothing)`, meta?.type === "rig-design" && J(normalize(doc)) === J(doc), meta);
  }
  check("the rig names the hull doc itself, and nothing else was made (no render, no GLB file)", snap[roles.rig].hull.link?.url === roles.hull && snap[roles.hull]["@patchwork"]?.type === "camber-hull" && Object.keys(snap).length === 4, { link: snap[roles.rig].hull.link, docs: Object.keys(snap).length });
  check("no errors on the page", (await P("errors")).length === 0, await P("errors"));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
const ex = report.examples[RIG_TITLE];
if (ex?.final) {
  const f = ex.firstGuess, z = ex.final;
  console.log(`\n${RIG_TITLE}: ${EXAMPLE} at ${LENGTH_M} m, waterline ${WATERLINE_M} m below the deck datum: ${Math.round(z.displacementKg)} kg, D/L ${n3(z.dL)}, SA/D ${n3(z.saD)}; at 12 kn true, 45°:`);
  console.log(`  first guess: helm ${n3(f.helmDeg)}° (${f.helm}); lead ${n3(100 * f.lead)}% (${f.leadBand}); ${n3(f.refSpeedKn)} kn`);
  if (ex.helper) console.log(`  out of band (${ex.helper.why}): the Helm helper at ${ex.helper.target}°: ${ex.helper.status}`);
  else console.log("  in band: no helper run");
  console.log(`  published:   helm ${n3(z.helmDeg)}° (${z.helm}); lead ${n3(100 * z.lead)}% (${z.leadBand}); ${n3(z.refSpeedKn)} kn`);
}
if (list.failed || !snap) b.stop(1);
else await publish(snap, roles);

// ─── publish: every doc made anew, the urls between them rewritten ─────────
async function publish(docs, roles) {
  const typeOf = (u) => docs[u]["@patchwork"]?.type;
  if (DRY) {
    console.log(`\ndry run: ${Object.keys(docs).length} docs made and checked (${Object.keys(docs).map(typeOf).join(", ")}); nothing published`);
    return b.stop(0);
  }
  const { Repo, initSubduction } = await import("@automerge/automerge-repo");
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  console.log(`\nconnected to ${SYNC}`);
  const fromBytes = (v) => (v && typeof v === "object" && typeof v.$bytes === "string" ? new Uint8Array(Buffer.from(v.$bytes, "base64")) : v);
  const revive = (doc) => JSON.parse(JSON.stringify(doc), (k, v) => fromBytes(v));
  const renamed = new Map();
  const rewrite = (doc) => {
    let text = JSON.stringify(doc);
    for (const [from, to] of renamed) text = text.split(from).join(to);
    return revive(JSON.parse(text));
  };
  const sent = new Map();
  const make = async (from, doc) => {
    const h = await repo.create2(doc);
    renamed.set(from, h.url);
    sent.set(h.url, doc);
    return h;
  };
  // a doc is only ever named after it exists: the hull, then the rig that links it
  for (const u of Object.values(roles.fixtures)) await make(u, revive(docs[u]));
  await make(roles.hull, revive(docs[roles.hull]));
  await make(roles.rig, rewrite(docs[roles.rig]));

  await repo.flush?.();
  await new Promise((r) => setTimeout(r, SETTLE));
  const checker = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const within = (ms, p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${ms} ms`)), ms))]);
  // the same JSON whatever order a map's keys come back in, bytes as base64
  const plain = (v) => {
    if (ArrayBuffer.isView(v)) return { $bytes: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64") };
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, plain(v[k])]));
    return v;
  };
  const missing = [];
  const rows = [];
  for (const [url, doc] of sent) {
    try {
      const got = (await within(30_000, checker.find(url))).doc();
      const problem = !got || !Object.keys(got).length ? "empty" : J(plain(got)) !== J(plain(doc)) ? "came back different from what was sent" : null;
      if (problem) missing.push(`${url} (${problem})`);
      const type = got?.["@patchwork"]?.type ?? null;
      rows.push({ url, type, title: got?.title ?? got?.name ?? null });
    } catch (err) {
      missing.push(`${url} (${err?.message ?? err})`);
    }
  }
  console.log(`verified ${sent.size - missing.length}/${sent.size} docs from a fresh repo`);
  if (missing.length) {
    for (const m of missing) console.error(`  missing ${m}`);
    console.error(`\nNOT verified: re-run, or raise --settle.`);
    return b.stop(1);
  }
  console.log("");
  for (const r of rows) console.log(`  ${r.type.padEnd(13)} ${r.title}\n                https://patchwork.inkandswitch.com/#doc=${r.url}`);
  console.log("");
  return b.stop(0);
}
