// A study in a real scene, in headless Chrome: the scene package's BUILT
// tool with this package's BUILT plugins beside it, on the scene's own probe
// page (its editor-probe.html, which registers any package named in
// ?plugins=).
//
//   pnpm build && node probes/scene-run.mjs --with <a checkout holding scene/, built> [--shots dir] [--show]
//
// `--with` defaults to this package's parent folder, where that holds a
// built scene. What a person does, with the pointer: right-click a block,
// Analyse (FEA): a study of it appears beside it and opens, its panel over
// the scene and the part drawn in place; click a face of the part there and
// fix it; Escape puts the study down and the scene draws it again.

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const WITH = resolve(arg("--with") ?? join(PKG, ".."));
if (!existsSync(join(WITH, "scene/dist/index.js"))) throw new Error(`no built scene at ${WITH}/scene: pass --with <a checkout holding scene/, built>`);
if (!existsSync(join(PKG, "dist/index.js"))) throw new Error("build first: pnpm build");
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "fea-shots"));
mkdirSync(SHOTS, { recursive: true });

const b = await browser({ root: WITH, port: Number(process.env.PROBE_PORT) || 4798, cdp: Number(process.env.PROBE_CDP) || 9798, page: "/scene/probes/editor-probe.html?plugins=/fea/dist/index.js", width: 1440, height: 760, show: process.argv.includes("--show"), timeout: 300_000, mounts: { "/fea/": PKG } });
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [] };
const P = (e) => b.js(`window.__p.${e}`);
const A = (e) => b.js(`(() => { const p = window.__p, d = p.A; return (${e}); })()`);
// the scene's views run on the page's manual clock: nothing in them moves until it is stepped
const frames = async (n) => {
  for (let i = 0; i < n; i++) await b.js("window.__time.step(1)");
};
/** Step the scene until `expr` holds, for up to `ms` of wall time (things here also load, which the wall paces). */
async function until(expr, ms = 15_000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    let v = false;
    try {
      v = await b.js(expr);
    } catch {
      v = false;
    }
    if (v) return v;
    await frames(2);
    await sleep(30);
  }
  return false;
}
const shot = async (name) => {
  await frames(4);
  report.shots.push(await b.shot(join(SHOTS, `scene-${name}.png`)));
};
const inspect = () => A(`d.view.plugins.instanceOf("fea-scene-edit")?.inspect() ?? null`);
/** The middle of a menu item, by its label. */
const menuItem = (label) =>
  A(`(() => { const e = [...p.hostA.querySelectorAll('.context-menu .menu-item')].find((x) => x.querySelector('.menu-label')?.textContent.trim() === ${JSON.stringify(label)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);

try {
  if (!(await b.waitFor("window.__ready", 30_000))) throw new Error("page never ready");
  if ((await b.js("window.__ready")) !== true) throw new Error(`setup failed: ${JSON.stringify(await P("errors"))}`);
  check("the scene loads its content", !!(await until("__p.loaded()", 30_000)));
  await frames(30);
  check("this package's view plugin runs in the scene", !!(await until(`!!__p.A.view.plugins.instanceOf("fea-scene-edit")`, 10_000)));

  // ---- Analyse, from the block's menu
  const at = await P(`screen("b2", [0, 0.016, 0])`);
  await b.click(at.x, at.y, { button: "right" });
  await frames(6);
  const items = await A(`p.text('.context-menu .menu-item .menu-label')`);
  check("a block's menu offers Analyse (FEA)", items.includes("Analyse (FEA)"), items);
  const m = await menuItem("Analyse (FEA)");
  await b.click(m.x, m.y);
  const opened = await until(`__p.A.view.plugins.instanceOf("fea-scene-edit")?.inspect().panel?.part?.faces === 6`, 20_000);
  const state = await inspect();
  check("a study of the block is made and opened: its part read as six faces", !!opened && !!state.open && state.showing === "part", state);
  const doc = await P("doc()");
  const study = doc.objects[state.open];
  report.object = study;
  const block = doc.objects.b2;
  check(
    "the study stands in the scene beside the block: the same parent, moved its width along x",
    study?.providerId === "fea-results" && (study.parent ?? null) === (block.parent ?? null) && Math.abs(study.transform.position[0] - block.transform.position[0] - 0.05 * 1.15) < 1e-6 && study.transform.position[2] === block.transform.position[2],
    study,
  );
  const studyDoc = await b.js(`(() => { const d = window.repo.handles.get(${JSON.stringify(study.sourceUrl)}).doc(); return { type: d["@patchwork"].type, title: d.title, part: d.part && { title: d.part.title, how: d.part.how, kept: !!d.part.kept } }; })()`);
  check("the study is a document of its own, named for the block, its part the block's geometry", studyDoc.type === "fea-study" && /Block 3 · FEA/.test(studyDoc.title) && studyDoc.part?.kept === true, studyDoc);
  const hands = await A(`d.local.get().hands.map((h) => h.kind)`);
  check("opening it put a hand on the scene's stack, over Edit", hands.includes("fea") && hands.includes("edit"), hands);
  check("its panel lies over the scene", await A(`!!p.hostA.querySelector('.fea.hosted .panel section[data-s="supports"]')`));
  check("the scene's own drawing of the study is hidden from this viewer while it is open", (await A(`d.displayed().get(${JSON.stringify(state.open)})?.hidden`)) === true, await A(`d.displayed().get(${JSON.stringify(state.open)}) ?? null`));
  await shot("1-open");

  // ---- pick a face of the part where it stands, and fix it
  const top = await b.js(`(() => {
    const p = window.__p, d = p.A, id = ${JSON.stringify(state.open)};
    const kept = window.repo.handles.get(window.repo.handles.get(d.scene().objects[id].sourceUrl).doc().part.kept).doc();
    const f = kept.faces.find((x) => x.normal[1] > 0.9);
    const m = d.viewport.worldOf(id), c = f.centroid;
    const w = [m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12], m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13], m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14]];
    return { face: f.id, at: p.worldScreen(w) };
  })()`);
  await b.move(top.at.x, top.at.y);
  await frames(4);
  await b.click(top.at.x, top.at.y);
  await frames(6);
  const picked = await inspect();
  check("a click on the part, in the scene, picks the face under it", picked.panel?.picked === top.face, { picked: picked.panel, top });
  await b.js(`window.__p.hostA.querySelector('.fea.hosted [data-act="fix-picked"]')?.click()`);
  await frames(6);
  const supports = await b.js(`Object.values(window.repo.handles.get(${JSON.stringify(study.sourceUrl)}).doc().setup.supports).map((s) => ({ kind: s.kind, faces: [...s.faces] }))`);
  check("Fix it, in the panel over the scene, writes the support to the study", supports.length === 1 && supports[0].faces.join() === String(top.face), supports);
  await shot("2-fixed");

  // ---- Escape puts it down
  const canvas = await P(`rect('canvas')`);
  await b.click(canvas.x + canvas.w - 40, canvas.y + 40);
  await frames(4);
  await b.key("Escape");
  await frames(6);
  let after = await inspect();
  if (after.open) {
    // (the first Escape may have had a selection to put down first: the ladder's own rung)
    await b.key("Escape");
    await frames(6);
    after = await inspect();
  }
  check("Escape puts the study down: the panel goes", after.open === null && !(await A(`!!p.hostA.querySelector('.fea.hosted')`)), after);
  check("and the scene draws the study itself again", !(await A(`d.displayed().get(${JSON.stringify(state.open)})?.hidden`)));
  const built = await until(`__p.A.viewport.contentOf(${JSON.stringify(state.open)})?.loaded === true`, 20_000);
  check("the scene builds the study's own GLB (the part, with its support marked)", !!built, await A(`d.local.get().status?.[${JSON.stringify(state.open)}] ?? null`));
  await shot("3-closed");
  const errors = (await P("errors")).filter((e) => !/^warn: THREE\.|Multiple instances of Three/.test(e));
  check("no errors on the page", errors.length === 0, errors);
  const logged = b.logs.filter((l) => /^(error|exception):/.test(l));
  check("nothing logged an error", logged.length === 0, logged);
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}
report.logs = b.logs?.slice?.(-20);
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
