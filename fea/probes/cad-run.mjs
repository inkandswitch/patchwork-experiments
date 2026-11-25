// A CAD model as a part, end to end: an OpenSCAD document, read through the
// OpenSCAD package's own BUILT geometry reader (its `scene:source`, which
// runs its engine in a worker), linked in the study tool in headless Chrome;
// then the part the study kept, meshed and solved by the real gmsh and
// CalculiX.
//
//   pnpm build && node probes/cad-run.mjs --with <a checkout holding openscad/, built> [--shots dir] [--show]
//
// `--with` defaults to this package's parent folder. The model is an angle
// bracket with a bolt hole in each leg. Checks: it is read at its real size
// (millimetres, turned y-up), split into its ten faces with both holes
// round; changing the model is noticed, and reading it again keeps the
// support on the face that is still alike; the kept part meshes on its own
// faces and solves, the loaded leg bending the way it is pushed.

import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { browser, checklist, sleep } from "./cdp.mjs";
import { localRun } from "./lib.mjs";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const WITH = resolve(arg("--with") ?? join(PKG, ".."));
if (!existsSync(join(WITH, "openscad/dist/index.js"))) throw new Error(`no built openscad at ${WITH}/openscad: pass --with <a checkout holding openscad/, built>`);
if (!existsSync(join(PKG, "dist/index.js"))) throw new Error("build first: pnpm build");
const SHOTS = resolve(arg("--shots") ?? join(process.env.TMPDIR || tmpdir(), "fea-shots"));
mkdirSync(SHOTS, { recursive: true });

const bracket = (hole) => `// an angle bracket: a base and an upright, a bolt hole in each
difference() {
  union() { cube([60, 40, 6]); cube([6, 40, 50]); }
  translate([40, 20, -1]) cylinder(h = 8, r = ${hole}, $fn = 48);
  translate([-1, 20, 35]) rotate([0, 90, 0]) cylinder(h = 8, r = ${hole}, $fn = 48);
}
`;

const b = await browser({ root: PKG, port: Number(process.env.PROBE_PORT) || 4799, cdp: Number(process.env.PROBE_CDP) || 9799, page: "/probes/ui-probe.html?plugins=/openscad/dist/index.js", width: 1300, height: 900, show: process.argv.includes("--show"), timeout: 300_000, mounts: { "/openscad/": join(WITH, "openscad") } });
const P = (e) => b.js(`window.__p.${e}`);
const until = (expr, ms = 20_000) => b.waitFor(expr, ms, 60);
const list = checklist();
const { check } = list;
const report = { checks: list.checks, details: list.details, shots: [] };
let kept = null;

