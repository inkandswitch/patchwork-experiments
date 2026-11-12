// Liar's dice at one table, by two people at once, in headless Chrome.
//
//   (in scene/, keep/ and dice/) pnpm build
//   node probes/liars-dice.mjs [--shots <dir>] [--show]
//
// Mounts the BUILT scene tool with the BUILT dice and keep plugins, twice,
// on REAL Automerge documents (liars-dice-probe.html, real-repo.js): A (Ana)
// and B (Ben) each have their own replica of every doc, and a change
// reaches the other 25 ms later by a real merge. Real mouse and keys over
// CDP.
//
//  1. A starts the empty scene from the start screen's "Liar's dice": six
//     cups, thirty dice, a pool, six seats, in both peers' docs.
//  2. A sits as Red, B as Blue.
//  3. Both shake (S over their own cup). Each one's lots are drawn by both
//     clients; each view knows its own dice and not the other's; the doc
//     says nothing of either roll.
//  4. Each sees their own dice (drawn showing what their seed says) and the
//     other's cup only (the other's dice aren't drawn at all).
//  5. A peeks (hold P): A's cup tilts in A's view alone; B is told, and sees
//     "Ana is peeking".
//  6. Both lift (L). The sealed parts are opened; the seed is checked here,
//     with WebCrypto, to be the hash of both openings; the dice are turned
//     up in the doc, and B sees A's dice exactly as A saw them.
//  7. A carries one of hers to the pool.
//  8. The forehead case: A shakes blind (menu): every seated part is
//     sealed, so nobody knows it while it's down, B included; A lifts: B's
//     client learns it (A's part sealed to B), B sees A's dice, A sees the
//     stage's veil on each; then A lifts again ("Show me") and sees exactly
//     what B saw.
//  9. B shakes, A knocks B's cup over (menu): its dice are turned up for all.
// 10. A down cup can't be slid off its dice: B drags A's (Green) cup, shaken
//     by A, and neither doc moves it.
// 11. A reroll, by a modified client: A shakes Green; once its lots are
//     drawn, A's replica writes a new attempt of the same draw. B's client
//     refuses it, writes why under its name, and its HUD says so; it's
//     drawn by A alone, which B's HUD says too.
// 12. A hijack, by a modified client: A shakes Yellow; B's replica writes a
//     round on A's draw sealed to B. No view turns the dice up from it;
//     A's client asks again for her own, B takes part (no fault), and B's
//     client never knows A's roll.
// 13. Two shake one cup (Purple) at the same moment: the merge keeps one
//     holder, and that holder's client ends with lots that are its shake's,
//     known to it alone.
//
// Prints a JSON checklist and a timeline; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["dice/dist/index.js", "keep/dist/index.js", "scene/dist/index.js"]) if (!existsSync(join(ROOT, p))) throw new Error(`no ${p}: build it first`);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "liars-dice-probe"));

const b = await browser({ root: ROOT, port: 4893, cdp: 9893, page: "/dice/probes/liars-dice-probe.html", width: 1816, height: 610, show: process.argv.includes("--show"), timeout: 300_000 });
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(`window.__p.${expr}`, ms, 40);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], timeline: [] };
const t0 = Date.now();
const mark = (what, extra = {}) => report.timeline.push({ t: +((Date.now() - t0) / 1000).toFixed(2), what, ...extra });
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `liars-dice-${name}.png`)));
const Q = JSON.stringify;

/** Hover an object in a view (two moves, so the stage sees the pointer arrive) and give that view the keys. */
async function hover(w, id) {
  const at = await until(`aimAt(${Q(id)}, ${Q(w)})`, 10_000);
  if (!at) return null;
  await b.move(at.x + 2, at.y + 1);
  await b.move(at.x, at.y);
  await until(`hovered(${Q(w)}) === ${Q(id)}`, 3000);
  await P(`focus(${Q(w)})`);
  return at;
}
async function menuPick(w, id, text) {
  const at = await until(`aimAt(${Q(id)}, ${Q(w)})`, 10_000);
  await b.click(at.x, at.y, { button: "right" });
  const items = await until(`menu(${Q(w)}).length && __p.menu(${Q(w)})`, 3000);
  const it = (items || []).find((m) => m.text === text);
  if (it) await b.click(it.x, it.y);
  else await b.key("Escape");
  return { offered: (items || []).map((m) => m.text), picked: !!it };
}

