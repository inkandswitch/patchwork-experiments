// The parts bin (scene.parts), driven with a real mouse in headless Chrome.
//
//   pnpm build
//   node probes/parts-run.mjs [--port 4700] [--cdp 9700] [--show] [--shots <dir>]
//
// Opens probes/parts-probe.html: the BUILT tool editing a scene with one
// hull (turned a quarter, off the origin, with a connector tagged "mast" and a snap radius)
// and two parts registered by the page: a crate (no tags) and a mast (tags
// ["mast"]). Then, with real CDP drags (the bin's own HTML drag, intercepted
// and played at real coordinates): the bin shows both parts, by category,
// last in the sidebar; a crate dragged onto the hull goes under it, at the
// drop point in its frame, with the ring there while dragging; the mast
// dragged onto the hull away from its step, within its reach, snaps to the
// step (the ring says snapped), and with Alt doesn't; a crate dropped on open ground goes under nothing; a click on
// the crate puts one where the view is looking; every placement is
// selected; the three crates share one file doc (doc.assets), made once.
// Prints a JSON report and exits non-zero if any check fails.
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { browser, checklist, sleep } from "./cdp.mjs";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? fallback : argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true;
};
const PORT = Number(arg("port", 4700));
const CDP = Number(arg("cdp", 9700));
if ([9222, 9333, 9334].includes(CDP)) throw new Error(`--cdp ${CDP} is reserved`);
const SHOTS = resolve(arg("shots", join(process.env.TMPDIR || tmpdir(), "scene-parts-shots")));
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (!existsSync(join(root, "dist/index.js"))) throw new Error("no dist/: run pnpm build first");

const b = await browser({ root, port: PORT, cdp: CDP, page: "/probes/parts-probe.html", width: 1200, height: 760, show: !!arg("show", false) });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [] };
const P = (e) => b.js(`window.__p.${e}`);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `parts-${name}.png`)));
const near = (a, c, eps = 1e-3) => Array.isArray(a) && Array.isArray(c) && a.length === c.length && a.every((v, i) => Math.abs(v - c[i]) <= eps);
const round = (v, n = 4) => (Array.isArray(v) ? v.map((x) => round(x, n)) : typeof v === "number" ? Number(v.toFixed(n)) : v);
/** a page point on whole pixels, where a drag can really drop */
const px = (p) => p && { x: Math.round(p.x), y: Math.round(p.y) };
/** a few steps from a to b */
const towards = ([ax, ay], [bx, by], n = 6) => Array.from({ length: n }, (_, i) => [ax + ((bx - ax) * (i + 1)) / n, ay + ((by - ay) * (i + 1)) / n]);
const ids = async () => Object.keys((await P("doc()")).objects);
/** drag a part from the bin to a page point; returns the new object's id and what the ring showed on the last step */
async function dragPart(part, to, { mods = 0 } = {}) {
  const before = new Set(await ids());
  const from = await P(`item(${JSON.stringify(part)})`);
  const canvas = await P("canvas()");
  const entry = [canvas.x + canvas.w - 40, canvas.y + canvas.h / 2];
  const { seen, types } = await b.htmlDrag([from.x, from.y], [entry, ...towards(entry, [to.x, to.y], 6)].map(([x, y]) => [Math.round(x), Math.round(y)]), { mods, during: () => P("ring()") });
  await sleep(300);
  const added = (await ids()).filter((id) => !before.has(id));
  return { id: added[0] ?? null, added, ring: seen.at(-1), types };
}

