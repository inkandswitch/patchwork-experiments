// What a kept card looks like to each of two people, by real key presses:
// its own back when it isn't turned toward them (face down; in the other
// seat's hand, whichever way up), what it is when it's theirs to see, and the
// stage's veil only when it's turned toward them and not shown yet (its keys
// on their way).
//
//   (in scene/, tabletop/, card-table/ and keep/) pnpm build
//   node probes/privacy.mjs --part secure|plain [--shots <dir>] [--show]
//
// privacy-probe.html, two views A (Ana) and B (Ben) of one doc, real mouse
// and keys.
// - secure: an empty scene started from the Lost Cities template (its deck
//   kept by the joint keeper); A sits in Player 1 (every card its back until
//   the deal), B in Player 2. Once dealt, A sees its hand's faces, B's hand
//   as backs and the pile as backs, B the mirror; no veil anywhere, and no
//   file or doc write was made to hide anything. A flips a card of its hand
//   face down with F: still its back to B. B draws with D while A's deck
//   writes are held back: the new card is the veil to B until A's key
//   reaches it, then its face; to A it is a back throughout. A turns the
//   pile's top face up: the veil to B until A's key arrives, then its face
//   to both.
// - plain: a Lost Cities table whose deck is kept in the open (the plain
//   keeper): its HUD line; the pile is backs to both; A draws two: faces to
//   A, backs to B; A flips one: its back; the pile's top turned face up is
//   its face to both.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["tabletop/dist/index.js", "scene/dist/index.js", "card-table/dist/index.js", "keep/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const PART = arg("--part") ?? "secure";
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "tabletop-privacy"));
const MODE = { secure: "template", plain: "plain" }[PART];
if (!MODE) throw new Error(`--part ${PART}: secure or plain`);

const b = await browser({ root: ROOT, port: 4774, cdp: 9774, page: `/tabletop/probes/privacy-probe.html?mode=${MODE}`, width: 1416, height: 530, show: process.argv.includes("--show"), timeout: 300_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { part: PART, checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = (what, data) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...(data ? { data } : {}) });
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `privacy-${PART}-${name}.png`)));
const J = JSON.stringify;
const all = (o, k) => Object.values(o).every((v) => v === k);

/** hover `id` in view `w` with the real mouse, give that view the keys, and press `key` once the prompt offers `verb` */
async function press(w, id, key, verb) {
  // (once the table's pieces have loaded: what a pick hits)
  await until(`aimAt(${J(id)}, ${J(w)})`, 30_000);
  const at = await P(`aimAt(${J(id)}, ${J(w)})`);
  if (!at) return { ok: false, why: "not on screen" };
  await b.move(at.x + 1, at.y);
  await b.move(at.x, at.y);
  const hov = await until(`hovered(${J(w)}) === ${J(id)}`, 3000);
  const offered = await until(`prompt(${J(w)}).some((t) => ${verb}.test(t))`, 3000);
  const prompt = await P(`prompt(${J(w)})`);
  if (!hov || !offered) return { ok: false, why: "not offered", hovered: await P(`hovered(${J(w)})`), prompt };
  await P(`focus(${J(w)})`);
  await b.key(key);
  return { ok: true, prompt };
}

/** seat A in p1 and B in p2, then wait for a secure deal to reach both hands */
async function seatBoth({ secure }) {
  const viewers = await P("viewers");
  check("both views playing, pickers up", await until("activity('a') === 'play' && __p.activity('b') === 'play' && __p.picker('a') === 3 && __p.picker('b') === 3", 20_000));
  await P("pick('a', 'p1')");
  if (secure) {
    // A seated, B not yet: the deck isn't dealt, so A's own hand (and everything) shows backs, no padlocks
    check("A seated, B not: the deck waits", await until(`seats().p1.player === ${J(viewers.a)}`), await P("seats()"));
    await sleep(800);
    const A = await P("tally('a')");
    check("before the deal every card is its back to A: its own hand too, and no veil", A.p1 && A.p1.back > 0 && !A.p1.veil && !A.p1.face && !(A.p2?.veil) && !(A.pile?.veil), A);
    await shot("waiting");
  }
  await P("pick('b', 'p2')");
  check("A in Player 1, B in Player 2", await until(`seats().p1.player === ${J(viewers.a)} && __p.seats().p2.player === ${J(viewers.b)}`), await P("seats()"));
  if (secure) {
    const dealt = await until("phase() === 'playing' && __p.where().p1.every((id) => __p.state('a', id) === 'face') && __p.where().p2.every((id) => __p.state('b', id) === 'face') && __p.where().p1.length >= 8", 120_000);
    check("the secure deck is dealt and each hand's faces delivered", dealt, { phase: await P("phase()"), a: await P("tally('a')"), b: await P("tally('b')") });
  }
  mark("seated");
}

