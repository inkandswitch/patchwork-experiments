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
// starts people through Lost Cities' link (view.start's place: as that game starts them, watching from a seat) with a home
// view across the room. It checks:
// - each table holds a locked link to a game doc of its own (each with its own seats and hands; Santorini.s under
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

// the room's own: the scene, and walk (the entrance mat is a spawn point).
// Each game lists its own (GAME_PACKAGES): a view offers every open doc's
// packages together (scene/STAGE.md, "Packages"). Each list is exactly what
// its doc calls for: the stage takes off a listed package nothing in the doc
// calls for, so a longer list would be rewritten by the first writable visit.
const PACKAGES = ["scene", "walk"];

const ARITY = { sync: 1, settle: 1, "dry-run": 0, show: 0, shots: 1, title: 1, art: 0, game: 1 };
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
// --game <url>: the Lost Cities game doc the room's Lost Cities table links (publish-aboard.mjs prints it), so
// the room and the boat play the same game (scene/COMPOSITION.md, worked example 3). Without it, the room's own.
const GAME = typeof args.game === "string" ? args.game : null;
// each game is a doc of its own, listing what its contents come from, in the
// room's order: Lost Cities and Dominoes have hands and a kept deck
// (tabletop's, card-table's); Santorini has seats and pieces only
const DECKED = ["scene", "seats", "tabletop", "card-table"];
const GAME_PACKAGES = [DECKED, ["scene", "seats"], DECKED];

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "seats", "tabletop", "card-table", "keep", "walk"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist/index.js: build it first`);
const SHOTS = resolve(typeof args.shots === "string" ? args.shots : join(process.env.TMPDIR || tmpdir(), "tabletop-office"));
const urls = Object.fromEntries([...new Set([...PACKAGES, ...GAME_PACKAGES.flat()])].map((p) => [p, pushworkUrl(p)]));
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
    // each game is a doc of its own, linked onto its table: the room holds the links, and no game's pieces or seats
    check(
      "each table holds one locked link to a game doc of its own; the room has no seats or hands of its own",
      s.links.length === 3 && ids.tables.every((t) => s.links.some((l) => l.id === t.link && l.parent === t.table && l.locked && l.game === t.game)) && !Object.keys(s.seats).length && s.zones.length === 0,
      { links: s.links, seats: s.seats, zones: s.zones },
    );
    check(
      "each game brought its own seats (Lost Cities p1 p2, Santorini p1–p3, Dominoes p1 p2), each hand its own game's seat's, each starting people in the seat body",
      J(s.games.map((g) => g.seats)) === J([["p1", "p2"], ["p1", "p2", "p3"], ["p1", "p2"]]) && J(s.games[0].zones) === J(["p1", "p2"]) && J(s.games[2].zones) === J(["p1", "p2"]) && s.games.every((g) => g.start === "seat"),
      s.games,
    );
    check("a chair or a cushion at every seat, a spawn point at the doors", s.chairs === 7 && s.spawn === 1, s);
    check("it starts people through Lost Cities' link (as that game starts them: watching from a seat), at home across the room; no grid or axes", s.start?.place === ids.tables[0].link && s.start?.body === undefined && !!s.start?.home && s.view.grid === false && s.view.axes === false, { start: s.start, view: s.view });
    check(`titled “${TITLE}”, two decks kept by the joint keeper`, s.title === TITLE && s.decks.length === 2 && s.decks.every((d) => d.type === "secure-deck"), { title: s.title, decks: s.decks });
    check("every object shows one of its own doc's files (a link shows its game)", (await P("strays()")).length === 0, await P("strays()"));
    const pickers = await P("pickers('a')");
    check("each game's picker lists its own seats", J(pickers.map((x) => x?.options)) === J([["", "p1", "p2"], ["", "p1", "p2", "p3"], ["", "p1", "p2"]]), pickers);
    const pk = await P("packages('a')");
    const answering = new Set(pk.answering.map((p) => folderOf(p.importUrl)));
    // (the room's own stage calls for the scene's and the spawn point's; seats and the keeper are its games', which
    // each game lists: the view asks for every open doc's together, so the room doesn't list them for its games)
    check("the stage lists the package of every plugin the room calls for, exactly those stated", PACKAGES.every((p) => answering.has(p) && pk.listed.includes(urls[p])) && answering.size === PACKAGES.length && (pk.suggested == null || pk.suggested === urls.scene), { answering: [...answering], listed: pk.listed.map(folderOf), suggested: pk.suggested });
    check("the room lists none of its games' packages for them (seats, the keeper)", !["seats", "card-table"].some((p) => pk.listed.includes(urls[p])), { listed: pk.listed.map(folderOf) });
    snapshot = await P("snapshot()");
    report.shots.push(await b.shot(join(SHOTS, "office-built.png")));
    await P("openB()");
    check("B arrives watching from a seat (view.start)", await until("bodyLabel('b') === 'Watching'", 60_000), await P("body('b')"));
    check("…watching Lost Cities: its picker is the one shown (the picker follows attention)", await until("pickers('b')[0]?.shown && !__p.pickers('b')[1]?.shown && !__p.pickers('b')[2]?.shown", 10_000), await P("pickers('b')"));
    await P("pick('a', 'p1', 0)");
    await P("pick('b', 'p2', 0)");
    const playing = await until("phaseAt(0) === 'playing' && __p.facesAt('a', 0).length >= 8 && __p.facesAt('b', 0).length >= 8", 240_000);
    check("seated at Lost Cities, its deck reaches playing and each hand's faces reach its player", playing, { phase: await P("phaseAt(0)"), a: (await P("facesAt('a', 0)")).length, b: (await P("facesAt('b', 0)")).length });
    check("…while the Dominoes boneyard still waits for its own players", (await P("phaseAt(2)")) === "waiting" && (await P("participantsAt(2)")) === 0, { phase: await P("phaseAt(2)"), participants: await P("participantsAt(2)") });
    await sleep(800);
    report.shots.push(await b.shot(join(SHOTS, "office-seated.png")));
    await P("pick('a', 'p1', 2)");
    await P("pick('b', 'p2', 2)");
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
  await P("pick('a', 'p1', 0)");
  await sleep(2500);
  report.shots.push(await b.shot(join(SHOTS, "art-seat.png")));
  await P("pick('a', 'p2', 0)");
  await sleep(2000);
  report.shots.push(await b.shot(join(SHOTS, "art-seat2.png")));
}

// ─── publish the room as it was before anyone sat ───────────────────────────
async function publish(snapshot0) {
  let snap = snapshot0;
  const docs = { ...snap.docs, [snap.scene]: withPackages(snap.docs[snap.scene], PACKAGES) };
  snap.games.forEach((g, i) => (docs[g] = withPackages(snap.docs[g], GAME_PACKAGES[i])));
  // the room's Lost Cities links the given game (the boat's): its own game doc, deck and files aren't published
  if (GAME) {
    const own = snap.games[0];
    const ownDeck = Object.values(snap.docs[own].objects ?? {}).map((o) => Object.values(o.traits ?? {}).find((v) => v && typeof v.by === "string")?.by).find(Boolean) ?? null;
    const others = new Set([snap.scene, ...snap.games.slice(1)].flatMap((u) => Object.values(snap.docs[u].assets ?? {}).map((a) => a.url)));
    for (const u of [own, ownDeck, ...Object.values(snap.docs[own].assets ?? {}).map((a) => a.url)]) if (u && !others.has(u)) delete docs[u];
    snap = { ...snap, games: snap.games.slice(1), holders: snap.holders.filter((u) => u !== ownDeck), linked: { [own]: GAME } };
  }
  const stamped = packageProblems(docs[snap.scene], PACKAGES);
  if (stamped.length) {
    for (const p of stamped) console.error(`  ${p}`);
    return b.stop(1);
  }
  const count = Object.keys(docs).length;
  if (DRY) {
    console.log(`dry run: ${count} docs (the room, ${snap.games.length} games, ${snap.holders.length} decks and ${count - 1 - snap.games.length - snap.holders.length} files${GAME ? `; Lost Cities linked to ${GAME}` : ""}; nothing published)`);
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
  // files first, then the decks (their faces name files), then the games, then the room linking them
  for (const [from, to] of Object.entries(snap.linked ?? {})) renamed.set(from, to);
  const files = Object.keys(docs).filter((u) => u !== snap.scene && !snap.holders.includes(u) && !snap.games.includes(u));
  for (const u of files) renamed.set(u, (await repo.create2(revive(docs[u]))).url);
  for (const u of snap.holders) renamed.set(u, (await repo.create2(rewrite(docs[u]))).url);
  for (const u of snap.games) renamed.set(u, (await repo.create2(rewrite(unclaimed(docs[u])))).url);
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
        const links = Object.values(got.objects ?? {}).filter((o) => o.providerId === "scene.link");
        if (packageProblems(got, PACKAGES).length) problem = `came back wrong: ${packageProblems(got, PACKAGES).join("; ")}`;
        else if (got.objects?.[got.view?.start?.place]?.providerId !== "scene.link") problem = `came back with view.start ${J(got.view?.start)}`;
        else if (links.length !== 3) problem = `came back with ${links.length} links`;
        else if (GAME && !links.some((l) => l.sourceUrl === GAME)) problem = `came back without its link to ${GAME}`;
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
  console.log(`\n  scene  https://patchwork.inkandswitch.com/#doc=${scene.url}${GAME ? `\n  Lost Cities: the game ${GAME} (the boat's)` : ""}\n`);
  return b.stop(0);
}
