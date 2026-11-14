// Pins and mirrors (scene/COMPOSITION.md §7: worked example 2, and a part
// repeated live), in one headless Chrome, one page, one repo
// (pins-probe.html): the BUILT scene, sailing, joints and traversal plugins.
// S is a sloop at anchor whose companionway is a fit-out F, linked and fixed
// at a version (the inspector's Fix at this version); and a hatch W that
// closes itself, linked live twice on her cabin top.
//
//   (in scene/, sailing/, joints/, traversal/) pnpm build
//   node probes/pins-run.mjs [--shots <dir>] [--show] [--seed 1] [--port 4793] [--cdp 9793]
//
// It checks:
//  1. the docs: S holds the hull and the rig, none of F's or W's pieces, a
//     link to F fixed at F's heads with the docs reached through it (F's
//     files) in its deps, and two live links to the same W;
//  2. S's view opens a stage for each: F pinned, W acting at the first link
//     and a mirror at the second; each runs its doc's extensions (joints);
//     every linked object is drawn;
//  3. F changed live, in a view of its own (its hatch opened by its verb):
//     F alone shows it open; S's pinned F still shows it shut, as fixed, and
//     nothing wrote through the pin;
//  4. looking at the pinned F's hatch in S, the prompt offers nothing and F
//     does nothing: a pin is drawn, never acted on;
//  5. W: looking at the acting hatch S offers Open (W's verb, from W's
//     stage) and F opens it; the mirrored hatch shows it opening and open,
//     at its own placement; looking at the mirror, nothing is offered;
//  6. W's clock is computed by the acting stage alone: the mirror never
//     computes; two seconds on, the hatch closes itself in both copies;
//  7. every write tried through the pinned and the mirrored stage is
//     refused, and nothing throws;
//  8. Follow latest makes F live (acting: its hatch open, as F is now); Fix
//     at this version pins it again at F's heads now;
//  9. with her world running, the fit-out and both hatches ride the hull
//     exactly;
// 10. no page errors.
// Prints a JSON checklist; exits non-zero if any check fails.
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(PKG, "..");
for (const p of ["scene", "sailing", "water", "joints", "traversal"]) if (!existsSync(join(ROOT, p, "dist/index.js"))) throw new Error(`no ${p}/dist: build it first`);
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || "/tmp", "pins-probe"));
const PORT = Number(arg("--port") ?? 4793);
const b = await browser({ root: ROOT, port: PORT, cdp: Number(arg("--cdp") ?? PORT + 5000), page: `/sailing/probes/pins-probe.html?seed=${Number(arg("--seed") ?? 1)}`, width: 1700, height: 570, show: process.argv.includes("--show"), timeout: 900_000 });
const js = (expr, ms = 60_000) => Promise.race([b.js(expr), sleep(ms).then(() => { throw new Error(`no answer in ${ms} ms: ${expr.slice(0, 160)}`); })]);
const P = (e, ms) => js(`window.__p.${e}`, ms);
const FRAME = 1000 / 60;
const until = (expr, ms = 10_000) => b.soon(`window.__p.${expr}`, { frames: Math.ceil(ms / FRAME) });
const loads = (expr, ms = 30_000) => b.waitFor(`window.__p.${expr}`, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [], numbers: {} };
const J = JSON.stringify;
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `pins-${name}.png`)));
const EXPECTED = /KHR_parallel_shader_compile|GPU stall due to ReadPixels|pointer ?lock/i;
const near = (a, b, e = 1e-4) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < e);

/** Put view s's pointer over object `id` of the stage at `path` until it hovers it; → the prompt there. */
async function lookAt(path, id, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const at = await until(`aimAt(${J(path)}, ${J(id)})`, 3000);
    if (!at) continue;
    await b.move(at.x + 1, at.y);
    await b.move(at.x, at.y);
    if (await until(`hoveredIs(${J([...path, id])})`, 1500)) return P("prompt()");
  }
  return null;
}

