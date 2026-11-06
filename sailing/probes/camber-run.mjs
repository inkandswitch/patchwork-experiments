// A hull drawn in camber, rigged in the editor's parts bin and sailed, in
// headless Chrome: the whole path from another tool's hull to a ship.
//
//   (in scene/ and sailing/) pnpm build; (in camber/patchwork) npm run build
//   node probes/camber-run.mjs [--camber ~/dev/camber] [--example cuvature-kink-with-unmodified-pchip.json]
//                              [--scale 12] [--shots <dir>] [--show] [--swiftshader]
//
// Mounts the BUILT scene tool with the BUILT sailing plugins and camber's
// BUILT plugins (camber/patchwork/dist, served at /camber/: a probe may
// borrow another package's build at dev time; no package imports another).
// The scene starts with a sea and nothing else. Then, as someone would:
// - adds one of camber's example hulls (camber's scene:source builds its GLB
//   in the page, in the floating frame: bow +X, waterline y = 0, with
//   extras.ship), scaled to a yacht's size, and gives it the Ship trait with
//   no frame: her frame comes from the GLB's extras.ship.forward / up;
// - drags the wheel, the windlass, the ladder and the mast from the parts
//   bin onto her deck (real HTML drags into the view): each goes under the
//   hull, squared to her bow, upright, on her deck;
// - plays: she floats at her waterline and sails bow first (her velocity
//   along the hull's +X, the way camber drew her bow) under the sail the
//   mast brought;
// - comes aboard: stands on her deck, and the use prompt reaches the wheel.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
const arg = (name, fallback = null) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const CAMBER = resolve(arg("--camber", join(homedir(), "dev/camber")));
// one with a transom: on some (flat-bottom, narrow-transom) camber finds none, and the open stern shows where the sea is cut away inside her
const EXAMPLE = arg("--example", "cuvature-kink-with-unmodified-pchip.json");
// camber's examples are drawn a metre long: made 12 m, the size sailing's stock rig is drawn for
// (its stays run to a 12 m sloop's stem, chainplates and transom; a smaller hull scales the mast down)
const SCALE = Number(arg("--scale", 12));
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "camber-shots"));
for (const p of [join(ROOT, "sailing/dist/index.js"), join(ROOT, "scene/dist/index.js"), join(CAMBER, "patchwork/dist/index.js"), join(CAMBER, "examples", EXAMPLE)]) if (!existsSync(p)) throw new Error(`no ${p}: build it first`);

const b = await browser({
  root: ROOT, port: 4780, cdp: 9780, page: `/sailing/probes/camber-probe.html?example=${encodeURIComponent(EXAMPLE)}`, width: 1280, height: 760,
  show: process.argv.includes("--show"), gpu: !process.argv.includes("--swiftshader"), timeout: 600_000,
  mounts: { "/camber/": join(CAMBER, "patchwork/dist"), "/camber-examples/": join(CAMBER, "examples") },
});
const js = (expr, ms = 30_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e) => js(`window.__p.${e}`);
const until = (expr, ms = 10_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { example: EXAMPLE, scale: SCALE, checks: list.checks, details: list.details, shots: [], measured: {} };
const EXPECTED = /KHR_parallel_shader_compile|pointer lock refused|GPU stall due to ReadPixels/;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `camber-${name}.png`)));
const n2 = (v) => +(+v).toFixed(2);
const r3 = (p) => p?.map((v) => +v.toFixed(3));
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