try {
  check("page set up, with OpenSCAD's plugins beside this package's", (await until("window.__ready === true", 20_000)) && (await P("errors")).length === 0, await P("errors"));
  await P("setup()");
  const scad = await P(`add(${JSON.stringify({ "@patchwork": { type: "openscad" }, title: "Bracket", source: bracket(5) })})`);
  await until(`!!document.querySelector(".fea .part-url")`);
  await P(`type(".fea .part-url", ${JSON.stringify(scad)})`);
  const read = await until("window.__p.panel().part?.faces > 0", 90_000);
  const doc = await P("doc()");
  const figures = await P(`rows('section[data-s="part"] table.figures tr')`);
  const faces = await P("faces()");
  report.part = { figures, how: doc.part?.how, faces: faces.map((f) => [f.id, f.flat, f.radius && Number((f.radius * 1000).toFixed(2))]) };
  check("the OpenSCAD model is read by OpenSCAD's own reader", !!read && /built by OpenSCAD model/.test(doc.part?.how ?? ""), doc.part);
  check("at its real size: 60 × 50 × 40 mm, the model's z turned up", /60 × 50 × 40 mm/.test(figures.find((r) => r[0] === "Size")?.[1] ?? ""), figures);
  const round = faces.filter((f) => f.radius);
  check("split into its ten faces, both bolt holes round, 5 mm", faces.length === 10 && round.length === 2 && round.every((f) => Math.abs(f.radius - 0.005) < 1e-4), report.part.faces);
  check("a closed solid", (await P("panel()")).part.solid === true);
  // hold it by the base's underside, as bolted down
  const under = faces.find((f) => f.flat && f.normal[1] < -0.9);
  await b.js(`(() => { const p = window.__p; p.change(${JSON.stringify(`d.setup.supports.base = { name: "Bolted down", kind: "fixed", faces: [${under.id}] }`)}); })()`);
  await P(`look([-0.5, -0.45, -0.75])`);
  await sleep(400);
  report.shots.push(await b.shot(join(SHOTS, "cad-1-bracket.png")));
  kept = await P("kept()");

  // ---- the model changes
  await P(`changeDoc(${JSON.stringify(scad)}, ${JSON.stringify(`d.source = ${JSON.stringify(bracket(3))}`)})`);
  await P("reopen()");
  const noticed = await until(`/has changed since it was read/.test(document.querySelector('section[data-s="part"]')?.innerText ?? "")`, 20_000);
  check("a change to the model is noticed when the study is next opened", !!noticed, await P(`text('section[data-s="part"]')`));
  await P(`click('[data-act="reread"]')`);
  await until(`window.__p.faces().some((f) => f.radius && Math.abs(f.radius - 0.003) < 1e-4)`, 90_000);
  const again = await P("faces()");
  const support = Object.values((await P("doc()")).setup.supports)[0];
  const underNow = again.find((f) => f.flat && f.normal[1] < -0.9);
  check("read again: the holes are 3 mm, and the support is still on the base's underside", again.filter((f) => f.radius).length === 2 && support.faces.length === 1 && support.faces[0] === underNow.id, { support, underNow });
  check("no errors on the page", (await P("errors")).length === 0, await P("errors"));
} catch (err) {
  check("probe ran", false, String(err?.stack ?? err));
}

// ---- the kept part, through the real mesher and solver
if (kept) {
  const revive = (v) => (v && typeof v === "object" && typeof v.$bytes === "string" ? Uint8Array.from(Buffer.from(v.$bytes, "base64")) : Array.isArray(v) ? v.map(revive) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)])) : v);
  try {
    const r = await localRun({
      title: "bracket",
      kept: revive(kept),
      setup: (part) => {
        const under = part.faces.find((f) => f.flat && f.normal[1] < -0.9).id;
        // the upright's outer face: pushed along +x, as a load hung off its bolt would pull it over
        const outer = [...part.faces].filter((f) => f.flat && f.normal[0] < -0.9).sort((a, c) => c.area - a.area)[0].id;
        return {
          mesh: { size: "medium", order: 2 },
          supports: { a: { name: "Bolted down", kind: "fixed", faces: [under] } },
          loads: { a: { name: "Pushed over", kind: "force", faces: [outer], magnitude: { value: 200, unit: "N" }, direction: [1, 0, 0] } },
        };
      },
    });
    const s = r.run.summary;
    report.run = { status: r.run.status, error: r.run.error, mesh: r.run.mesh, stress: s?.stress.max, moves: s?.displacement, balance: s?.balance, adrift: s?.adrift, notes: r.run.notes, seconds: r.seconds };
    check("the kept part meshes on its own faces (gmsh lays every face out as it is)", r.run.status === "done" && r.run.mesh.method === "faces" && r.run.mesh.quality.poor === 0, report.run);
    check("its mesh's volume is the part's", Math.abs(r.run.mesh.volumeOff) < 0.01, r.run.mesh?.volumeOff);
    check("it solves: the forces balance and energy agrees with work", s?.balance < 1e-6 && s?.adrift < 1e-5, { balance: s?.balance, adrift: s?.adrift });
    check("the upright's top moves the way it is pushed (+x), by tens of micrometres", s?.displacement.vector[0] > 0 && s.displacement.max > 5e-6 && s.displacement.max < 5e-4 && s.displacement.at[1] > 0.045, s?.displacement);
    check("the stress peaks low on the upright, at the inside corner or the hole", s?.stress.max > 1e6 && s.stress.max < 2e8, s?.stress);
  } catch (err) {
    check("the real run ran", false, String(err?.stack ?? err));
  }
}
report.logs = b.logs?.slice?.(-20);
console.log(JSON.stringify(report, null, 2));
b.stop(list.failed ? 1 : 0);