try {
  if (!(await loads("errors !== undefined", 60_000))) throw new Error("the page never got ready");
  const ready = await js("window.__ready");
  if (ready !== true) throw new Error(`page failed: ${J(await P("errors"))}`);

  // 1. the docs
  const ids = await P("build()", 300_000);
  check("1. W, F and S are made by the tools (parts, the start screen, the inspector)", ids && !ids.error && ids.fixed === true, ids);
  const shape = await P("shape()");
  report.numbers.shape = shape;
  const fit = shape.links.find((l) => l.id === ids.fitout);
  const hatches = shape.links.filter((l) => l.id === ids.acting || l.id === ids.mirror);
  check("1. S holds the hull and the rig and none of F's or W's pieces (her own companionway out)", shape.hull && shape.rig && shape.boatSlides === 0 && shape.boatExits === 0, shape);
  check("1. S's link to F is fixed at F's heads then, its deps the docs reached through it (F's files)", fit && fit.url === ids.f && fit.at?.heads.length > 0 && shape.fAssets.length > 0 && shape.fAssets.every((u) => fit.at.deps.includes(u)), { fit, fAssets: shape.fAssets });
  check("1. S links the same W live twice", hatches.length === 2 && hatches.every((l) => l.url === ids.w && !l.at), hatches);

  // 2. the stages
  const st = await P("stages()");
  report.numbers.stages = st;
  const roleAt = (id) => st.find((x) => J(x.path) === J([id]));
  check("2. F's stage is pinned; W acts at the first link and is a mirror at the second", roleAt(ids.fitout)?.role === "pinned" && roleAt(ids.acting)?.role === "acting" && roleAt(ids.mirror)?.role === "mirror" && roleAt(ids.acting).url === ids.w && roleAt(ids.mirror).url === ids.w, st.map((x) => [x.path, x.role]));
  check("2. each runs its doc's extensions (joints), the pin and the mirror too", [ids.fitout, ids.acting, ids.mirror].every((id) => roleAt(id)?.running.includes("joints")), st.map((x) => [x.path, x.running]));
  const links = await P("links()");
  check("2. S's links say so: the fit-out pinned, the hatches acting and mirror, all open (drawn as their docs)", links.fitout?.role === "pinned" && links.acting?.role === "acting" && links.mirror?.role === "mirror" && Object.values(links).every((l) => l.open), links);
  check("2. every linked object is drawn", await loads("loaded().loaded === __p.loaded().total", 120_000), await P("loaded()"));
  await P("frame()");
  await b.step(2);
  await shot("made");

  // 3. F changed live, in its own view
  const pinBefore = await P(`localIn([${J(ids.fitout)}], ${J(ids.fHatch)})`);
  check("3. F alone opens its hatch by its verb", (await P("openF()")) === true && (await until("slideOf('f')?.at === 'open'", 6000)), await P("slideOf('f')"));
  await b.step(30);
  const pinned = await P("pinnedSlide()");
  const pinAfter = await P(`localIn([${J(ids.fitout)}], ${J(ids.fHatch)})`);
  check("3. S's pinned F still shows its hatch shut, where it was: as fixed", pinned?.at === "closed" && near(pinBefore, pinAfter), { pinned, pinBefore, pinAfter });
  check("3. nothing wrote through the pin", (await P("writes")).pin === 0, await P("writes"));

  // 4. looking at the pinned hatch
  await P("focus()");
  const pinPrompt = await lookAt([ids.fitout], ids.fHatch);
  check("4. looking at the pinned F's hatch, S offers nothing of F's", pinPrompt !== null && !pinPrompt.some((t) => /Open|Close/.test(t)), { prompt: pinPrompt, hovered: await P("hovered()") });
  await b.key("f");
  await b.step(30);
  check("4. F there does nothing: F stays open live, the pin shut", (await P("slideOf('f')"))?.at === "open" && (await P("pinnedSlide()"))?.at === "closed", { live: await P("slideOf('f')"), pinned: await P("pinnedSlide()") });

  // 5. the hatch, acting and mirrored
  const closedLocal = await P(`localIn([${J(ids.mirror)}], ${J(ids.wHatch)})`);
  const actPrompt = await lookAt([ids.acting], ids.wHatch);
  check("5. looking at the acting hatch, S offers W's Open", !!actPrompt?.some((t) => /^Open/.test(t)), { prompt: actPrompt });
  await b.key("f");
  const opened = await until("slideOf('w')?.at === 'open'", 4000);
  const openActing = await P(`localIn([${J(ids.acting)}], ${J(ids.wHatch)})`);
  const openMirror = await P(`localIn([${J(ids.mirror)}], ${J(ids.wHatch)})`);
  check("5. F opens it; the mirrored hatch shows it open, at its own placement, exactly as the acting one", opened && !near(openMirror, closedLocal, 0.05) && near(openActing, openMirror), { opened, closedLocal, openActing, openMirror });
  await shot("hatch-open");
  const mirPrompt = await lookAt([ids.mirror], ids.wHatch);
  check("5. looking at the mirrored hatch, S offers nothing of W's", mirPrompt !== null && !mirPrompt.some((t) => /Open|Close/.test(t)), { prompt: mirPrompt });
  check("5. no body and no command comes from the pin or the mirror", !(await P("bodies()")).some((x) => x.stage === ids.fitout || x.stage === ids.mirror) && !(await P("commandStages()")).some((x) => x === ids.fitout || x === ids.mirror), { bodies: await P("bodies()") });

  // 6. W's clock
  const comp = await P("computing()");
  check("6. W's clock is computed by S's acting W stage, never the mirror", comp.acting === true && comp.mirror === false && comp.claim?.session === comp.session, comp);
  const shut = await until("slideOf('w')?.at === 'closed'", 6000);
  await b.step(30);
  const shutActing = await P(`localIn([${J(ids.acting)}], ${J(ids.wHatch)})`);
  const shutMirror = await P(`localIn([${J(ids.mirror)}], ${J(ids.wHatch)})`);
  check("6. two seconds on, the hatch closes itself, in both copies", shut && near(shutActing, closedLocal) && near(shutMirror, closedLocal), { shut, shutActing, shutMirror, closedLocal });

  // 7. writes through the drawn stages
  const tried = await P("tryWrites()");
  check("7. every write tried through the pin and the mirror is refused, quietly", ["pinned", "mirror"].every((k) => tried[k].change === "quiet" && tried[k].claim === null && tried[k].hold === false && tried[k].run === false && tried[k].writable === false) && tried.pinned.role === "pinned" && tried.mirror.role === "mirror" && !tried.pinned.hasRole && !tried.mirror.hasRole, tried);
  check("7. and none of it reached a doc", (await P("writes")).pin === 0 && (await P("slideOf('f')"))?.at === "open" && (await P("pinnedSlide()"))?.at === "closed", await P("writes"));

  // 8. Follow latest, Fix at this version
  check("8. Follow latest", (await P("version('follow-latest')")) === true && (await until(`stage(${J(ids.fitout)})?.role === 'acting' && __p.stage(${J(ids.fitout)}).running.includes('joints')`, 4000)), await P(`stage(${J(ids.fitout)})`));
  await b.step(30);
  const liveLocal = await P(`localIn([${J(ids.fitout)}], ${J(ids.fHatch)})`);
  check("8. the fit-out is F as it is now: its hatch open", (await P("link(__p.ids.fitout)")).role === "acting" && !near(liveLocal, pinBefore, 0.05), { liveLocal, pinBefore });
  const point = await P("fixPoint()");
  check("8. Fix at this version", (await P("version('fix-version')")) === true && (await until(`stage(${J(ids.fitout)})?.role === 'pinned'`, 4000)), await P(`stage(${J(ids.fitout)})`));
  const refit = (await P("shape()")).links.find((l) => l.id === ids.fitout);
  check("8. pinned at F's heads now, the files it reached in its deps; its hatch shown open, as F is", J(refit?.at?.heads) === J(point?.heads) && J(point?.heads) === J(await P("fHeads()")) && shape.fAssets.every((u) => refit.at.deps.includes(u)) && (await P("pinnedSlide()"))?.at === "open", { refit, point });

  // 9. riding
  await P("resume()");
  const ride = await P("sampleRide(4000)", 120_000);
  report.numbers.ride = ride;
  check("9. with her world running the fit-out and both hatches ride the hull exactly", ride.moved > 1e-3 && ride.off < 1e-6, ride);
  await shot("riding");

  // 10.
  const errors = (await P("errors")).filter((e) => !EXPECTED.test(e));
  check("10. no page errors", errors.length === 0, errors.slice(0, 10));
} catch (err) {
  check(`ran to the end: ${err?.message ?? err}`, false, String(err?.stack ?? err));
}
report.frames = await js("window.__time?.frames() ?? null").catch(() => null);
console.log(JSON.stringify(report, null, 1));
b.stop(list.failed ? 1 : 0);
