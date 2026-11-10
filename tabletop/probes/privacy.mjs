// What a hidden card looks like to each of two people, in headless Chrome:
// its back face down, its face when it's theirs to see, and the privacy face
// (privacy.js) when it's face up but not theirs.
//
//   (in scene/, tabletop/ and card-table/) pnpm build
//   node probes/privacy.mjs --part secure|plain [--shots <dir>] [--show]
//
// privacy-probe.html, two views A (Ana) and B (Ben) of one doc, real mouse
// and keys over CDP.
// - secure: a Lost Cities table from the template, A in Player 1 and B in
//   Player 2. Once dealt, A sees its hand's faces, B's hand as privacy faces
//   and the pile as backs (and B the other way round); the scene has one
//   privacy file. A flips a card of its hand face down with F: it's the back
//   to both. B draws with D while A's writes to the deck are held back: the
//   new card is the privacy face to B until A's key reaches it, then its face.
// - plain: a Lost Cities table with a plain deck: the plain-deck HUD warning;
//   the pile is backs to both; A draws two: faces to A, privacy to B; A flips
//   one face down: the back to B; the pile's top flipped face up: its face to both.
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
    check("before the deal A's own hand shows backs, not privacy faces", A.p1 && A.p1.back > 0 && !A.p1.private && !A.p1.face && !(A.p2?.private) && !(A.pile?.private), A);
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