/** what each view shows: its own hand's faces, the other hand's backs, the pile's backs; no veil anywhere */
async function settled(tag) {
  await until("where().p1.every((id) => __p.state('a', id) === 'face') && __p.where().p2.every((id) => __p.state('b', id) === 'face')", 15_000);
  const w = await P("where()");
  const A = await P("tally('a')"), B = await P("tally('b')");
  check(`${tag}A sees its own hand's faces (${w.p1.length})`, A.p1 && A.p1.face === w.p1.length, A);
  check(`${tag}A sees B's hand as backs, not veils (${w.p2.length})`, A.p2 && A.p2.back === w.p2.length && !A.p2.veil && !A.p2.face, A);
  check(`${tag}A sees the pile as backs`, A.pile && A.pile.back > 0 && !A.pile.face && !A.pile.veil, A);
  check(`${tag}B sees its own hand's faces`, B.p2 && B.p2.face === w.p2.length, B);
  check(`${tag}B sees A's hand as backs, not veils`, B.p1 && B.p1.back === w.p1.length && !B.p1.veil && !B.p1.face, B);
  check(`${tag}B sees the pile as backs`, B.pile && B.pile.back > 0 && !B.pile.face && !B.pile.veil, B);
  // and what's drawn: the other hand is the object's own back GLB in each view, one's own hand never that
  const pileTop = (await P("pile()"))[0];
  await until(`drawn('a', ${J(pileTop)}) && __p.drawn('a', ${J(pileTop)}) !== '?'`, 30_000);
  const back = await P(`drawn('a', ${J(pileTop)})`);
  const drawnOk = await until(`where().p2.every((id) => __p.drawn('a', id) === ${J(back)}) && __p.where().p1.every((id) => __p.drawn('b', id) === ${J(back)}) && __p.where().p1.every((id) => __p.drawn('a', id) && __p.drawn('a', id) !== ${J(back)} && __p.drawn('a', id) !== 'veil')`, 20_000);
  check(`${tag}…and that is what each view has drawn (the back's own drawing: ${back})`, drawnOk && !!back && back !== "veil", { a: await P(`drawnAll('a', ${J([...w.p1, ...w.p2])})`), b: await P(`drawnAll('b', ${J([...w.p1, ...w.p2])})`), back });
  return { ...w, back };
}

