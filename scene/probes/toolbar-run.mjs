// The bar of tools (scene.toolbar, EDITOR.md, "The interface", Decisions 10), measured in
// headless Chrome: what toolbar.test.js can only read from the stylesheet.
//
//   pnpm build
//   node probes/toolbar-run.mjs [--port 4710] [--cdp 9710] [--show] [--shots <dir>]
//
// Opens probes/toolbar-probe.html: the BUILT tool on an empty scene whose
// trait runs the page's own extension, with two world commands, a button
// (Play, until playing) and a picker (Seat). Then, wide and narrow:
//  - Look: the bar holds just the world's Play and Seat, no editor command;
//  - every control on the bar, button or picker, is the one control height,
//    and so is an empty cluster;
//  - a real click on Play runs it and doesn't leave the focus on the bar;
//    with Play gone the bar and the canvas haven't moved;
//  - Edit: the editor's commands, then the world's at the same place as in
//    Look; the canvas hasn't moved;
//  - narrow (the editor's cluster overflowing): in Edit the world's controls
//    are still in view at the right end, at the same place as in Look; a
//    real click on Play there runs it.
// Prints a JSON report and exits non-zero if any check fails.
//
// Simulated time: the page's stage runs on its manual clock (window.__time):
// a pause is frames of it (b.rest); waits on conditions (b.waitFor) poll the
// wall, as they wait on loading.
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { browser, checklist } from "./cdp.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const PORT = Number(arg("port", 4710));
const CDP = Number(arg("cdp", 9710));
if ([9222, 9333, 9334].includes(CDP)) throw new Error(`--cdp ${CDP} is reserved`);
const SHOTS = resolve(arg("shots", join(process.env.TMPDIR || tmpdir(), "scene-toolbar-shots")));
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (!existsSync(join(root, "dist/index.js"))) throw new Error("no dist/: run pnpm build first");

const b = await browser({ root, port: PORT, cdp: CDP, page: "/probes/toolbar-probe.html", width: 1200, height: 720, show: !!arg("show", false) });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [] };
const P = (e) => b.js(`window.__p.${e}`);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `toolbar-${name}.png`)));
const same = (a, c, eps = 0.5) => !!a && !!c && ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - c[k]) <= eps);
const ctl = (bar, id) => bar?.controls.find((c) => c.id === id) ?? null;
/** every control and the empty-or-not world cluster are the one control height */
const oneHeight = (bar) => !!bar && bar.control > 0 && bar.controls.every((c) => Math.abs(c.h - bar.control) <= 0.5) && Math.abs(bar.worldRect.h - bar.control) <= 0.5;
// "edit": pick up the editor (a hand, not a body); a body: enter it, the editor put down
const enter = async (id) => {
  const ok = id === "edit" ? await P("edit(true)") : (await P(`enter(${JSON.stringify(id)})`)) !== false && (await P("edit(false)"));
  await b.rest(200);
  return ok && (id === "edit" ? await P("editing()") : (await P("body()")) === id && !(await P("editing()")));
};
const clickOn = async (bar, id) => {
  const c = ctl(bar, id);
  if (c) await b.click(Math.round(c.x + c.w / 2), Math.round(c.y + c.h / 2));
  await b.rest(200);
};

try {
  if (!(await b.waitFor("window.__ready", 30_000))) throw new Error("page never ready");
  if ((await b.js("window.__ready")) !== true) throw new Error(`setup failed: ${JSON.stringify(await P("errors"))}`);
  await b.waitFor("__p.bar() && !__p.bar().hidden && __p.bar().world.length === 2", 20_000);
  await b.rest(300);

  for (const [width, label] of [
    [1100, "wide"],
    [420, "narrow"],
  ]) {
    await P(`width(${width})`);
    await P("unplay()");
    check(`${label}: starts in Look`, await enter("look"), await P("body()"));
    await b.rest(300);
    const look = await P("bar()");
    const lookCanvas = await P("canvas()");
    await shot(`${label}-look`);
    check(`${label}: Look, the bar holds the world's Play and Seat, no editor command`, look && !look.hidden && JSON.stringify(look.world) === '["play","seat"]' && look.tools.length === 0, look);
    check(`${label}: Look, a button and a picker are one control tall, as is the world's cluster`, oneHeight(look) && ctl(look, "seat")?.tag === "SELECT", look?.controls);
    check(`${label}: Look, the world's controls are in view`, look?.controls.every((c) => c.inView), look?.controls);

    // a real click on Play: it runs, it goes, the focus isn't left on the bar, nothing moves
    const ranBefore = (await P("ran")).length;
    await clickOn(look, "play");
    const played = await P("bar()");
    check(`${label}: a click on Play runs it`, (await P("playing()")) && (await P("ran")).length === ranBefore + 1, await P("ran"));
    check(`${label}: the click doesn't leave the focus on the bar`, !(await P("focusInBar()")));
    check(`${label}: with Play gone the bar is still there, the same height, and the canvas hasn't moved`, played && !played.hidden && JSON.stringify(played.world) === '["seat"]' && same(played.rect, look.rect) && same(await P("canvas()"), lookCanvas), { played, look, canvas: await P("canvas()"), lookCanvas });
    await P("unplay()");
    await b.rest(200);

    // Edit: the editor's commands, then the world's, at the same place
    check(`${label}: enters Edit`, await enter("edit"));
    await b.rest(300);
    const edit = await P("bar()");
    await shot(`${label}-edit`);
    check(`${label}: Edit, the editor's commands, then the world's Play and Seat`, edit && !edit.hidden && edit.tools.length >= 3 && JSON.stringify(edit.world) === '["play","seat"]', edit && { tools: edit.tools, world: edit.world });
    check(`${label}: Edit, every control is one control tall (the editor's pickers too)`, oneHeight(edit), edit?.controls.map((c) => [c.id, c.tag, c.h]));
    check(`${label}: Edit, the world's controls are in view, at the same place as in Look`, ["play", "seat"].every((id) => ctl(edit, id)?.inView && same(ctl(edit, id), ctl(look, id))), { edit: edit?.controls.filter((c) => c.inView === false || ["play", "seat"].includes(c.id)), look: look?.controls });
    // (the canvas's top and height: Edit may dock a panel at a side)
    const editCanvas = await P("canvas()");
    check(`${label}: Edit, the bar is where it was in Look, and the canvas's top and height`, same(edit?.rect, look?.rect) && Math.abs(editCanvas.y - lookCanvas.y) <= 0.5 && Math.abs(editCanvas.h - lookCanvas.h) <= 0.5, { bar: edit?.rect, look: look?.rect, editCanvas, lookCanvas });
    if (label === "narrow") check("narrow: Edit, the editor's cluster really overflows (it scrolls)", !!edit?.overflows, edit?.controls.map((c) => [c.id, c.inView]));
    const r0 = (await P("ran")).length;
    await clickOn(edit, "play");
    check(`${label}: Edit, a click on Play runs it`, (await P("ran")).length === r0 + 1 && (await P("playing()")));
  }

  // SwiftShader's WebGL says it lacks an extension; that's the headless browser, not us
  const errors = (await P("errors")).filter((e) => !/KHR_parallel_shader_compile/.test(e));
  check("noErrors", errors.length === 0, errors);
} catch (err) {
  check("ran", false, String(err?.stack ?? err));
}

console.log(JSON.stringify(report, null, 2));
b.stop(Object.values(checks).every(Boolean) ? 0 : 1);