try {
  if (!(await b.waitFor("window.__ready", 30_000))) throw new Error("page never ready");
  if ((await b.js("window.__ready")) !== true) throw new Error(`setup failed: ${JSON.stringify(await P("errors"))}`);
  check("hullLoaded", await b.waitFor("__p.loaded()", 20_000));
  await sleep(500);
  await shot("0-open");

  // ── the bin ───────────────────────────────────────────────────────────────
  {
    const panel = await P("panel()");
    const order = await P("sidebar()");
    check("binListsParts", panel && !panel.hidden && JSON.stringify(panel.parts) === JSON.stringify(["Crate", "Mast"]) && JSON.stringify(panel.categories) === JSON.stringify(["Probe", "Rig"]), panel);
    check("binLastInSidebar", order.at(-1) === "parts", order);
  }

  // ── a crate dragged onto the hull: under it, at the drop point ────────────
  {
    // on deck, aft of centre and to one side (hull frame), well clear of the mast step
    const to = px(await P(`onHull([0.2, 0.4, 0.9])`));
    const hit = await P(`pickAt(${to.x}, ${to.y})`);
    const r = await dragPart("probe.crate", to);
    const o = r.id ? (await P("doc()")).objects[r.id] : null;
    const want = hit?.id === "hull" ? await P(`toLocal("hull", ${JSON.stringify(hit.point)})`) : null;
    check("crateAttachesToHull", o?.parent === "hull" && hit?.id === "hull", { hit, parent: o?.parent, dragTypes: r.types });
    check("crateAtDropPoint", want && near(o?.transform?.position, want, 2e-3), { want: round(want), got: round(o?.transform?.position) });
    // upright in the world, turned the hull's way: no turn in its frame
    check("crateUprightAlongHull", near(o?.transform?.rotation, [0, 0, 0], 1e-6) && Math.abs((o?.transform?.scale ?? 0) - 1) < 1e-9, o?.transform);
    check("ringShownWhileDragging", r.ring && r.ring.at.parent === "hull" && !r.ring.snapped, r.ring);
    check("ringGoneAfterDrop", (await P("ring()")) === null);
    check("crateSelected", (await P("selected()")) === r.id);
    report.crate = r.id;
    await shot("1-crate");
  }

  // ── the mast dragged onto the hull, away from its step but within reach: snaps to it
  {
    const to = px(await P(`onHull([-0.25, 0.4, 0.6])`));
    const r = await dragPart("probe.mast", to);
    const o = r.id ? (await P("doc()")).objects[r.id] : null;
    const step = await P("MAST_STEP");
    check("mastSnapsToStep", o?.parent === "hull" && near(o?.transform?.position, step, 1e-6), { parent: o?.parent, got: round(o?.transform?.position), step });
    check("ringSaysSnapped", r.ring?.snapped === true, r.ring);
    check("mastSelected", (await P("selected()")) === r.id);
    // Alt: where it was dropped, no snap
    const free = await dragPart("probe.mast", to, { mods: ["alt"] });
    const f = free.id ? (await P("doc()")).objects[free.id] : null;
    check("altPlacesFreely", f?.parent === "hull" && !near(f?.transform?.position, step, 0.05) && free.ring?.snapped === false, { got: round(f?.transform?.position), ring: free.ring });
    await shot("2-mast");
  }

  // ── a crate on open ground: under nothing ─────────────────────────────────
  {
    const to = px(await P(`world([-1.4, 0, 1.2])`));
    const hit = await P(`pickAt(${to.x}, ${to.y})`);
    const r = await dragPart("probe.crate", to);
    const o = r.id ? (await P("doc()")).objects[r.id] : null;
    check("groundDropUnattached", o && o.parent == null && hit?.id == null && near(o.transform.position, hit?.point, 2e-3), { hit, got: round(o?.transform?.position) });
    report.groundCrate = r.id;
  }

  // ── a click: where the view is looking ────────────────────────────────────
  {
    const before = new Set(await ids());
    const c = await P("canvas()");
    const centre = await P(`pickAt(${c.x + c.w / 2}, ${c.y + c.h / 2})`);
    const item = await P(`item("probe.crate")`);
    await b.click(item.x, item.y);
    await sleep(400);
    const added = (await ids()).filter((id) => !before.has(id));
    const o = added[0] ? (await P("doc()")).objects[added[0]] : null;
    const want = centre?.id ? await P(`toLocal(${JSON.stringify(centre.id)}, ${JSON.stringify(centre.point)})`) : centre?.point;
    check("clickPlacesAtViewTarget", added.length === 1 && (o?.parent ?? null) === (centre?.id ?? null) && near(o?.transform?.position, want, 2e-3), { centre, parent: o?.parent, got: round(o?.transform?.position), want: round(want) });
    check("clickSelects", (await P("selected()")) === added[0]);
    report.clickCrate = added[0];
    await shot("3-click");
  }

  // ── one file per part ─────────────────────────────────────────────────────
  {
    const d = await P("doc()");
    const crates = Object.values(d.objects).filter((o) => o.name === "Crate");
    const masts = Object.values(d.objects).filter((o) => o.name === "Mast");
    const made = await P("made");
    const files = await P("files()");
    const crateUrl = d.assets?.["probe/crate@1"]?.url;
    check(
      "partsShareOneFile",
      crates.length === 3 && crates.every((o) => o.sourceUrl === crateUrl) && masts.length === 2 && masts.every((o) => o.sourceUrl === d.assets?.["probe/mast@1"]?.url) && made.crate === 1 && made.mast === 1 && files.length === 2,
      { assets: d.assets, made, files, crates: crates.map((o) => o.sourceUrl) },
    );
    check("hintWritten", crates.every((o) => o.hint?.bounds), crates.map((o) => o.hint));
  }

  // SwiftShader's WebGL says it lacks an extension; that's the headless browser, not us
  const errors = (await P("errors")).filter((e) => !/KHR_parallel_shader_compile/.test(e));
  check("noErrors", errors.length === 0, errors);
} catch (err) {
  check("ran", false, String(err?.stack ?? err));
}

console.log(JSON.stringify(report, null, 2));
b.stop(Object.values(checks).every(Boolean) ? 0 : 1);