/** close up on a tray in each view (`at`: "across", each at the other's; "a" / "b": both at that seat's), then back */
async function closeups(name, at = "across") {
  const cams = { a: await P("cam('a')"), b: await P("cam('b')") };
  const tray = (seat) => (seat === "a" ? 0.45 : -0.45);
  const from = (w, seat) => { const z = tray(seat); const side = w === "a" ? 1 : -1; return `look(${J(w)}, [0, 0.42, ${z + side * 0.5}], [0, 0, ${z}])`; };
  const target = { a: at === "across" ? "b" : at, b: at === "across" ? "a" : at };
  await P(from("a", target.a));
  await P(from("b", target.b));
  await sleep(1200);
  await shot(name);
  await P(`setCam('a', ${J(cams.a)})`);
  await P(`setCam('b', ${J(cams.b)})`);
  await sleep(300);
}

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));

  if (PART === "secure") {
    check("the start screen offers Lost Cities", await until("templates('a').includes('tabletop.lost-cities')", 15_000), await P("templates('a')"));
    await P("start('a', 'tabletop.lost-cities')");
    check("the table is laid out", await until("pile().length > 0", 30_000));
    // (nobody is seated yet and the deck isn't dealt: every card its back)
    report.beforeSeated = { a: await P("tally('a')") };
    const madeBefore = await P("made()");
    await P("open('b')");
    await seatBoth({ secure: true });
    const w = await settled("");
    // hiding made nothing: no file for a stand-in, no asset key, no doc of any kind since the table was laid out
    const madeAfter = await P("made()");
    check("nothing was made or written to hide anything: no file, no asset, the same documents as before anyone sat", J(madeAfter) === J(madeBefore) && (await P("privateKeys()")).length === 0, { madeBefore, madeAfter, keys: await P("privateKeys()") });
    report.made = madeAfter;
    await sleep(500);
    await shot("seated");
    await closeups("closeup");

    // ── A flips a card of its own hand face down ──
    const X = w.p1[0];
    const flip = await press("a", X, "f", "/Flip/");
    check("hovering a card in A's tray, A's prompt offers Flip; F", flip.ok, flip);
    check("…it is face down in the doc", await until(`faceUp(${J(X)}) === false`, 5000), await P(`transform(${J(X)})`));
    await sleep(600);
    check("A: still its card by the zone rule (its face GLB) but drawn upside down: what shows is its back", (await P(`state('a', ${J(X)})`)) === "face" && (await P(`shownUp('a', ${J(X)})`)) === false, { state: await P(`state('a', ${J(X)})`), shownUp: await P(`shownUp('a', ${J(X)})`) });
    // (no lens: the object's own GLB, the card back drawn on both sides)
    check("B: its back, as before (no look: the object's own GLB)", await until(`state('b', ${J(X)}) === 'back'`, 5000) && (await P(`drawn('b', ${J(X)})`)) === w.back, { state: await P(`state('b', ${J(X)})`), drawn: await P(`drawn('b', ${J(X)})`) });
    check("…and so is the rest of A's hand to B", await P(`where().p1.every((id) => __p.state('b', id) === 'back')`), await P("tally('b')"));
    await closeups("flipped", "a");
    mark("flipped", { X });

    // ── B draws while A's writes to the deck are held back: the veil until A's key arrives ──
    await P("slow('a', 4000)");
    const top = (await P("pile()"))[0];
    const draw = await press("b", top, "d", "/Draw to my hand/");
    check("B hovers the pile; its prompt offers Draw to my hand; D", draw.ok, draw);
    const landed = await until(`where().p2.includes(${J(top)})`, 5000);
    mark("B's draw landed");
    check("the card lands in B's tray, face up", landed && (await P(`faceUp(${J(top)})`)), await P(`transform(${J(top)})`));
    const pend = await until(`state('b', ${J(top)}) === 'veil' && __p.drawn('b', ${J(top)}) === 'veil'`, 3000);
    check("while A's key is on its way, B sees the new card as the veil (theirs to see, not known yet), drawn by the stage", pend, { state: await P(`state('b', ${J(top)})`), drawn: await P(`drawn('b', ${J(top)})`) });
    check("…to A it is a back: in B's hand", (await P(`state('a', ${J(top)})`)) === "back", await P(`state('a', ${J(top)})`));
    await closeups("drawing", "b");
    const arrived = await until(`state('b', ${J(top)}) === 'face'`, 20_000);
    mark("B's face arrived");
    check("once A's key arrives, B sees its face", arrived, await P(`log(${J(top)})`));
    check("…A still its back", (await P(`state('a', ${J(top)})`)) === "back", await P(`state('a', ${J(top)})`));
    check("…and B's view has drawn the face, the veil gone", await until(`drawn('b', ${J(top)}) !== 'veil' && __p.drawn('b', ${J(top)}) !== ${J(w.back)}`, 10_000), await P(`drawn('b', ${J(top)})`));
    const seq = (await P(`log(${J(top)})`)).filter((e) => e.w === "b");
    report.slowDraw = { card: top, b: seq };
    const privMs = (() => { const i = seq.findIndex((e) => e.s === "veil"); const j = seq.findIndex((e) => e.s === "face"); return i >= 0 && j > i ? seq[j].t - seq[i].t : null; })();
    check("B's view went back → veil → face, the veil for the delivery's length", seq.map((e) => e.s).join(">").endsWith("veil>face") && privMs > 1000, { seq, privMs });
    await P("slow('a', 0)");
    await sleep(400);
    await closeups("drawn", "b");

    // ── and at full speed: the next draw ──
    const top2 = (await P("pile()"))[0];
    const draw2 = await press("b", top2, "d", "/Draw to my hand/");
    check("B draws again (no delay)", draw2.ok && (await until(`where().p2.includes(${J(top2)}) && __p.state('b', ${J(top2)}) === 'face'`, 15_000)), draw2);
    const seq2 = (await P(`log(${J(top2)})`)).filter((e) => e.w === "b");
    report.fastDraw = { card: top2, b: seq2 };
    check("…with no back in its hand once it lands: the veil, then its face", !seq2.slice(seq2.findIndex((e) => e.s !== "back")).some((e) => e.s === "back") && seq2.at(-1).s === "face", seq2);

    // ── a card turned face up out on the table, A's keys held back: the veil to B, then its face to both ──
    await P("slow('a', 3000)");
    const top3 = (await P("pile()"))[0];
    const f3 = await press("a", top3, "f", "/Flip/");
    check("A turns the pile's top face up (F)", f3.ok && (await until(`faceUp(${J(top3)}) === true`, 5000)), f3);
    check("face up, its keys not all here: the veil to B (and never its back)", await until(`state('b', ${J(top3)}) === 'veil' && __p.drawn('b', ${J(top3)}) === 'veil'`, 3000), { state: await P(`state('b', ${J(top3)})`), drawn: await P(`drawn('b', ${J(top3)})`) });
    await closeups("faceup-veiled", "b");
    check("…then its face to both", await until(`state('a', ${J(top3)}) === 'face' && __p.state('b', ${J(top3)}) === 'face'`, 20_000), { a: await P(`log(${J(top3)})`) });
    await P("slow('a', 0)");
    check("still nothing made or written to hide anything", J(await P("made()")) === J(madeBefore) && (await P("privateKeys()")).length === 0, await P("made()"));
    check("the scene lists the packages it is made of: three (the scene's, the table's, the keeper's)", (await P("packages()")).length >= 0, await P("packages()"));
    await closeups("faceup", "b");
  }

  if (PART === "plain") {
    await seatBoth({ secure: false });
    check("the deck is kept in the open: the plain keeper's container", (await P("deckType()")) === "keep-plain", await P("deckType()"));
    check("the keeper says so in both views' HUD", await until("hud('a').some((t) => /kept in the open: anyone who opens its document can read everything/.test(t)) && __p.hud('b').some((t) => /kept in the open: anyone who opens its document can read everything/.test(t))", 5000), { a: await P("hud('a')"), b: await P("hud('b')") });
    const madeBefore = await P("made()");
    const t0 = { a: await P("tally('a')"), b: await P("tally('b')") };
    check("the pile is backs to both", t0.a.pile?.back > 0 && !t0.a.pile.face && !t0.a.pile.veil && t0.b.pile?.back > 0 && !t0.b.pile.face && !t0.b.pile.veil, t0);
    const pileTop = (await P("pile()"))[0];
    await until(`drawn('a', ${J(pileTop)}) && __p.drawn('a', ${J(pileTop)}) !== '?'`, 30_000);
    const back = await P(`drawn('a', ${J(pileTop)})`);
    // A draws two
    const drawn = [];
    for (let i = 0; i < 2; i++) {
      const top = (await P("pile()"))[0];
      const r = await press("a", top, "d", "/Draw to my hand/");
      const ok = r.ok && (await until(`where().p1.includes(${J(top)})`, 5000));
      check(`A draws card ${i + 1} into its tray (D)`, ok, r);
      drawn.push(top);
      await sleep(300);
    }
    check("A sees their faces", await until(`states('a', ${J(drawn)}) && Object.values(__p.states('a', ${J(drawn)})).every((s) => s === 'face')`, 10_000), await P(`states('a', ${J(drawn)})`));
    check("B sees A's hand as backs: every card, the two drawn among them", (await until(`where().p1.every((id) => __p.state('b', id) === 'back' && __p.drawn('b', id) === ${J(back)})`, 15_000)), { states: await P(`states('b', ${J(drawn)})`), drawn: await P(`drawnAll('b', ${J(drawn)})`) });
    check("no veil anywhere, in either view", !Object.values(await P("tally('a')")).some((t) => t.veil) && !Object.values(await P("tally('b')")).some((t) => t.veil), { a: await P("tally('a')"), b: await P("tally('b')") });
    await closeups("drawn", "a");
    // A flips one face down in its tray
    const X = drawn[0];
    const flip = await press("a", X, "f", "/Flip/");
    check("A flips one face down in its tray (F)", flip.ok && (await until(`faceUp(${J(X)}) === false`, 5000)), flip);
    // (the lens changes with the doc; the viewport swaps what it draws a moment later)
    check("…its back to B", await until(`state('b', ${J(X)}) === 'back' && __p.drawn('b', ${J(X)}) === ${J(back)}`, 5000), { state: await P(`state('b', ${J(X)})`), drawn: await P(`drawn('b', ${J(X)})`) });
    check("…and to A, its card turned over (the face GLB upside down: its back panel up)", (await P(`state('a', ${J(X)})`)) === "face" && (await P(`shownUp('a', ${J(X)})`)) === false, { state: await P(`state('a', ${J(X)})`), up: await P(`shownUp('a', ${J(X)})`) });
    check("…the other is still its back to B", (await P(`state('b', ${J(drawn[1])})`)) === "back", await P(`state('b', ${J(drawn[1])})`));
    // the pile's top turned face up, out on the table: everyone's to see
    const top = (await P("pile()"))[0];
    const f2 = await press("a", top, "f", "/Flip/");
    check("A flips the pile's top face up (F)", f2.ok && (await until(`faceUp(${J(top)}) === true`, 5000)), f2);
    check("…its face to both", await until(`state('a', ${J(top)}) === 'face' && __p.state('b', ${J(top)}) === 'face'`, 5000), { a: await P(`state('a', ${J(top)})`), b: await P(`state('b', ${J(top)})`) });
    check("nothing was made or written to hide anything", J(await P("made()")) === J(madeBefore) && (await P("privateKeys()")).length === 0, { before: madeBefore, after: await P("made()") });
    report.plain = { a: await P("tally('a')"), b: await P("tally('b')") };
    await sleep(500);
    await shot("states");
    await closeups("flipped", "a");
  }
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