/** what each view shows: A's own hand faces, B's hand private, the pile backs (and B the mirror) */
async function threeStates(tag) {
  // until the privacy file is made and every view's lens settled
  await until("where().p2.every((id) => __p.state('a', id) === 'private') && __p.where().p1.every((id) => __p.state('b', id) === 'private')", 15_000);
  const w = await P("where()");
  const A = await P("tally('a')"), B = await P("tally('b')");
  check(`${tag}A sees its own hand's faces (${w.p1.length})`, A.p1 && A.p1.face === w.p1.length, A);
  check(`${tag}A sees B's hand as privacy faces, not backs (${w.p2.length})`, A.p2 && A.p2.private === w.p2.length && !A.p2.back, A);
  check(`${tag}A sees the pile as backs`, A.pile && A.pile.back > 0 && !A.pile.face && !A.pile.private, A);
  check(`${tag}B sees its own hand's faces`, B.p2 && B.p2.face === w.p2.length, B);
  check(`${tag}B sees A's hand as privacy faces`, B.p1 && B.p1.private === w.p1.length && !B.p1.back, B);
  check(`${tag}B sees the pile as backs`, B.pile && B.pile.back > 0 && !B.pile.face && !B.pile.private, B);
  // and what's drawn is the privacy GLB (its frosted field and padlock), the face GLB, or the object's own back
  const drawnOk = await until(`where().p2.every((id) => __p.drawn('a', id) === 'privacy') && __p.where().p1.every((id) => __p.drawn('b', id) === 'privacy') && __p.where().p1.every((id) => __p.drawn('a', id) && __p.drawn('a', id) !== 'privacy')`, 20_000);
  check(`${tag}…and that is what each view has drawn (the privacy GLB's frost and lock)`, drawnOk, { a: await P(`drawnAll('a', ${J([...w.p1, ...w.p2])})`), b: await P(`drawnAll('b', ${J([...w.p1, ...w.p2])})`), pileA: await P(`drawn('a', ${J((await P("pile()"))[0])})`) });
  return w;
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
    report.beforeSeated = { privacyKeys: await P("privateKeys()"), a: await P("tally('a')") };
    await P("open('b')");
    await seatBoth({ secure: true });
    const w = await threeStates("");
    const keys = await P("privateKeys()");
    check("the scene has exactly one privacy file in doc.assets", keys.length === 1, { keys, made: await P("filesMade()") });
    report.privacy = { keys, made: await P("filesMade()") };
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
    check("B: its back (no lens: the back GLB), not the privacy face", await until(`state('b', ${J(X)}) === 'back'`, 5000) && (await P(`drawn('b', ${J(X)})`)) === "diamond,card", { state: await P(`state('b', ${J(X)})`), drawn: await P(`drawn('b', ${J(X)})`) });
    check("…and the rest of A's hand is still the privacy face to B", (await P("where()")).p1.filter((id) => id !== X).every((id) => true) && (await P(`where().p1.filter((id) => id !== ${J(X)}).every((id) => __p.state('b', id) === 'private')`)), await P("tally('b')"));
    await closeups("flipped", "a");
    mark("flipped", { X });

    // ── B draws while A's writes to the deck are held back: the privacy face until A's key arrives ──
    await P("slow('a', 4000)");
    const top = (await P("pile()"))[0];
    const draw = await press("b", top, "d", "/Draw to my hand/");
    check("B hovers the pile; its prompt offers Draw to my hand; D", draw.ok, draw);
    const landed = await until(`where().p2.includes(${J(top)})`, 5000);
    mark("B's draw landed");
    check("the card lands in B's tray, face up", landed && (await P(`faceUp(${J(top)})`)), await P(`transform(${J(top)})`));
    const pend = await until(`state('b', ${J(top)}) === 'private' && __p.drawn('b', ${J(top)}) === 'privacy'`, 3000);
    check("while A's key is on its way, B sees the new card as the privacy face (not the back)", pend, { state: await P(`state('b', ${J(top)})`), drawn: await P(`drawn('b', ${J(top)})`) });
    check("…and so does A", (await P(`state('a', ${J(top)})`)) === "private", await P(`state('a', ${J(top)})`));
    await closeups("drawing", "b");
    const arrived = await until(`state('b', ${J(top)}) === 'face'`, 20_000);
    mark("B's face arrived");
    check("once A's key arrives, B sees its face", arrived, await P(`log(${J(top)})`));
    check("…A still the privacy face", (await P(`state('a', ${J(top)})`)) === "private", await P(`state('a', ${J(top)})`));
    const seq = (await P(`log(${J(top)})`)).filter((e) => e.w === "b");
    report.slowDraw = { card: top, b: seq };
    const privMs = (() => { const i = seq.findIndex((e) => e.s === "private"); const j = seq.findIndex((e) => e.s === "face"); return i >= 0 && j > i ? seq[j].t - seq[i].t : null; })();
    check("B's view went back → private → face, the privacy face for the delivery's length", seq.map((e) => e.s).join(">").endsWith("private>face") && privMs > 1000, { seq, privMs });
    await P("slow('a', 0)");
    await sleep(400);
    await closeups("drawn", "b");

    // ── and at full speed: the next draw ──
    const top2 = (await P("pile()"))[0];
    const draw2 = await press("b", top2, "d", "/Draw to my hand/");
    check("B draws again (no delay)", draw2.ok && (await until(`where().p2.includes(${J(top2)}) && __p.state('b', ${J(top2)}) === 'face'`, 15_000)), draw2);
    const seq2 = (await P(`log(${J(top2)})`)).filter((e) => e.w === "b");
    report.fastDraw = { card: top2, b: seq2 };
    check("…with no back in its hand: the privacy face, then its face", !seq2.slice(seq2.findIndex((e) => e.s !== "back")).some((e) => e.s === "back") && seq2.at(-1).s === "face", seq2);
  }

  if (PART === "plain") {
    await seatBoth({ secure: false });
    check("the deck is a plain one", (await P("deckType()")) !== "secure-deck", await P("deckType()"));
    check("the plain-deck HUD warning is there, in both views", await until("hud('a').some((t) => /can read every card, hands included/.test(t)) && __p.hud('b').some((t) => /can read every card, hands included/.test(t))", 5000), { a: await P("hud('a')"), b: await P("hud('b')") });
    const t0 = { a: await P("tally('a')"), b: await P("tally('b')") };
    check("the pile is backs to both", t0.a.pile?.back > 0 && !t0.a.pile.face && !t0.a.pile.private && t0.b.pile?.back > 0 && !t0.b.pile.face && !t0.b.pile.private, t0);
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
    check("B sees them as privacy faces", (await until(`where().p1.every((id) => __p.state('b', id) === 'private' && __p.drawn('b', id) === 'privacy')`, 15_000)), { states: await P(`states('b', ${J(drawn)})`), drawn: await P(`drawnAll('b', ${J(drawn)})`) });
    check("the scene has one privacy file", (await P("privateKeys()")).length === 1, await P("privateKeys()"));
    await closeups("drawn", "a");
    // A flips one face down in its tray
    const X = drawn[0];
    const flip = await press("a", X, "f", "/Flip/");
    check("A flips one face down in its tray (F)", flip.ok && (await until(`faceUp(${J(X)}) === false`, 5000)), flip);
    // (the lens changes with the doc; the viewport swaps what it draws a moment later)
    check("…its back to B", await until(`state('b', ${J(X)}) === 'back' && __p.drawn('b', ${J(X)}) === "diamond,card"`, 5000), { state: await P(`state('b', ${J(X)})`), drawn: await P(`drawn('b', ${J(X)})`) });
    check("…and to A, its card turned over (the face GLB upside down: its back panel up)", (await P(`state('a', ${J(X)})`)) === "face" && (await P(`shownUp('a', ${J(X)})`)) === false, { state: await P(`state('a', ${J(X)})`), up: await P(`shownUp('a', ${J(X)})`) });
    check("…the other is still the privacy face to B", (await P(`state('b', ${J(drawn[1])})`)) === "private", await P(`state('b', ${J(drawn[1])})`));
    // the pile's top turned face up, out on the table: everyone's to see
    const top = (await P("pile()"))[0];
    const f2 = await press("a", top, "f", "/Flip/");
    check("A flips the pile's top face up (F)", f2.ok && (await until(`faceUp(${J(top)}) === true`, 5000)), f2);
    check("…its face to both", await until(`state('a', ${J(top)}) === 'face' && __p.state('b', ${J(top)}) === 'face'`, 5000), { a: await P(`state('a', ${J(top)})`), b: await P(`state('b', ${J(top)})`) });
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
