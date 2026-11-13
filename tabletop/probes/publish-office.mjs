// Publish "Quiet games room" to a real sync server, and print its Patchwork
// URL: a still, calm room (tatami, shoji, a window onto an autumn garden)
// with three game tables set, Lost Cities, Santorini and Draw Dominoes for
// two, and three empty tatami squares for more.
//
//   (in scene/, seats/, tabletop/, card-table/, keep/ and walk/) pnpm build
//   node probes/publish-office.mjs [--sync wss://…] [--settle 8000] [--dry-run] [--show] [--shots <dir>] [--title "…"] [--art]
//
// Makes NEW docs on every run (no dedupe).
//
// In headless Chrome, the BUILT scene tool with the BUILT seats, tabletop,
// keeper and walk plugins is mounted on an EMPTY scene (office-probe.html:
// an in-memory repo, two views A and B). A puts the room in (its pieces are
// GLB files the scene keeps, drawn by probes/office/room.js, written as
// locked objects, as an importer writes them), then sets each table as a
// person does: the parts bin's Card table on a tatami square, a game on it
// (api.part), Lost Cities first, a chair at each of its seats (Santorini,
// wider than the Card table, on a low table of the room's own, with a
// cushion at each seat); the doc
// starts people watching from a seat (view.start's seat body) with a home
// view across the room. It checks:
// - each table brought its own seats (Lost Cities p1 p2; Santorini's under
//   other ids where those were taken; Dominoes' too), each seat's view in
//   its own table's frame, each hand named by its own table's seat;
// - the picker groups the seats by table, named for each;
// - every object shows one of the scene's own files; everything loads;
// - the stage lists the package of every plugin the scene calls for (the
//   entrance mat is a spawn point: walk);
// - B arrives watching from a seat;
// - with A and B seated at Lost Cities, its deck reaches "playing" and each
//   hand's faces reach its player, while the Dominoes boneyard still waits
//   for its own players (each table's keeper waits on its own seats); then
//   with both moved to Dominoes, its boneyard starts too.
// Then (unless --dry-run) it publishes the room as it was before anyone sat:
// its files, its containers and the scene, each made anew on the server with
// the urls between them rewritten, and checks every doc from a fresh repo.
//
// --art: only the pictures (the room from the doors, from the alcove, from
// a seat), in one big view, then stop: for judging how it looks.

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { packageProblems, pushworkUrl, withPackages } from "./scene-packages.mjs";

// the scene, the seats, the tables and their pieces, the keeper (the decks'
// players shuffle them), and walk (the entrance mat is a spawn point)
const PACKAGES = ["scene", "seats", "tabletop", "card-table", "walk"];