try {
  check("the page set up", (await b.waitFor("window.__ready", 30_000)) === true, await js("window.__p?.errors ?? null").catch(() => null));
  const V = await P("viewers");

  // ── 1. the table, from the start screen ──
  // the start screen rebuilds its list whenever another package registers templates, so a button found
  // early can move before the click lands (on another template, or Blank): click once it has held still
  let tpl = await until("template('a', 'dice.liars-dice')", 15_000);
  for (let still = 0, t0 = Date.now(); still < 3 && Date.now() - t0 < 15_000; ) {
    await sleep(400);
    const now = await P("template('a', 'dice.liars-dice')");
    still = now && tpl && now.x === tpl.x && now.y === tpl.y ? still + 1 : 0;
    tpl = now;
  }
  check("A's start screen offers Liar's dice", !!tpl, tpl);
  await b.click(tpl.x, tpl.y);
  check("the table is in both peers' docs: 6 cups (each drawn by lots), 30 dice", await until("count('a').cups === 6 && __p.count('b').cups === 6 && __p.count('b').dice === 30 && __p.count('b').lots === 6", 15_000), { a: await P("count('a')"), b: await P("count('b')") });
  check("…and every piece is built in both views", await until("allLoaded('a') && __p.allLoaded('b')", 60_000), { a: await P("allLoaded('a')"), b: await P("allLoaded('b')") });
  const cup = { a: await P("id('a', 'Red cup')"), b: await P("id('a', 'Blue cup')") };
  const dice = { a: [], b: [] };
  for (let i = 1; i <= 5; i++) {
    dice.a.push(await P(`id('a', 'Red die ${i}')`));
    dice.b.push(await P(`id('a', 'Blue die ${i}')`));
  }
  mark("table laid out", { cup });

  // ── 2. seats ──
  await P("play('a')");
  await P("play('b')");
  await P("pick('a', 'seat1')");
  await P("pick('b', 'seat2')");
  check("A sits as Red, B as Blue; both play", await until(`seats().seat1.player === ${Q(V.a)} && __p.seats().seat2.player === ${Q(V.b)} && __p.activity('a') === 'play' && __p.activity('b') === 'play'`, 10_000), await P("seats()"));
  check("the cup extension and lots run in both views", (await P("running('a')")).includes("dice.cup") && (await P("running('b')")).includes("keep.lots"), { a: await P("running('a')") });
  await sleep(1500); // seat cameras settle
  await shot("seated");

  // ── 3. both shake ──
  const overA = await hover("a", cup.a);
  check("over her cup, A's use prompt offers Shake", await until("prompt('a').some((t) => /Shake/.test(t))", 3000), { prompt: await P("prompt('a')"), overA, hovered: await P("hovered('a')"), cup: cup.a, aim: await P(`debugAim(${Q(cup.a)}, 'a')`) });
  const tShake = Date.now();
  await b.key("s");
  const tKnownA = (await until(`lots('a', ${Q(cup.a)})?.phase === 'known'`, 15_000)) && Date.now() - tShake;
  report.latency = { shakeToKnownMs: tKnownA };
  await hover("b", cup.b);
  await b.key("s");
  const shook = await until(`cup('a', ${Q(cup.a)}).roll && __p.cup('a', ${Q(cup.b)}).roll && __p.lots('a', ${Q(cup.a)})?.phase === 'known' && __p.lots('b', ${Q(cup.b)})?.phase === 'known'`, 15_000);
  const st = { aa: await P(`lots('a', ${Q(cup.a)})`), ab: await P(`lots('a', ${Q(cup.b)})`), ba: await P(`lots('b', ${Q(cup.a)})`), bb: await P(`lots('b', ${Q(cup.b)})`) };
  mark("both shook", { st });
  check("both shook: each cup's roll is drawn by both clients", shook && Q(st.aa.contributors) === Q([V.a, V.b].sort()) && Q(st.bb.contributors) === Q([V.a, V.b].sort()), st);
  check("A's client knows A's roll and not B's; B's knows B's and not A's", !!st.aa.seed && !st.ab.seed && !st.ba.seed && !!st.bb.seed && st.ab.phase === "sealed" && st.ba.phase === "sealed", st);
  const roundA = await P(`round('b', ${Q(cup.a)})`);
  check("in the doc, A's part of her roll is a commitment only; B's is open", !roundA.opens[V.a] && !!roundA.opens[V.b] && !!roundA.commits[V.a], { opens: Object.keys(roundA.opens), commits: Object.keys(roundA.commits) });
  const under = [];
  for (const d of [...dice.a, ...dice.b]) under.push(await P(`transform('b', ${Q(d)})`));
  check("the doc says nothing of either roll: every die under a cup lies face 0 up, turned only about +Y", under.every((t) => t.rotation[0] === 0 && t.rotation[2] === 0), under.map((t) => t.rotation));
  check("the cups are down over them: nobody else may see under either", Q(await P(`audience('a', ${Q(dice.a[0])})`)) === Q([V.a]) && Q(await P(`audience('b', ${Q(dice.b[0])})`)) === Q([V.b]), { a: await P(`audience('a', ${Q(dice.a[0])})`), b: await P(`audience('b', ${Q(dice.b[0])})`) });
  await sleep(900); // the rattle ends

  // ── 4. each sees their own dice, and the other's cup only ──
  const wantA = await P(`expected(${Q(st.aa.seed)})`);
  const wantB = await P(`expected(${Q(st.bb.seed)})`);
  const seenByA = [];
  const seenByB = [];
  for (const d of dice.a) seenByA.push(await P(`drawnFace('a', ${Q(d)})`));
  for (const d of dice.b) seenByB.push(await P(`drawnFace('b', ${Q(d)})`));
  check("A's view draws her five dice showing what her seed says", seenByA.every((f, i) => f?.face === wantA[i]), { want: wantA, drawn: seenByA, why: await P(`whyNotDrawn('a', ${Q(dice.a[0])})`) });
  check("B's view draws his five showing what his seed says", seenByB.every((f, i) => f?.face === wantB[i]), { want: wantB, drawn: seenByB });
  const hiddenInA = [];
  const hiddenInB = [];
  for (const d of dice.b) hiddenInA.push(await P(`drawn('a', ${Q(d)})`));
  for (const d of dice.a) hiddenInB.push(await P(`drawn('b', ${Q(d)})`));
  check("A's view doesn't draw B's dice at all, nor B's A's: only the cups", hiddenInA.every((x) => x === false) && hiddenInB.every((x) => x === false) && (await P(`drawn('a', ${Q(cup.b)})`)) && (await P(`drawn('b', ${Q(cup.a)})`)), { hiddenInA, hiddenInB });
  await shot("shaken");

  // ── 5. A peeks ──
  await hover("a", cup.a);
  // (the prompt shows three verbs at most, and the hand's Flip is first: Lift is L whether it's shown or not)
  check("A's prompt offers Shake and hold-P Peek", await until("prompt('a').some((t) => /Peek/.test(t)) && __p.prompt('a').some((t) => /Shake/.test(t))", 3000), await P("prompt('a')"));
  await b.keyDown("p");
  check("holding P, A's cup tilts in A's view", await until(`tilted('a', ${Q(cup.a)})`, 3000), { held: await P("heldVerbs('a')"), focus: await P("hasFocus()") });
  check("…and not in B's", !(await P(`tilted('b', ${Q(cup.a)})`)));
  check("B is told Ana peeked, and sees that she is peeking, not what", (await until("notices('b').includes('Ana peeked under their cup.')", 3000)) && (await until("tags('b').includes('Ana is peeking')", 3000)), { notices: await P("notices('b')"), tags: await P("tags('b')") });
  await shot("peeking");
  await b.keyUp("p");
  check("letting go of P, it's back down", await until(`tilted('a', ${Q(cup.a)}) === false`, 3000), { held: await P("heldVerbs('a')"), prompt: await P("prompt('a')"), cup: await P("cupDebug('a')") });
  mark("A peeked");

  // ── 6. both lift ──
  await hover("a", cup.a);
  await b.key("l");
  await hover("b", cup.b);
  const tLift = Date.now();
  await b.key("l");
  report.latency.liftToTurnedUpMs = (await until(`cup('a', ${Q(cup.b)}).roll.done && __p.cup('b', ${Q(cup.b)}).roll.done`, 15_000)) && Date.now() - tLift;
  const lifted = await until(`cup('a', ${Q(cup.a)}).roll.done && __p.cup('a', ${Q(cup.b)}).roll.done && __p.cup('b', ${Q(cup.a)}).roll.done`, 15_000);
  check("both lifted: each roll's sealed part was opened and its dice turned up in the doc", lifted, { a: await P(`cup('a', ${Q(cup.a)})`), b: await P(`cup('a', ${Q(cup.b)})`) });
  for (const [who, c] of [["A", cup.a], ["B", cup.b]]) {
    const mine = await P(`seedFromOpenings('a', ${Q(c)})`);
    const known = { a: await P(`lots('a', ${Q(c)})`), b: await P(`lots('b', ${Q(c)})`) };
    check(`${who}'s seed is the hash of both openings (worked out here with WebCrypto), the same in both views: no one client chose it`, mine.contributors.length === 2 && known.a.seed === mine.seed && known.b.seed === mine.seed && known.a.public && known.b.public, { mine, known });
  }
  await sleep(500);
  const afterB = [];
  const afterA = [];
  for (const d of dice.a) afterB.push(await P(`drawnFace('b', ${Q(d)})`));
  for (const d of dice.b) afterA.push(await P(`drawnFace('a', ${Q(d)})`));
  check("B sees A's dice exactly as A saw them under her cup", afterB.every((f, i) => f?.face === seenByA[i].face), { aSaw: seenByA.map((f) => f.label), bSees: afterB.map((f) => f?.label) });
  check("…and A sees B's as B saw them", afterA.every((f, i) => f?.face === seenByB[i].face), { bSaw: seenByB.map((f) => f.label), aSees: afterA.map((f) => f?.label) });
  const told = { a: await P("notices('a')"), b: await P("notices('b')") };
  check("each view says what each rolled, drawn by Ana and Ben", told.a.some((n) => /^You rolled .*drawn by (Ben and you|you and Ben)\.$/.test(n)) && told.b.some((n) => /^Ana rolled .*drawn by/.test(n)), told);
  mark("both lifted", { aSaw: seenByA.map((f) => f.label), bSaw: seenByB.map((f) => f.label) });
  await shot("lifted");

  // ── 7. A puts a die in the pool ──
  // any of A's dice will do: take one the pointer really lands on (a die can sit behind its
  // neighbours or the lifted cup from where A looks, and a press on those would carry nothing)
  let lost = dice.a[0];
  for (const d of dice.a) {
    await hover("a", d);
    if ((await P("hovered('a')")) === d) {
      lost = d;
      break;
    }
  }
  const pool = await P("id('a', 'Pool')");
  const from = await until(`aimAt(${Q(lost)}, 'a')`, 10_000);
  const to = await until(`aimAt(${Q(pool)}, 'a')`, 10_000);
  await b.drag([from.x, from.y], [to.x, to.y], { steps: 16 });
  const inPool = await until(`fromMiddle('b', ${Q(lost)}) < 0.1 && __p.fromMiddle('a', ${Q(lost)}) < 0.1`, 5000);
  check("A carried a die into the pool, by hand: both docs have it there, and it's an ordinary die", inPool && (await P(`drawn('b', ${Q(lost)})`)), { a: await P(`transform('a', ${Q(lost)})`), b: await P(`transform('b', ${Q(lost)})`), drawnB: await P(`drawn('b', ${Q(lost)})`), whyB: await P(`whyNotDrawn('b', ${Q(lost)})`), cupB: await P("cupDebug('b')"), lost });
  mark("a die to the pool");
  await shot("pool");

  // ── 8. the forehead case ──
  const blind = await menuPick("a", cup.a, "Shake blind");
  check("A's menu on her cup offers Shake blind", blind.picked, blind.offered);
  const four = dice.a.slice(1);
  const drawnBlind = await until(`cup('b', ${Q(cup.a)}).blind && __p.lots('b', ${Q(cup.a)})?.draw === __p.cup('b', ${Q(cup.a)}).roll.draw && __p.lots('b', ${Q(cup.a)})?.phase === 'sealed' && __p.lots('a', ${Q(cup.a)})?.phase === 'sealed'`, 15_000);
  const sf = { a: await P(`lots('a', ${Q(cup.a)})`), b: await P(`lots('b', ${Q(cup.a)})`) };
  check("blind: every seated part sealed (A's and B's), so while it's down nobody knows it, B included", drawnBlind && !sf.a.seed && !sf.b.seed && Q(sf.b.sealers) === Q([V.a, V.b].sort()) && Q((await P(`cup('a', ${Q(cup.a)})`)).roll.dice) === Q(four), sf);
  const roundBlind = await P(`round('b', ${Q(cup.a)})`);
  check("…in the doc, neither part is in the clear nor sealed to anyone yet", Object.keys(roundBlind.opens).length === 0 && Object.keys(roundBlind.sealed).length === 0, { opens: roundBlind.opens, sealed: roundBlind.sealed });
  check("…and the four dice still under the cup: nobody may see them", Q(await P(`audience('a', ${Q(four[0])})`)) === "[]", await P(`audience('a', ${Q(four[0])})`));
  await sleep(900);
  await hover("a", cup.a);
  await b.key("l");
  const up = await until(`cup('b', ${Q(cup.a)}).up && __p.cup('b', ${Q(cup.a)}).blind && __p.lots('b', ${Q(cup.a)})?.seed`, 10_000);
  sf.b = await P(`lots('b', ${Q(cup.a)})`);
  const sealedTo = Object.fromEntries(Object.entries((await P(`round('b', ${Q(cup.a)})`)).sealed).map(([k, v]) => [k, Object.keys(v)]));
  check("lifted: A's part was sealed to B (and to nobody else); B's to nobody; B's client knows it, A's doesn't", !!sf.b.seed && Q(sealedTo) === Q({ [V.a]: [V.b] }) && (await P(`lots('a', ${Q(cup.a)})`)).seed === null, { sealedTo, b: sf.b });
  await sleep(600);
  const aView = [];
  const bView = [];
  for (const d of four) aView.push({ veiled: await P(`veiled('a', ${Q(d)})`), face: await P(`drawnFace('a', ${Q(d)})`) });
  for (const d of four) bView.push({ veiled: await P(`veiled('b', ${Q(d)})`), face: await P(`drawnFace('b', ${Q(d)})`) });
  const wantBlind = (await P(`expected(${Q(sf.b.seed)}, 6, 4)`));
  check("A lifted her blind cup: the audience is Ben alone", up && Q(await P(`audience('a', ${Q(four[0])})`)) === Q([V.b]), { up, audience: await P(`audience('a', ${Q(four[0])})`), cup: await P(`cup('a', ${Q(cup.a)})`), V });
  check("B sees A's four dice as their seed says", bView.every((v, i) => !v.veiled && v.face?.face === wantBlind[i]), { want: wantBlind, bView });
  check("A sees the stage's veil on each (face up, kept from her), never the dice", aView.every((v) => v.veiled), aView);
  check("…and A's client still can't know them", (await P(`lots('a', ${Q(cup.a)})`)).seed === null);
  check("both views label it blind", (await P("tags('a')")).includes("Blind: hidden from you") && (await P("tags('b')")).includes("Blind: hidden from Ana"), { a: await P("tags('a')"), b: await P("tags('b')") });
  await shot("blind");
  await hover("a", cup.a);
  check("A's prompt now offers Show me", await until("prompt('a').some((t) => /Show me/.test(t))", 3000), await P("prompt('a')"));
  await b.key("l");
  const shown = await until(`cup('a', ${Q(cup.a)}).roll.done && !__p.veiled('a', ${Q(four[0])})`, 15_000);
  await sleep(500);
  const aNow = [];
  for (const d of four) aNow.push(await P(`drawnFace('a', ${Q(d)})`));
  check("Show me: B's part is opened, and A sees exactly what B saw", shown && aNow.every((f, i) => f?.face === bView[i].face.face), { bSaw: bView.map((v) => v.face?.label), aSees: aNow.map((f) => f?.label) });
  mark("forehead", { bSaw: bView.map((v) => v.face?.label) });

  // ── 9. a cup knocked over ──
  await sleep(300);
  await hover("b", cup.b);
  await b.key("s");
  check("B shook again", await until(`lots('b', ${Q(cup.b)})?.phase === 'known' && __p.lots('b', ${Q(cup.b)})?.draw === __p.cup('b', ${Q(cup.b)}).roll.draw`, 15_000), { lots: await P(`lots('b', ${Q(cup.b)})`), cup: await P(`cup('b', ${Q(cup.b)})`), prompt: await P("prompt('b')"), hovered: await P("hovered('b')") });
  await sleep(900);
  const knocked = await menuPick("a", cup.b, "Knock over");
  check("A's menu on B's cup offers Knock over", knocked.picked, knocked.offered);
  check("knocked over, B's cup shows its dice to all: turned up in the doc, and A's view draws them", await until(`cup('a', ${Q(cup.b)}).roll.done && __p.drawn('a', ${Q(dice.b[0])})`, 15_000), await P(`cup('a', ${Q(cup.b)})`));
  await shot("knocked");
  mark("knocked over");

  // ── 10. a down cup can't be slid off its dice ──
  const green = await P("id('a', 'Green cup')");
  const yellow = await P("id('a', 'Yellow cup')");
  const purple = await P("id('a', 'Purple cup')");
  await hover("a", green);
  await b.key("s");
  const greenKnown = await until(`lots('a', ${Q(green)})?.phase === 'known' && __p.lots('b', ${Q(green)})?.phase === 'sealed' && __p.cup('b', ${Q(green)}).holder === ${Q(V.a)}`, 15_000);
  check("A shook the Green cup: her lots, known to her", greenKnown, { a: await P(`lots('a', ${Q(green)})`), b: await P(`lots('b', ${Q(green)})`) });
  await sleep(900);
  const greenAt = await P(`transform('a', ${Q(green)})`);
  check("neither view's hand will pick up a cup down over dice", !(await P(`carryable('a', ${Q(green)})`)) && !(await P(`carryable('b', ${Q(green)})`)));
  const gFrom = await until(`aimAt(${Q(green)}, 'b')`, 10_000);
  await b.drag([gFrom.x, gFrom.y], [gFrom.x + 60, gFrom.y + 20], { steps: 12 });
  await sleep(400);
  const gA = await P(`transform('a', ${Q(green)})`), gB = await P(`transform('b', ${Q(green)})`);
  check("B dragged at A's down cup: it didn't move in either doc, and nothing was turned up", Q(gA) === Q(greenAt) && Q(gB) === Q(greenAt) && !(await P(`cup('a', ${Q(green)})`)).roll.done && (await P(`lots('b', ${Q(green)})`)).seed === null, { greenAt, gA, gB });

  // ── 11. a reroll, written by a modified client ──
  const firstGreen = (await P(`lots('b', ${Q(green)})`)).id;
  const forgedReroll = await P(`forge('a', ${Q(green)}, 'reroll')`);
  const refused = await until(`round('b', ${Q(green)})?.id === ${Q(forgedReroll)} && !!__p.round('b', ${Q(green)}).protests[${Q(V.b)}]`, 5000);
  const rr = await P(`round('b', ${Q(green)})`);
  check("A's replica wrote a new attempt of the same draw: B's client refused it (no commit from B) and wrote why, under its own name", refused && !rr.commits[V.b] && rr.protests[V.b]?.why === "complete" && rr.protests[V.b]?.of === firstGreen, { protests: rr.protests, commits: Object.keys(rr.commits) });
  const sawIt = await until(`hudLines('b').some((t) => /\\byou\\b.* saw Ana draw the lots for Green cup again after the draw before was made, and took no part\\.$/i.test(t))`, 3000);
  check("…and B's HUD says so", sawIt, await P("hudLines('b')"));
  const alone = await until(`hudLines('b').includes('The lots for Green cup were drawn by Ana alone: nobody else took part.')`, 12_000);
  check("…and at its commit deadline it's closed with A alone, which B's HUD says", alone && Q((await P(`lots('b', ${Q(green)})`)).contributors) === Q([V.a]), { hud: await P("hudLines('b')"), lots: await P(`lots('b', ${Q(green)})`) });
  mark("reroll refused");

  // ── 12. a hijack, written by a modified client ──
  await hover("a", yellow);
  await b.key("s");
  const yKnown = await until(`lots('a', ${Q(yellow)})?.phase === 'known' && __p.cup('b', ${Q(yellow)}).holder === ${Q(V.a)}`, 15_000);
  check("A shook the Yellow cup: her lots, known to her", yKnown, await P(`lots('a', ${Q(yellow)})`));
  const yDraw = (await P(`cup('a', ${Q(yellow)})`)).roll.draw;
  const forgedHijack = await P(`forge('b', ${Q(yellow)}, 'hijack')`);
  // A's client serves the forged round (commits, opens) and then asks again for her own
  const healed = await until(`round('a', ${Q(yellow)})?.by === ${Q(V.a)} && __p.round('a', ${Q(yellow)})?.id !== ${Q(forgedHijack)} && __p.round('a', ${Q(yellow)})?.draw === ${Q(yDraw)} && __p.lots('a', ${Q(yellow)})?.phase === 'known' && __p.lots('b', ${Q(yellow)})?.phase === 'sealed'`, 15_000);
  const yr = await P(`round('b', ${Q(yellow)})`);
  check("B's replica wrote a round sealed to B on A's draw: A's client asked again for her own, B took part (no fault: A never knew B's round), and it's hers", healed && Q(yr.sealers) === Q([V.a]) && !!yr.commits[V.b] && Object.keys(yr.protests).length === 0, { round: { by: yr.by, sealers: yr.sealers, commits: Object.keys(yr.commits), protests: yr.protests }, a: await P(`lots('a', ${Q(yellow)})`) });
  check("…B's client never knew A's Yellow roll, and nothing was turned up from the forged round", (await P(`lots('b', ${Q(yellow)})`)).seed === null && !(await P(`cup('a', ${Q(yellow)})`)).roll.done && !(await P(`cup('b', ${Q(yellow)})`)).roll.done);
  mark("hijack put right");

  // ── 13. two shake one cup at once ──
  await P(`verb('a', 'dice.cup', 'shake', ${Q(purple)}) && __p.verb('b', 'dice.cup', 'shake', ${Q(purple)})`);
  const settledP = await b.waitFor(`(() => { const c = __p.cup('a', ${Q(purple)}), d = __p.cup('b', ${Q(purple)}); const h = c?.holder; if (!h || !c.roll || Q(c) !== Q(d)) return false; const mine = h === ${Q(V.a)} ? 'a' : 'b', other = mine === 'a' ? 'b' : 'a'; const s = __p.lots(mine, ${Q(purple)}), t = __p.lots(other, ${Q(purple)}); return s?.draw === c.roll.draw && s.by === h && s.phase === 'known' && t?.draw === c.roll.draw && t.phase === 'sealed' && t.seed === null; })()`.replace(/Q\(/g, "JSON.stringify("), 20_000, 40);
  const pc = await P(`cup('a', ${Q(purple)})`);
  check("both shook the Purple cup at once: the merged doc has one holder, and the lots on it are that shake's, known to the holder's client alone", settledP, { cup: pc, a: await P(`lots('a', ${Q(purple)})`), b: await P(`lots('b', ${Q(purple)})`), hudA: await P("hudLines('a')"), hudB: await P("hudLines('b')") });
  mark("simultaneous shake");

  const errs = (await P("errors")).filter((e) => !/KHR_parallel_shader_compile|GPU stall due to ReadPixels/.test(e));
  check("no errors or warnings on the page", errs.length === 0, errs);
  report.net = await P("net.stats()");
} catch (err) {
  check("ran to the end", false, String(err?.stack ?? err));
  report.errors = await P("errors").catch(() => null);
}
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