// vectors and matrices (column-major, as three's)
const sub = (a, c) => a.map((v, i) => v - c[i]);
const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => a.map((v) => v / (len(a) || 1));
const cross = (a, c) => [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
const col = (m, i) => [m[4 * i], m[4 * i + 1], m[4 * i + 2]];
const deg = (r) => n2((r * 180) / Math.PI);

// keys
const KEY = { f: ["f", "KeyF", 70] };
const keyDown = (k) => b.send("Input.dispatchKeyEvent", { type: "keyDown", key: KEY[k][0], code: KEY[k][1], windowsVirtualKeyCode: KEY[k][2], text: k });
const keyUp = (k) => b.send("Input.dispatchKeyEvent", { type: "keyUp", key: KEY[k][0], code: KEY[k][1], windowsVirtualKeyCode: KEY[k][2] });
async function press(k, ms = 60) { await keyDown(k); await sleep(ms); await keyUp(k); await sleep(60); }

/** a page point on whole pixels, where a drag can really drop */
const px = (p) => p && { x: Math.round(p.x), y: Math.round(p.y) };
const towards = ([ax, ay], [bx, by], n = 6) => Array.from({ length: n }, (_, i) => [ax + ((bx - ax) * (i + 1)) / n, ay + ((by - ay) * (i + 1)) / n]);
const ids = async () => Object.keys((await P("doc()")).objects);
/** Drag a part from the bin to a page point (a real HTML drag into the view); the objects it made. */
async function dragPart(part, to) {
  const before = new Set(await ids());
  const from = await P(`item(${JSON.stringify(part)})`);
  const canvas = await P("canvas()");
  const entry = [canvas.x + canvas.w - 40, canvas.y + canvas.h / 2];
  const { seen } = await b.htmlDrag([from.x, from.y], [entry, ...towards(entry, [to.x, to.y], 6)].map(([x, y]) => [Math.round(x), Math.round(y)]), { during: () => P("ring()") });
  await sleep(400);
  const added = (await ids()).filter((id) => !before.has(id));
  return { id: added[0] ?? null, added, ring: seen.at(-1) ?? null };
}

try {
  check("page set up", (await until("window.__ready === true", 30_000)) && (await P("errors")).length === 0, await P("errors"));
  await until("window.__p.bin().includes('sailing.mast')", 10_000);
  const bin = await P("bin()");
  check("editing: the parts bin runs and offers sailing's parts", ["sailing.mast", "sailing.wheel", "sailing.windlass", "sailing.ladder"].every((id) => bin.includes(id)), bin);

  // ─── the hull: camber's, put in the scene and made a ship ────────────────
  // her bow (+X as camber draws her) to the south-east: a beam reach on starboard tack in the north-easterly
  const YAW = -Math.PI / 4;
  const hull = await js(`window.__p.api().addObject(window.__p.hullUrl, { providerId: "camber-hull-surface", transform: { position: [0, 0, 0], rotation: [0, ${YAW}, 0], scale: ${SCALE} } })`);
  await js(`window.__p.change((d) => { d.objects['${hull}'].traits = { "sailing.ship": {} }; })`);
  report.ids = { hull };
  const built = await until(`window.__p.content('${hull}')?.loaded`, 60_000);
  const content = await P(`content('${hull}')`);
  const ship = content?.ship;
  check("camber's scene:source builds her GLB here, and it states her ship: dimensions, displacement, bow +X, up +Y", !!built && ship?.displacement > 0 && JSON.stringify(ship.forward) === "[1,0,0]" && JSON.stringify(ship.up) === "[0,1,0]", content);
  check("she's a Ship with no frame given: the frame is her GLB's to say", JSON.stringify((await P("doc()")).objects[hull].traits) === JSON.stringify({ "sailing.ship": {} }));
  // her body's origin, as sailing reads it from the GLB (body.js glbFrame): midships on her waterline, as camber states it
  const box = content.box;
  check("camber states where her middle is: on her waterline, between her box's ends", Array.isArray(ship?.origin) && ship.origin[1] === 0 && ship.origin[0] > box.min[0] && ship.origin[0] < box.max[0], ship?.origin);
  const ORIGIN = ship?.origin ?? [(box.min[0] + box.max[0]) / 2, 0, (box.min[2] + box.max[2]) / 2];
  const L = box.max[0] - box.min[0];
  /** her body frame in the world from her hull's matrix: origin, starboard, up, aft (bow −Z) */
  const bodyOfHull = (m) => {
    const bow = unit(col(m, 0)), up = unit(col(m, 1)), aft = bow.map((v) => -v);
    return { origin: apply(m, ORIGIN), stbd: cross(up, aft), up, aft, bow };
  };
  const inBody = (body, p) => { const d = sub(p, body.origin); return [dot(d, body.stbd), dot(d, body.up), dot(d, body.aft)]; };

  // looking down at her from over her starboard quarter
  const m0 = await P(`worldOf('${hull}')`);
  const B0 = bodyOfHull(m0);
  const editCam = { position: B0.origin.map((v, i) => v + 9 * B0.stbd[i] + 3 * B0.aft[i] + [0, 10, 0][i]), target: B0.origin.map((v, i) => v + [0, 0.5, 0][i]) };
  await P(`setCam(${JSON.stringify(editCam)})`);
  await sleep(600);
  await shot("0-hull");

  /** the deck under a point of hers (her frame, unscaled): the world point and what it hit */
  const deckUnder = async (local, skip = null) => {
    const m = await P(`worldOf('${hull}')`);
    const w = apply(m, local);
    return P(`down(${JSON.stringify(w)}, ${JSON.stringify(skip ?? [])})`);
  };
  /** her sheer on the starboard side at x (her frame): the outermost point a ray from above still lands on her deck */
  async function sheerAt(x) {
    let last = null;
    for (let z = 0; z <= box.max[2] * 1.02; z += box.max[2] / 40) {
      const h = await deckUnder([x, 0, z]);
      if (h?.id === hull) last = { z, point: h.point };
    }
    return last;
  }

  // ─── rigging her: parts dragged from the bin onto her deck ───────────────
  // where each goes along her (her frame, x from the transom), in the stock sloop's proportions
  const at = (f) => box.min[0] + f * L;
  const where = { wheel: [at(0.14), 0.2, 0], windlass: [at(0.86), 0.2, 0], mast: [at(0.63), 0.2, 0] };
  const parts = {};
  for (const name of ["wheel", "windlass", "ladder", "mast"]) {
    // the deck under her centreline there (her sheer, for the ladder), and the pointer put where the pick finds it
    const spot = name === "ladder" ? (await sheerAt(at(0.48)))?.point : (await deckUnder(where[name]))?.point;
    const local = spot && (await js(`window.__p.dbg.scene().toLocal('${hull}', ${JSON.stringify(spot)})`));
    const aim = local && (await P(`aimLocal('${hull}', ${JSON.stringify(local)})`));
    const target = aim && px(aim);
    const hit = target && (await P(`pickAt(${target.x}, ${target.y})`));
    const r = target ? await dragPart(`sailing.${name}`, target) : { id: null };
    const doc = await P("doc()");
    parts[name] = { id: r.id, added: r.added, hit, ring: r.ring };
    const landed = r.ring?.at?.transform?.position;
    // where it lands is where the pointer's pick hit (the aim: near the spot wanted, as near as her drawn lines let a pointer get)
    check(`${name}: dragged from the bin onto her deck, it goes under her hull where the pointer hit, and is selected`, !!r.id && hit?.id === hull && doc.objects[r.id]?.parent === hull && (await P("selected()")) === r.id && !!landed && !!aim && Math.hypot(...landed.map((v, i) => v - aim.local[i])) < 2e-3 && aim.d < 0.05, { local: r3(local), aimedAt: r3(aim?.local), landed: r3(landed), parent: doc.objects[r.id]?.parent });
  }
  report.ids = { hull, ...Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.id])), rig: await P(`byName("Boom and sail")`), anchor: await P(`byName("Anchor")`) };
  const { mast, wheel, windlass, ladder, rig } = report.ids;
  {
    const d = await P("doc()");
    check("the mast brought its boom and sail, under the mast; the windlass its anchor, under the windlass", d.objects[rig]?.parent === mast && d.objects[report.ids.anchor]?.parent === windlass && d.objects[rig].traits?.["sailing.sail"]?.raised === 1, { rig: d.objects[rig], anchor: d.objects[report.ids.anchor]?.parent });
    check("the parts share the scene's files: one GLB doc per kind (doc.assets)", ["mast", "rig", "wheel", "windlass", "anchor", "ladder"].every((k) => d.assets?.[`sailing/${k}@1`]?.url), Object.keys(d.assets ?? {}));
  }
  await until(`['${mast}', '${rig}', '${wheel}', '${windlass}', '${ladder}'].every((id) => window.__p.content(id)?.loaded)`, 20_000);

  // every part squared to her body (its bow hers, whatever way camber drew her), upright, at its real size, on her deck
  {
    const m = await P(`worldOf('${hull}')`);
    const body = bodyOfHull(m);
    const placed = {};
    for (const name of ["mast", "wheel", "windlass", "ladder"]) {
      const w = await P(`worldOf('${parts[name].id}')`);
      const up = col(w, 1), fwd = col(w, 2).map((v) => -v); // a part's bow is its −Z, as the ship's
      placed[name] = {
        tilt: deg(Math.acos(Math.min(1, dot(unit(up), [0, 1, 0])))),
        scale: n2(len(up)),
        toBow: deg(Math.acos(Math.max(-1, Math.min(1, dot(unit([fwd[0], 0, fwd[2]]), unit([body.bow[0], 0, body.bow[2]])))))),
        inBody: r3(inBody(body, [w[12], w[13], w[14]])),
      };
    }
    // the mast's foot on her deck: a ray from above, past the mast and its sail, lands where the mast stands
    const mw = await P(`worldOf('${mast}')`);
    const below = await js(`(() => { const v = window.__p.dbg.viewport, w = ${JSON.stringify([mw[12], mw[13], mw[14]])}; const h = v.raycast([w[0], w[1] + 30, w[2]], [0, -1, 0], { far: 60, skip: (id) => id === '${mast}' || id === '${rig}' }); return h && { id: h.id, y: h.point[1] }; })()`);
    placed.mast.footOverDeck = below ? n2(mw[13] - below.y) : null;
    report.measured.placed = placed;
    check("the mast stands upright on her deck, at its own size (not her scale), its bow hers", placed.mast.tilt < 1 && Math.abs(placed.mast.scale - 1) < 1e-3 && placed.mast.toBow < 1 && below?.id === hull && Math.abs(placed.mast.footOverDeck) < 0.05, placed.mast);
    check("the wheel, the windlass and the ladder are upright and turned to her bow (the ladder outboard, to starboard)", ["wheel", "windlass"].every((k) => placed[k].tilt < 1 && placed[k].toBow < 1 && Math.abs(placed[k].scale - 1) < 1e-3) && placed.ladder.tilt < 1 && placed.ladder.inBody[0] > 0, placed);
    check("fore and aft as put: the windlass forward of the mast, the wheel aft of it", placed.windlass.inBody[2] < placed.mast.inBody[2] && placed.mast.inBody[2] < placed.wheel.inBody[2], placed);
  }
  await P(`setCam(${JSON.stringify(editCam)})`);
  await sleep(400);
  await shot("1-rigged");
  // and from closer, off her bow, to see the rig stand on her
  {
    const m = await P(`worldOf('${hull}')`);
    const body = bodyOfHull(m);
    await P(`setCam(${JSON.stringify({ position: body.origin.map((v, i) => v + 9 * body.bow[i] + 8 * body.stbd[i] + [0, 6, 0][i]), target: body.origin.map((v, i) => v + [0, 4, 0][i]) })})`);
    await sleep(500);
    await shot("2-rigged-bow");
  }

  // ─── playing: she floats, and sails bow first ────────────────────────────
  await P(`setActivity("play")`);
  check("Play runs sailing, and this view simulates", (await until("window.__p.activity() === 'play' && !!window.__p.ctx() && window.__p.simulating()", 15_000)) === true, await P("running()"));
  check("she's a ship to the sim: helm, sail, anchor and ladder found aboard her", await until(`(() => { const s = window.__p.stations('${hull}'); return s && s.helm === '${wheel}' && s.sail === '${rig}' && s.anchor === '${windlass}' && s.ladder === '${ladder}'; })()`, 5000), await P(`stations('${hull}')`));
  await sleep(2500);
  // float: her body's origin (midships, on her design waterline) against the water under it, frame by frame
  {
    const t = await P(`track('${hull}', ${JSON.stringify(ORIGIN)}, 3000)`);
    const over = t.map((f) => f[2] - f[4]);
    report.measured.float = { overWater: n2(mean(over)), offWater: n2(mean(over.map(Math.abs))), n: t.length, draft: n2(ship.draft * SCALE), freeboard: n2(ship.freeboard * SCALE), mass: Math.round(ship.displacement * SCALE ** 3) };
    check("she floats at her design waterline: her body's y = 0 rides the water under it", t.length > 10 && Math.abs(mean(over)) < 0.25 && mean(over.map(Math.abs)) < 0.35, report.measured.float);
  }
  // under sail: she gathers way on the reach, and her way is along her bow, camber's +X
  {
    const t0 = await P("clock()");
    const got = await until(`(window.__p.read('${hull}')?.speed ?? 0) > 1`, 60_000);
    // settled on the reach: way on, the leeway of getting going gone
    const trace = [];
    for (let i = 0; i < 6; i++) {
      await sleep(2500);
      const q = await P(`read('${hull}')`);
      trace.push([n2((await P("clock()")) - t0), n2(q?.speed ?? 0), deg(q?.heel ?? 0)]);
    }
    report.measured.sailTrace = trace; // [sea s, speed m/s, heel °]
    const rd = await P(`read('${hull}')`);
    const t = await P(`track('${hull}', ${JSON.stringify(ORIGIN)}, 4000)`);
    const a = t[0], z = t.at(-1);
    const travel = [z[1] - a[1], 0, z[3] - a[3]];
    const dt = (z[0] - a[0]) / 1000;
    const bowX = unit([z[5], 0, z[6]]); // the hull's +X in the world, flat (track's m[0], m[2])
    const along = dot(unit(travel), bowX);
    report.measured.sail = { seaSeconds: n2((await P("clock()")) - t0), speed: n2(len(travel) / dt), along: n2(along), leeway: deg(Math.acos(Math.min(1, along))), read: { speed: n2(rd?.speed ?? 0), heel: deg(rd?.heel ?? 0), apparentWind: rd?.apparentWind && { angle: deg(rd.apparentWind.angle), speed: n2(rd.apparentWind.speed) } } };
    check("under the sail the mast brought, she makes way (over 1 m/s)", !!got && len(travel) / dt > 0.8, report.measured.sail);
    check("bow first: her way is along the hull's +X, where camber drew her bow (within 20°)", along > Math.cos((20 * Math.PI) / 180), report.measured.sail);
  }
  // from off her quarter, under sail
  {
    const m = await P(`worldOf('${hull}')`);
    const body = bodyOfHull(m);
    await P(`setCam(${JSON.stringify({ position: body.origin.map((v, i) => v + 26 * body.aft[i] + 17 * body.stbd[i] + [0, 7, 0][i]), target: body.origin.map((v, i) => v + 2 * body.bow[i] + [0, 6, 0][i]) })})`);
    await sleep(300);
    await shot("3-under-sail");
  }

  // ─── aboard: on her deck, and the wheel ──────────────────────────────────
  {
    await b.click(...Object.values(await P("canvasCentre()")));
    check("a click comes aboard: on her deck, playing", await until(`window.__p.me()?.playing === true && window.__p.me()?.on === '${hull}'`, 5000), await P("me()"));
    // stand amidships, to starboard of the mast, looking forward
    const m = await P(`worldOf('${hull}')`);
    const body = bodyOfHull(m);
    const mw = await P(`worldOf('${mast}')`);
    const mastIn = inBody(body, [mw[12], mw[13], mw[14]]);
    await P(`place('${hull}', [${mastIn[0] + 1.2}, ${mastIn[1] + 1}, ${mastIn[2] + 2}], 0.15, -0.1)`);
    await sleep(2000);
    const me = await P("me()");
    const m2 = await P(`worldOf('${hull}')`);
    const b2 = bodyOfHull(m2);
    const feet = b2.origin.map((v, i) => v + me.position[0] * b2.stbd[i] + me.position[1] * b2.up[i] + me.position[2] * b2.aft[i]);
    // the deck under the feet: from just above them, past the rig
    const deck = await P(`down(${JSON.stringify(feet)}, ${JSON.stringify([mast, rig])}, 1)`);
    report.measured.standing = { me, feetWorld: r3(feet), deck: deck && { id: deck.id, y: n2(deck.point[1]) }, overDeck: deck ? n2(feet[1] - deck.point[1]) : null };
    check("she can be stood on: two seconds later, still aboard her, feet on her deck (not fallen through, not in the water)", me.on === hull && !me.swimming && deck?.id === hull && Math.abs(feet[1] - deck.point[1]) < 0.2, report.measured.standing);
    await shot("4-on-deck");

    // the use prompt: just aft of the wheel, looking at it
    const ww = await P(`worldOf('${wheel}')`);
    const wIn = inBody(b2, [ww[12], ww[13], ww[14]]);
    await P(`place('${hull}', [${wIn[0]}, ${wIn[1] - 0.6}, ${wIn[2] + 0.9}], 0, -0.45)`);
    await sleep(600);
    const aim = await P(`aimAt('${wheel}')`);
    if (aim) { await b.move(aim.x, aim.y); await sleep(200); }
    const verbs = await P("verbs()");
    check("at the wheel, the use prompt offers the helm", !!aim && verbs.some((v) => v.command === "helm" && !v.disabled), { aim, verbs, hovered: await P("hovered()"), me: await P("me()") });
    await press("f");
    await sleep(300);
    check("F takes the helm: standing at the wheel", (await P("me()"))?.station === wheel, await P("me()"));
    await shot("5-at-the-helm");
  }

  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("no errors or warnings in the page", errors.length === 0, errors);
} catch (err) {
  check("ran", false, String(err?.stack ?? err));
}
console.log(JSON.stringify(report, null, 2));
b.stop(Object.values(list.checks).every(Boolean) ? 0 : 1);