const ARITY = { sync: 1, settle: 1, "dry-run": 0, show: 0, shots: 1, title: 1, art: 0 };
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
    bad.push(`${a} (wants a value)`);
    continue;
  }
  args[k] = ARITY[k] === 0 ? true : vals[0];
  i += ARITY[k];
}
if (bad.length) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  const usage = lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).join("\n");
  const help = bad.length === 1 && bad[0] === "--help";
  if (!help) console.error(`unknown or bad argument${bad.length === 1 ? "" : "s"}: ${bad.join(" ")}\n`);
  console.error(usage);
  process.exit(help ? 0 : 2);
}
const DRY = !!args["dry-run"];
const ART = !!args.art;
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const TITLE = typeof args.title === "string" ? args.title : "Quiet games room";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "seats", "tabletop", "card-table", "keep", "walk"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist/index.js: build it first`);
const SHOTS = resolve(typeof args.shots === "string" ? args.shots : join(process.env.TMPDIR || tmpdir(), "tabletop-office"));
const urls = Object.fromEntries(PACKAGES.map((p) => [p, pushworkUrl(p)]));
const folderOf = (u) => Object.entries(urls).find(([, v]) => v === u)?.[0] ?? u;

const { browser, checklist, sleep } = await import("./cdp.mjs");
const [W, H] = ART ? [1400, 860] : [700, 520];
const page = `/tabletop/probes/office-probe.html?w=${W}&h=${H}${ART ? "&solo" : ""}&urls=${encodeURIComponent(JSON.stringify(urls))}`;
const b = await browser({ root: ROOT, port: 4797, cdp: 9797, page, width: ART ? W + 16 : 2 * W + 16, height: H + 10, show: !!args.show, timeout: 900_000 });
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
  await until("A && __p.A.host.record('scene.add')?.api", 20_000);
  const ids = await P(`build({ title: ${J(TITLE)} })`, 180_000);
  check("the room in, and the tables set through the parts bin", !ids.error && ids.tables?.length === 3, ids);
  check("everything loads", await until("loaded('a').loaded === __p.loaded('a').total", 180_000), await P("loaded('a')"));
  if (ART) {
    await art();
  } else {
    const s = await P("shape()");
    const [lc, sa, dom] = ids.tables;
    const want = { p1: lc.table, p2: lc.table, "p1-2": sa.table, "p2-2": sa.table, p3: sa.table, "p1-3": dom.table, "p2-3": dom.table };
    check(
      "each table brought its own seats, each seat's view in its own table",
      J(Object.fromEntries(Object.entries(s.seats).map(([k, v]) => [k, v.in]))) === J(want) && J(lc.seats) === J(["p1", "p2"]) && J(sa.seats) === J(["p1-2", "p2-2", "p3"]) && J(dom.seats) === J(["p1-3", "p2-3"]),
      { seats: s.seats, tables: ids.tables },
    );
    check("each hand is its own table's seat's", J(s.zones) === J(["p1", "p1-3", "p2", "p2-3"]), s.zones);
    check("a chair or a cushion at every seat, a spawn point at the doors", s.chairs === 7 && s.spawn === 1, s);
    check("it starts people watching from a seat (the seat body), at home across the room; no grid or axes", s.start?.body === "seat" && !!s.start?.home && s.view.grid === false && s.view.axes === false, { start: s.start, view: s.view });
    check(`titled “${TITLE}”, two decks kept by the joint keeper`, s.title === TITLE && s.decks.length === 2 && s.decks.every((d) => d.type === "secure-deck"), { title: s.title, decks: s.decks });
    check("every object shows one of the scene's own files", (await P("strays()")).length === 0, await P("strays()"));
    const groups = await P("pickerShape('a')");
    check(
      "the picker groups the seats by table, named for each",
      J(groups) === J([{ option: "" }, { group: "Lost Cities table", options: ["p1", "p2"] }, { group: "Santorini table", options: ["p1-2", "p2-2", "p3"] }, { group: "Dominoes table", options: ["p1-3", "p2-3"] }]),
      groups,
    );
    const pk = await P("packages('a')");
    const answering = new Set(pk.answering.map((p) => folderOf(p.importUrl)));
    check("the stage lists the package of every plugin the room calls for, each one stated", PACKAGES.every((p) => answering.has(p) && pk.listed.includes(urls[p])) && (pk.suggested == null || pk.suggested === urls.scene), { answering: [...answering], listed: pk.listed.map(folderOf), suggested: pk.suggested });
    snapshot = await P("snapshot()");
    report.shots.push(await b.shot(join(SHOTS, "office-built.png")));
    await P("openB()");
    check("B arrives watching from a seat (view.start)", await until("bodyLabel('b') === 'Watching'", 60_000), await P("body('b')"));
    await P("pick('a', 'p1')");
    await P("pick('b', 'p2')");
    const playing = await until("phaseAt(0) === 'playing' && __p.facesAt('a', 0).length >= 8 && __p.facesAt('b', 0).length >= 8", 240_000);
    check("seated at Lost Cities, its deck reaches playing and each hand's faces reach its player", playing, { phase: await P("phaseAt(0)"), a: (await P("facesAt('a', 0)")).length, b: (await P("facesAt('b', 0)")).length });
    check("…while the Dominoes boneyard still waits for its own players", (await P("phaseAt(2)")) === "waiting" && (await P("participantsAt(2)")) === 0, { phase: await P("phaseAt(2)"), participants: await P("participantsAt(2)") });
    await sleep(800);
    report.shots.push(await b.shot(join(SHOTS, "office-seated.png")));
    await P("pick('a', 'p1-3')");
    await P("pick('b', 'p2-3')");
    check("both moved to Dominoes: its boneyard starts", await until("phaseAt(2) === 'playing'", 240_000), { phase: await P("phaseAt(2)"), participants: await P("participantsAt(2)") });
    await sleep(800);
    report.shots.push(await b.shot(join(SHOTS, "office-dominoes.png")));
    check("nothing failed to load", (await P("loading('a')")).errors === 0 && (await P("loading('b')")).errors === 0, [await P("loading('a')"), await P("loading('b')")]);
  }
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors on the page", errors.length === 0, errors.slice(0, 12));
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
if (list.failed || ART || !snapshot) b.stop(list.failed ? 1 : 0);
else await publish(snapshot);

/** Pictures of the room, for judging it. */
async function art() {
  const views = [
    ["home", [-1.35, 1.45, 4.2], [0.45, 0.85, -3.0]],
    ["alcove", [-3.4, 1.45, 2.4], [-7.0, 0.95, -0.2]],
    ["window", [-2.6, 1.55, -0.4], [1.4, 0.6, -6.5]],
    ["shoji", [-1.2, 1.5, 2.6], [6.4, 1.0, -0.5]],
    ["back", [2.5, 1.7, -3.6], [-1.5, 0.7, 2.8]],
    ["santorini", [-2.2, 1.6, 0.4], [-4.2, 0.3, -1.6]],
  ];
  for (const [name, position, target] of views) {
    await P(`look('a', ${J(position)}, ${J(target)})`);
    await sleep(900);
    report.shots.push(await b.shot(join(SHOTS, `art-${name}.png`)));
  }
  await P("pick('a', 'p1')");
  await sleep(2500);
  report.shots.push(await b.shot(join(SHOTS, "art-seat.png")));
  await P("pick('a', 'p2')");
  await sleep(2000);
  report.shots.push(await b.shot(join(SHOTS, "art-seat2.png")));
}

// ─── publish the room as it was before anyone sat ───────────────────────────
async function publish(snap) {
  const docs = { ...snap.docs, [snap.scene]: withPackages(snap.docs[snap.scene], PACKAGES) };
  const stamped = packageProblems(docs[snap.scene], PACKAGES);
  if (stamped.length) {
    for (const p of stamped) console.error(`  ${p}`);
    return b.stop(1);
  }
  const count = Object.keys(docs).length;
  if (DRY) {
    console.log(`dry run: ${count} docs (the scene, ${snap.holders.length} decks and ${count - 1 - snap.holders.length} files; nothing published)`);
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
  const unclaimed = (doc) => {
    const d = structuredClone(doc);
    delete d.claims;
    for (const o of Object.values(d.objects ?? {})) delete o.claims;
    return d;
  };
  // files first, then the decks (their faces name files), then the scene
  const files = Object.keys(docs).filter((u) => u !== snap.scene && !snap.holders.includes(u));
  for (const u of files) renamed.set(u, (await repo.create2(revive(docs[u]))).url);
  for (const u of snap.holders) renamed.set(u, (await repo.create2(rewrite(docs[u]))).url);
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
        const seats = Object.keys(got.traits?.seats ?? {});
        if (packageProblems(got, PACKAGES).length) problem = `came back wrong: ${packageProblems(got, PACKAGES).join("; ")}`;
        else if (got.view?.start?.body !== "seat") problem = `came back with view.start ${J(got.view?.start)}`;
        else if (seats.length !== 7) problem = `came back with seats ${J(seats)}`;
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
