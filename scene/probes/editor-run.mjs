// The scene editor (the stage, editing), driven with a real mouse
// and keyboard in headless Chrome.
//
//   pnpm build
//   node probes/editor-run.mjs [--port 4600] [--cdp 9600] [--show] [--shots <dir>]
//
// Opens probes/editor-probe.html: the BUILT tool, two views of one doc (A big,
// B small; each one's broadcasts reach only the other), a locked board with a
// 5×5 grid of connectors, three blocks and two pawns. Then, with real CDP mouse
// and key events: the layout (toolbar top, sidebar right, canvas the rest);
// click to select (outline row, inspector, B's box); Escape; G / R / H; a
// gizmo drag (B sees the pose mid-drag, then the landed transform); the hand
// (snaps to a connector, Q turns, Esc puts back, Alt places freely); orbit on
// the locked board; Measure; Delete; F; P; double-click; the context menu; no
// activity switcher (a plain model offers only editing); a pasted automerge
// URL; a dimension selected by its label and deleted; the inspector's Scene
// section (Starts in) and "Add behaviour…" (an arena Target on a block starts
// the arena's editing extension and offers Play: Starts in and the switcher
// then list it, Play takes this view's editor away and Edit brings it back,
// the other view editing all along; × stops it). The arena's checks need
// arena/ built (its dist/ is registered alongside); without it they are
// skipped and say so. Prints a JSON report and exits non-zero if any check
// fails.
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
const PORT = Number(arg("port", 4600));
const CDP = Number(arg("cdp", 9600));
if ([9222, 9333, 9334].includes(CDP)) throw new Error(`--cdp ${CDP} is reserved`);
const SHOTS = resolve(arg("shots", join(process.env.TMPDIR || tmpdir(), "scene-editor-shots")));
const pkg = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (!existsSync(join(pkg, "dist/index.js"))) throw new Error("no dist/: run pnpm build first");
// served from the repo, so a sibling's built plugins can be registered too
const root = resolve(pkg, "..");
const ARENA = existsSync(join(root, "arena/dist/index.js"));
const page = `/scene/probes/editor-probe.html${ARENA ? "?plugins=/arena/dist/index.js" : ""}`;
// does arena's build offer parts (scene:part)? Then the bin has something to show.
const ARENA_PARTS = ARENA && (await import(join(root, "arena/dist/index.js")).then((m) => m.plugins.some((p) => p.type === "scene:part")).catch(() => false));

const b = await browser({ root, port: PORT, cdp: CDP, page, show: !!arg("show", false), timeout: 300_000 });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [], skipped: [] };
const P = (e) => b.js(`window.__p.${e}`);
const A = (e) => b.js(`(() => { const p = window.__p, d = p.A; return (${e}); })()`);
const Bv = (e) => b.js(`(() => { const p = window.__p, d = p.B; return (${e}); })()`);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `editor-${name}.png`)));
const doc = () => P("doc()");
const obj = async (id) => (await doc()).objects?.[id] ?? null;
const near = (a, c, eps = 1e-4) => Array.isArray(a) && Array.isArray(c) && a.length === c.length && a.every((v, i) => Math.abs(v - c[i]) <= eps);
const round = (v, n = 4) => (Array.isArray(v) ? v.map((x) => round(x, n)) : typeof v === "number" ? Number(v.toFixed(n)) : v);
/** the page point of an object's origin plus an offset (world, m), from A's camera */
const scr = async (id, off = [0, 0, 0], who = "A") => P(`screen(${JSON.stringify(id)}, ${JSON.stringify(off)}, __p.${who})`);
const world = async (w, who = "A") => P(`worldScreen(${JSON.stringify(w)}, __p.${who})`);
const selected = (who = "A") => b.js(`__p.${who}.local.get().selected ?? null`);
const tool = () => A(`d.local.get().tool ?? null`);
const pressed = () => P(`text('.toolbar button[aria-pressed=true]')`);
const camera = (who = "A") => b.js(`(() => { const c = __p.${who}.viewport.getCamera(); return { position: c.position, target: c.target }; })()`);
const heads = () => b.js(`JSON.stringify(__p.doc() && window.sceneHandle.heads?.())`);
/** focus A the way a person does: a click on empty canvas (the ground, far from everything) */
async function clickEmpty() {
  const r = await P(`rect('canvas')`);
  await b.click(r.x + 30, r.y + 30);
}

try {
  if (!(await b.waitFor("window.__ready", 30_000))) throw new Error("page never ready");
  if ((await b.js("window.__ready")) !== true) throw new Error(`setup failed: ${JSON.stringify(await P("errors"))}`);
  check("contentLoaded", await b.waitFor("__p.loaded() && __p.loaded(__p.B)", 30_000));
  await sleep(600);
  await shot("0-open");

  // ── layout ────────────────────────────────────────────────────────────────
  {
    const L = await b.js(`(() => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
      const h = __p.hostA;
      return { stage: r(h.querySelector('.scene-stage')), toolbar: r(h.querySelector('.toolbar')), sidebar: r(h.querySelector('.sidebar')), canvas: r(h.querySelector('canvas')),
        buttons: [...h.querySelectorAll('.toolbar button')].map((e) => e.textContent.trim()), picker: [...h.querySelectorAll('.toolbar select')].map((e) => [...e.options].map((o) => o.textContent)),
        oneRow: new Set([...h.querySelectorAll(".toolbar button, .toolbar select")].map((e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 20); })).size,
        panels: [...h.querySelectorAll('.sidebar section')].filter((s) => !s.hidden).map((s) => s.querySelector('h3, .panel-title')?.textContent.trim()),
        rows: [...h.querySelectorAll('.object-row')].map((e) => e.textContent.replace('×','').trim()) };
    })()`);
    report.layout = L;
    const want = ["Panel", "Frame all", "Measure", "Move", "Rotate", "No gizmo", "Hand", "Grid", "Axes", "Bounds"];
    check("toolbarButtons", want.every((w) => L.buttons.includes(w)) && L.picker[0]?.includes("cm"), { buttons: L.buttons, picker: L.picker });
    const t = L.toolbar, s = L.sidebar, c = L.canvas, st = L.stage;
    check("toolbarAlongTop", t && Math.abs(t.y - st.y) < 1 && Math.abs(t.w - st.w) < 1 && L.oneRow === 1, { t, st, rows: L.oneRow });
    check("sidebarAtRight", s && Math.abs(s.r - st.r) < 1 && Math.abs(s.y - t.b) < 1 && Math.abs(s.b - st.b) < 1 && s.w > 200 && s.w < 400, { s });
    check("canvasFillsTheRest", c && Math.abs(c.x - st.x) < 1 && Math.abs(c.y - t.b) < 1 && Math.abs(c.r - s.x) < 1 && Math.abs(c.b - st.b) < 1, { c });
    // nothing selected, the inspector shows the Scene, so its panel is there;
    // the parts bin comes last, and only when a package offers parts (arena's do)
    const panels = ["Objects", "Inspector", "Dimensions", ...(ARENA_PARTS ? ["Parts"] : [])];
    check("panelsObjectsInspectorDimensions", JSON.stringify(L.panels) === JSON.stringify(panels), { panels: L.panels, want: panels });
    check("outlineRows", JSON.stringify(L.rows) === JSON.stringify(["Board", "Block 1", "Block 2", "Block 3", "Pawn 1", "Pawn 2"]), L.rows);
  }

  // ── click selects; B sees it; Escape deselects ─────────────────────────────
  {
    const p = await scr("b0", [0, 0.016, 0]);
    await b.click(p.x, p.y);
    await sleep(250);
    check("clickSelects", (await selected()) === "b0", await selected());
    check("outlineRowHighlighted", await A(`!!p.hostA.querySelector('.object-row[data-id="b0"][data-selected]')`));
    const insp = await A(`(() => { const s = p.hostA.querySelector('.inspector-body')?.closest('section'); return { shown: !!s && !s.hidden && s.getBoundingClientRect().height > 40, name: p.hostA.querySelector('.inspector-body .name-input')?.value ?? null }; })()`);
    check("inspectorShowsIt", insp.shown && insp.name === "Block 1", insp);
    const peerBox = await b.waitFor(`(() => { let f = null; __p.B.viewport.scene.traverse((o) => { if (String(o.userData?.selection ?? '').startsWith('peer:') && o.visible) f = o; }); return f && f.box.max.x > f.box.min.x; })()`, 3000);
    const bRow = await Bv(`!!p.hostB.querySelector('.object-row[data-id="b0"][data-remote-selected]')`);
    const bPres = await Bv(`Object.values(d.presence.get()).some((s) => s.keys?.['scene.select']?.selected === 'b0')`);
    check("peerSeesSelectionBox", peerBox && bPres, { peerBox, bPres, bRow });
    check("peerOutlineMarksRow", bRow);
    await shot("1-selected");
    await b.key("Escape");
    await sleep(150);
    check("escapeDeselects", (await selected()) === null, await selected());
    check("peerBoxGoneAfterEscape", await b.waitFor(`(() => { let f = false; __p.B.viewport.scene.traverse((o) => { if (String(o.userData?.selection ?? '').startsWith('peer:')) f = true; }); return !f; })()`, 3000));
  }

  // ── G / R / H and the toolbar ─────────────────────────────────────────────
  {
    const seen = {};
    for (const [k, want, label] of [["r", "rotate", "Rotate"], ["h", "hand", "Hand"], ["g", "move", "Move"]]) {
      await b.key(k);
      await sleep(100);
      const t = await tool(), pr = await pressed();
      seen[k] = { tool: t, pressed: pr };
      check(`key${k.toUpperCase()}`, t === want && pr.includes(label) && !["Move", "Rotate", "Hand", "No gizmo"].filter((x) => x !== label).some((x) => pr.includes(x)), seen[k]);
    }
    // the toolbar's own buttons, clicked
    const btn = async (label) => A(`(() => { const e = [...p.hostA.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    let q = await btn("No gizmo");
    await b.click(q.x, q.y);
    check("toolbarNoGizmo", (await tool()) === "select" && (await pressed()).includes("No gizmo"), await pressed());
    q = await btn("Move");
    await b.click(q.x, q.y);
    check("toolbarMove", (await tool()) === "move", await tool());
    // Grid / Axes / Bounds toggles
    const tog = {};
    for (const label of ["Grid", "Axes", "Bounds"]) {
      q = await btn(label);
      const was = (await pressed()).includes(label);
      await b.click(q.x, q.y);
      const now = (await pressed()).includes(label);
      await b.click(q.x, q.y);
      const back = (await pressed()).includes(label);
      tog[label] = { was, now, back };
    }
    check("toolbarToggles", Object.values(tog).every((t) => t.was !== t.now && t.back === t.was), tog);
    check("togglesNotInDoc", (await doc()).view.grid === true && (await doc()).view.bounds === false, (await doc()).view);
  }

  // ── a gizmo drag: B sees the pose mid-drag, then the landed transform ───────
  {
    const p = await scr("b1", [0, 0.016, 0]);
    await b.click(p.x, p.y);
    await b.key("g");
    await sleep(200);
    check("gizmoOnSelection", await A(`(() => { const g = d.host.instanceOf("scene.gizmo").debug; return g.target?.id === "b1" && g.tc?.object === g.proxy; })()`));
    // find the X arrow by hovering along the projected +X direction
    const o = await A(`(() => { const g = d.host.instanceOf("scene.gizmo").debug; g.proxy.updateMatrixWorld(); const w = g.proxy.getWorldPosition(new g.proxy.position.constructor()); return [w.x, w.y, w.z]; })()`);
    const c0 = await world(o), c1 = await world([o[0] + 0.05, o[1], o[2]]);
    const len = Math.hypot(c1.x - c0.x, c1.y - c0.y), ux = (c1.x - c0.x) / len, uy = (c1.y - c0.y) / len;
    let handle = null;
    for (let s = 20; s <= 160 && !handle; s += 6) {
      const x = c0.x + ux * s, y = c0.y + uy * s;
      await b.move(x, y);
      await sleep(30);
      if ((await A(`d.host.instanceOf("scene.gizmo").debug.tc?.axis ?? null`)) === "X") handle = { x, y, s };
    }
    check("gizmoHandleFoundByHover", !!handle, { origin: c0, dir: [ux, uy] });
    if (handle) {
      const before = (await obj("b1")).transform.position;
      const mid = await b.drag([handle.x, handle.y], [handle.x + ux * 90, handle.y + uy * 90], {
        steps: 14,
        beforeRelease: async () => {
          await sleep(250); // the pose goes out throttled; give it a beat
          await shot("2-gizmo-mid-drag");
          return {
            doc: (await obj("b1")).transform.position,
            bShown: await Bv(`d.viewport.worldOf("b1").slice(12, 15)`),
            aShown: await A(`d.viewport.worldOf("b1").slice(12, 15)`),
            bHeldBy: await Bv(`d.presence.heldBy?.("b1") ?? null`),
          };
        },
      });
      const after = (await obj("b1")).transform.position;
      check("gizmoDocUnchangedMidDrag", near(mid.doc, before), mid);
      check("peerSeesPoseMidDrag", mid.bShown[0] - before[0] > 0.01 && Math.abs(mid.bShown[0] - mid.aShown[0]) < 0.01, round(mid));
      check("gizmoMovesBlock", after[0] - before[0] > 0.02 && Math.abs(after[1] - before[1]) < 1e-6 && Math.abs(after[2] - before[2]) < 1e-6, { before, after });
      await sleep(400);
      const bLanded = await Bv(`d.viewport.worldOf("b1").slice(12, 15)`);
      check("peerSeesLandedTransform", near(bLanded, after, 1e-5), { bLanded, after });
    }
  }

  // ── the hand ─────────────────────────────────────────────────────────────
  {
    await b.key("Escape");
    await b.key("h");
    check("handTool", (await tool()) === "hand");
    const carry = async (id, to, { mods = 0, during } = {}) => {
      // grabbed at the middle of its top face, so the grab offset is ~0 and
      // it lands where the pointer is (a grab on a side face keeps that offset)
      const from = await scr(id, [0, 0.0319, 0]);
      const dest = await world(to);
      return b.drag([from.x, from.y], [dest.x, dest.y], { mods, steps: 16, beforeRelease: during });
    };
    // onto a connector (board top is y = 0.04; connectors every 6 cm)
    const before = (await obj("b2")).transform;
    const mid = await carry("b2", [0.065, 0.04, 0.005], {
      during: async () => {
        await sleep(200);
        await shot("3-hand-carry");
        return { bShown: await Bv(`d.viewport.worldOf("b2").slice(12, 15)`), ring: await A(`(() => { let r = null; d.viewport.topScene?.traverse((o) => { if (o.isLine && o.visible && o.geometry?.attributes?.position?.count === 49) r = [o.position.x, o.position.y, o.position.z]; }); return r; })()`) };
      },
    });
    const t1 = (await obj("b2")).transform;
    report.hand = { before, mid: round(mid), snapped: t1 };
    check("handSnapsToConnector", near(t1.position, [0.06, 0.04, 0], 1e-4), { position: t1.position, mid: round(mid) });
    check("peerSeesCarry", mid.bShown && Math.abs(mid.bShown[0] - before.position[0]) > 0.05, round(mid.bShown));
    // Q while carrying turns it
    await carry("b2", [-0.055, 0.04, 0.065], { during: async () => { await b.key("q"); await sleep(80); } });
    const t2 = (await obj("b2")).transform;
    const yaw = Math.abs(t2.rotation[1]) > 1e-3 ? Math.abs(t2.rotation[1]) : null;
    check("handQTurns", near(t2.position, [-0.06, 0.04, 0.06], 1e-4) && yaw && Math.abs(yaw - Math.PI / 4) < 1e-3, t2);
    // Escape cancels: back where it was, on both views
    const docBefore = JSON.stringify((await obj("b2")).transform);
    const midEsc = await carry("b2", [0.12, 0.04, -0.12], {
      during: async () => {
        const moved = await A(`d.viewport.worldOf("b2").slice(12, 15)`);
        await b.key("Escape");
        await sleep(100);
        return { moved, after: await A(`d.viewport.worldOf("b2").slice(12, 15)`) };
      },
    });
    await sleep(300);
    const t3 = (await obj("b2")).transform;
    check("handEscapePutsBack", JSON.stringify(t3) === docBefore && near(midEsc.after, t3.position, 1e-5) && !near(midEsc.moved, t3.position, 1e-3), { t3, midEsc: round(midEsc) });
    check("peerSeesPutBack", near(await Bv(`d.viewport.worldOf("b2").slice(12, 15)`), t3.position, 1e-5));
    // Alt places freely, between connectors
    await carry("b0", [0.03, 0.04, -0.03], { mods: ["alt"] });
    const t4 = (await obj("b0")).transform;
    const onGrid = [0, 2].every((i) => Math.abs(t4.position[i] / 0.06 - Math.round(t4.position[i] / 0.06)) < 0.02);
    check("handAltPlacesFreely", Math.abs(t4.position[0] - 0.03) < 0.004 && Math.abs(t4.position[2] + 0.03) < 0.004 && Math.abs(t4.position[1] - 0.04) < 1e-4 && !onGrid, t4);
    await shot("4-hand-done");
  }

  // ── dragging the locked board orbits; the doc doesn't change ───────────────
  {
    const was = JSON.stringify((await doc()).objects);
    const cam0 = await camera();
    const p = await world([-0.1, 0.04, 0.08]);
    await b.drag([p.x, p.y], [p.x + 140, p.y - 30], { steps: 12 });
    const cam1 = await camera();
    check("lockedBoardOrbits", !near(cam0.position, cam1.position, 1e-3) && JSON.stringify((await doc()).objects) === was, { cam0: round(cam0), cam1: round(cam1) });
    await shot("5-orbited");
    // F frames everything again
    await b.key("f");
    await sleep(400);
    const cam2 = await camera();
    const inView = await A(`(() => { const r = d.viewport.canvas.getBoundingClientRect(); return ["board","b0","b1","b2","p0","p1"].every((id) => { const s = p.screen(id); return s && s.x > r.left && s.x < r.right && s.y > r.top && s.y < r.bottom; }); })()`);
    check("fFramesAll", !near(cam1.position, cam2.position, 1e-3) && inView, { cam2: round(cam2), inView });
  }

  // ── measure: M, two clicks on the board ─────────────────────────────────
  {
    await b.key("g");
    await b.key("m");
    check("measureArmed", (await A(`d.local.get().armed`)) === "scene.measure" && (await pressed()).includes("Measure"), await A(`d.local.get().armed`));
    const p1 = await world([-0.12, 0.04, -0.13]), p2 = await world([0.12, 0.04, -0.13]);
    await b.click(p1.x, p1.y);
    await b.move(p1.x + (p2.x - p1.x) * 0.85, p1.y + (p2.y - p1.y) * 0.85 + 3);
    await sleep(100);
    await shot("6-measure-rubber-band");
    report.shots.push(await b.shot(join(SHOTS, "editor-6b-rubber-band-zoom.png"), { x: Math.min(p1.x, p2.x) - 30, y: Math.min(p1.y, p2.y) - 40, width: Math.abs(p2.x - p1.x) + 60, height: Math.abs(p2.y - p1.y) + 80 }));
    report.rubberBand = await A(`(() => { let n = 0, vis = []; for (const s of [d.viewport.scene, d.viewport.topScene]) s?.traverse((o) => { if ((o.isLine || o.isLineSegments) && o.visible && o.parent?.name?.includes?.('measure')) vis.push(o.type); }); return vis; })()`);
    await b.click(p2.x, p2.y);
    await sleep(300);
    const dims = Object.values((await doc()).dimensions ?? {});
    const label = await A(`[...p.hostA.querySelectorAll('.scene-stage *')].filter((e) => !e.children.length && /\\d\\s*cm$/.test(e.textContent.trim()) && /dim/.test(e.className)).map((e) => e.textContent.trim())`);
    report.measure = { dims, label };
    const wd = dims[0] && [dims[0].a.world ?? null, dims[0].b.world ?? null];
    check("measureWritesDimension", dims.length === 1 && label.some((l) => /^24(\.0+)?\s*cm$/.test(l)), { dims, label, wd });
    check("dimensionInPanel", (await A(`p.text('.sidebar section').join(' ')`)).includes("24"), await A(`p.text('.sidebar section')`));
    await shot("7-measured");
    await b.key("Escape");
    await b.key("Escape");
    check("measureDisarmed", (await A(`d.local.get().armed`)) == null, await A(`d.local.get().armed`));
  }

  // ── a dimension: its label selects it (the one selection); Delete removes it ──
  {
    const ids0 = Object.keys((await doc()).dimensions ?? {});
    const p = await scr("b2", [0, 0.0319, 0]);
    await b.click(p.x, p.y);
    const first = await selected();
    const lab = await A(`p.rect('.dimension-label')`);
    if (lab) await b.click(lab.x + lab.w / 2, lab.y + lab.h / 2);
    await sleep(150);
    const sel = await selected();
    const marks = await A(`({ dimRow: !!p.hostA.querySelector('.dimension-row[data-selected]'), objRows: [...p.hostA.querySelectorAll('.object-row[data-selected]')].map((e) => e.dataset.id), gizmo: d.host.instanceOf("scene.gizmo")?.debug?.target?.id ?? null })`);
    // selecting the dimension let go of the block: there is one selection
    check("dimensionLabelSelects", first === "b2" && ids0.length === 1 && sel === `dimension:${ids0[0]}` && marks.dimRow && !marks.objRows.length && !marks.gizmo, { ids0, first, lab, sel, marks });
    const peer = await b.waitFor(`Object.values(__p.B.presence.get()).some((s) => s.keys?.['scene.select']?.selected === ${JSON.stringify(sel)})`, 2000);
    check("peerHearsDimensionSelected", peer);
    await shot("7b-dimension-selected");
    const n0 = Object.keys((await doc()).objects).length;
    await b.key("Delete");
    await sleep(200);
    const after = { dims: Object.keys((await doc()).dimensions ?? {}), objects: Object.keys((await doc()).objects).length, selected: await selected(), label: await A(`p.rect('.dimension-label')`) };
    check("deleteRemovesDimension", after.dims.length === 0 && after.objects === n0 && after.selected === null && !after.label, { n0, ...after });
  }

  // ── Delete removes the selected block ───────────────────────────────────
  {
    const p = await scr("p0", [0, 0.015, 0]);
    await b.click(p.x, p.y);
    check("pawnSelected", (await selected()) === "p0", await selected());
    await b.key("Delete");
    await sleep(200);
    check("deleteRemoves", !(await obj("p0")) && !(await doc()).order.includes("p0") && (await selected()) === null);
    check("peerOutlineLosesRow", await b.waitFor(`!__p.hostB.querySelector('.object-row[data-id="p0"]')`, 2000));
  }

  // ── P hides and shows the sidebar ───────────────────────────────────────
  {
    await b.key("p");
    await sleep(150);
    const hid = await A(`({ sidebar: p.rect('.sidebar'), canvas: p.rect('canvas'), stage: p.rect('.scene-stage'), pressed: p.text('.toolbar button[aria-pressed=true]') })`);
    check("pHidesSidebar", (!hid.sidebar || hid.sidebar.w === 0) && Math.abs(hid.canvas.w - hid.stage.w) < 1 && !hid.pressed.includes("Panel"), hid);
    await shot("8-no-sidebar");
    await b.key("p");
    await sleep(150);
    const back = await A(`({ sidebar: p.rect('.sidebar'), canvas: p.rect('canvas') })`);
    check("pShowsSidebar", back.sidebar?.w > 200 && Math.abs(back.canvas.x + back.canvas.w - back.sidebar.x) < 1, back);
  }

  // ── double-click frames an object ───────────────────────────────────────
  {
    const p = await scr("p1", [0, 0.015, 0]);
    await b.dblclick(p.x, p.y);
    await sleep(500);
    const cam = await camera();
    const t = (await obj("p1")).transform.position;
    const dist = Math.hypot(cam.target[0] - t[0], cam.target[1] - (t[1] + 0.015), cam.target[2] - t[2]);
    const span = Math.hypot(...cam.position.map((v, i) => v - cam.target[i]));
    check("dblclickFramesObject", dist < 0.01 && span < 0.3, { target: round(cam.target), pawn: t, span: round(span) });
    await shot("9-framed-pawn");
    await b.key("f");
    await sleep(400);
  }

  // ── the context menu ────────────────────────────────────────────────────
  {
    await b.key("Escape");
    const p = await scr("b1", [0, 0.016, 0]);
    await b.click(p.x, p.y, { button: "right" });
    await sleep(150);
    const items = await A(`p.text('.context-menu .menu-item .menu-label')`);
    const menuRect = await A(`p.rect('.context-menu')`);
    await shot("10-menu");
    check("menuOpensAtPointer", menuRect && Math.abs(menuRect.x - p.x) < 40 && Math.abs(menuRect.y - p.y) < 40, { menuRect, at: p });
    check("menuHasRemoveAndSelect", items.includes("Remove") && items.includes("Select"), items);
    const sel = await A(`(() => { const e = [...p.hostA.querySelectorAll('.context-menu .menu-item')].find((x) => x.querySelector('.menu-label')?.textContent.trim() === "Select"); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (sel) await b.click(sel.x, sel.y);
    await sleep(100);
    check("menuSelectSelects", (await selected()) === "b1" && !(await A(`p.rect('.context-menu')`)), await selected());
    // and Remove from the menu
    const q = await scr("b1", [0, 0.016, 0]);
    await b.click(q.x, q.y, { button: "right" });
    await sleep(150);
    const rm = await A(`(() => { const e = [...p.hostA.querySelectorAll('.context-menu .menu-item')].find((x) => x.querySelector('.menu-label')?.textContent.trim() === "Remove"); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (rm) await b.click(rm.x, rm.y);
    await sleep(200);
    check("menuRemoveRemoves", !(await obj("b1")));
  }

  // ── activities: a plain model offers only editing, so no switcher ───────
  {
    const sw = await A(`(() => { const e = p.hostA.querySelector('.activity-switch'); return { there: !!e, hidden: e?.hidden ?? null, activities: d.local.get().activities, activity: d.local.get().activity }; })()`);
    check("noSwitcherInAModel", sw.there && sw.hidden && sw.activity === "edit" && sw.activities?.current === "edit" && JSON.stringify(sw.activities?.available) === '["edit"]', sw);
  }

  // ── paste an automerge URL ──────────────────────────────────────────────
  {
    const n0 = Object.keys((await doc()).objects).length;
    // A real ⌘V needs the system clipboard, which headless Chrome doesn't
    // reliably give a page; the event the browser would fire is dispatched.
    await A(`(() => { const dt = new DataTransfer(); dt.setData("text/plain", window.blockUrl); p.hostA.querySelector('.scene-stage').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
    const added = await b.waitFor(`Object.keys(__p.doc().objects).length === ${n0 + 1}`, 5000);
    const d = await doc();
    const id = d.order.at(-1);
    check("pasteAddsObject", added && d.objects[id]?.sourceUrl === (await b.js("window.blockUrl")), { n0, now: Object.keys(d.objects).length, last: d.objects[id] });
    await sleep(500);
    await shot("13-pasted");
  }

  // ── an STL: pasted, built by its source, sized by Bounds, rebuilt at another unit ──
  {
    await A(`(() => { const dt = new DataTransfer(); dt.setData("text/plain", window.stlUrl); p.hostA.querySelector('.scene-stage').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
    const id = await b.waitFor(`Object.entries(__p.doc().objects).find(([, o]) => o.sourceUrl === window.stlUrl)?.[0]`, 5000);
    const o = id && (await obj(id));
    check("stlAddedWithRenderDoc", !!o && o.providerId === "file-stl" && !!o.renderUrl, o);
    const built = id && (await b.waitFor(`!!__p.A.viewport.contentOf(${JSON.stringify(id)})?.loaded`, 20_000));
    check("stlBuilt", built, id && (await A(`d.loadState(${JSON.stringify(id)}) ?? d.local.get().status?.[${JSON.stringify(id)}] ?? null`).catch(() => null)));
    if (built) {
      // move it off the board so it's easy to see, then size it
      await b.js(`window.sceneHandle.change((d) => { d.objects[${JSON.stringify(id)}].transform.position = [-0.3, 0, -0.1]; })`);
      await A(`(() => { const e = [...p.hostA.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === "Bounds"); e.click(); return true; })()`);
      // the toolbar's units picker: mm
      await A(`(() => { const s = p.hostA.querySelector('.toolbar select'); s.selectedIndex = [...s.options].findIndex((o) => o.textContent === "mm"); s.dispatchEvent(new Event("change")); return true; })()`);
      const row = await A(`(() => { const r = p.hostA.querySelector('.object-row[data-id="${id}"] .row-main').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
      await b.click(row.x, row.y);
      const labels = await b.waitFor(`(() => { const l = __p.text('.bounds-label'); return l.length === 3 && l; })()`, 4000);
      check("boundsLabelsInMm", labels && labels.every((t) => /^20(\.0+)?\s*mm$/.test(t)), labels || (await A(`p.text('.bounds-label')`)));
      check("unitsPickerIsLocal", (await doc()).view.units === "cm" && (await A(`d.local.get().prefs?.units`)) === "mm", { doc: (await doc()).view.units, pref: await A(`d.local.get().prefs`) });
      await shot("14-stl-bounds");
      // the build controls embedded in the inspector: the STL's unit param to cm
      const hasControls = await b.waitFor(`!!__p.hostA.querySelector('.scene-render-controls select')`, 4000);
      check("inspectorEmbedsBuildControls", hasControls);
      if (hasControls) {
        await A(`(() => { const s = p.hostA.querySelector('.scene-render-controls select'); s.value = "cm"; s.dispatchEvent(new Event("change")); return true; })()`);
        const rebuilt = await b.waitFor(`(() => { const l = __p.text('.bounds-label'); return l.length === 3 && l.every((t) => /^200(\\.0+)?\\s*mm$/.test(t)) && l; })()`, 20_000);
        check("unitParamRebuildsAt200mm", rebuilt, await A(`p.text('.bounds-label')`));
        await shot("15-stl-rebuilt");
      }
      // tidy: bounds off, units back
      await A(`(() => { const e = [...p.hostA.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === "Bounds"); e.click(); const s = p.hostA.querySelector('.toolbar select'); s.selectedIndex = [...s.options].findIndex((o) => o.textContent === "cm"); s.dispatchEvent(new Event("change")); return true; })()`);
    }
  }

  // ── attachment: a child follows its parent's gizmo drag, keeping its local transform ──
  {
    await b.key("Escape");
    // attach Block 1 (b0) to Block 3 (b2) through the inspector's "Attached to"
    const r0 = await A(`(() => { const r = p.hostA.querySelector('.object-row[data-id="b0"] .row-main').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
    await b.click(r0.x, r0.y);
    const wBefore = await A(`d.viewport.worldOf("b0").slice(12, 15)`);
    const attached = await A(`(() => { const s = p.hostA.querySelector('.inspector-body select.attach'); if (!s) return false; const i = [...s.options].findIndex((o) => /Block 3/.test(o.textContent)); if (i < 0) return false; s.selectedIndex = i; s.dispatchEvent(new Event("change")); return true; })()`);
    await sleep(250);
    const c0 = await obj("b0");
    const w0 = await A(`d.viewport.worldOf("b0").slice(12, 15)`);
    check("attachKeepsWorldPose", attached && c0.parent === "b2" && near(w0, wBefore, 1e-6) && !near(c0.transform.position, wBefore, 1e-4), { attached, parent: c0?.parent, local: c0?.transform.position, wBefore, w0 });
    // move the parent with the gizmo (deselect first: Block 1's gizmo can lie over Block 3)
    // attaching re-filed Block 1's outline row (it was focused, from the click):
    // focus must come back to the stage, or no key reaches it
    const focus = await A(`(() => { const a = document.activeElement; return { tag: a?.tagName ?? null, inStage: !!a && p.hostA.contains(a) }; })()`);
    await b.key("Escape");
    check("keysWorkAfterFocusedRowRefiled", focus.inStage && (await selected()) === null, { focus, selected: await selected() });
    await clickEmpty();
    check("clickOnEmptyDeselects", (await selected()) === null, await selected());
    const p2 = await scr("b2", [0, 0.0319, 0]);
    report.underB2 = await A(`(() => { const r = d.viewport.canvas.getBoundingClientRect(); const h = d.viewport.pick(${p2.x} - r.left, ${p2.y} - r.top); return h && h.id; })()`);
    await b.click(p2.x, p2.y);
    await b.key("g");
    check("parentSelected", (await selected()) === "b2", await selected());
    const o = await A(`(() => { const g = d.host.instanceOf("scene.gizmo").debug; g.proxy.updateMatrixWorld(); const e = g.proxy.matrixWorld.elements; return [e[12], e[13], e[14]]; })()`);
    const s0 = await world(o), s1 = await world([o[0] + 0.05, o[1], o[2]]);
    const L = Math.hypot(s1.x - s0.x, s1.y - s0.y), u = [(s1.x - s0.x) / L, (s1.y - s0.y) / L];
    let h = null;
    for (let s = 20; s <= 160 && !h; s += 6) {
      await b.move(s0.x + u[0] * s, s0.y + u[1] * s);
      await sleep(30);
      if ((await A(`d.host.instanceOf("scene.gizmo").debug.tc?.axis ?? null`)) === "X") h = [s0.x + u[0] * s, s0.y + u[1] * s];
    }
    if (h) {
      const pBefore = (await obj("b2")).transform.position;
      await b.drag(h, [h[0] + u[0] * 70, h[1] + u[1] * 70]);
      const pAfter = (await obj("b2")).transform.position;
      const c1 = await obj("b0");
      const w1 = await A(`d.viewport.worldOf("b0").slice(12, 15)`);
      const dx = pAfter[0] - pBefore[0];
      check("childFollowsParent", dx > 0.01 && JSON.stringify(c1.transform) === JSON.stringify(c0.transform) && Math.abs(w1[0] - w0[0] - dx) < 1e-6 && Math.abs(w1[2] - w0[2]) < 1e-6, { dx, w0, w1, local: c1.transform.position });
      await shot("16-attached-moved");
    } else check("childFollowsParent", false, "no gizmo handle found");
  }

  // ── the inspector: the Scene (Starts in), and "Add behaviour…" on a block ──
  {
    await b.key("Escape");
    await clickEmpty();
    const startsIn = `(() => {
      const r = p.hostA.querySelector('.inspector[data-kind="scene"]');
      return [...(r?.querySelectorAll('.starts-in input[data-activity]') ?? [])].map((e) => [e.dataset.activity, e.checked]);
    })()`;
    const sc = await A(`(() => {
      const r = p.hostA.querySelector('.inspector[data-kind="scene"]');
      const s = r?.closest('section');
      return r && { shown: !!s && !s.hidden && r.getBoundingClientRect().height > 40, kind: r.querySelector('.inspector-kind')?.textContent ?? null,
        label: r.querySelector('.starts-in-group .group-label')?.textContent ?? null,
        startsIn: ${startsIn},
        addable: [...r.querySelectorAll('.behaviour-add option')].map((o) => o.textContent) };
    })()`);
    report.sceneInspector = sc;
    check("sceneSectionStartsIn", (await selected()) === null && sc?.shown && sc.kind === "Scene" && sc.label === "Starts in" && JSON.stringify(sc.startsIn) === '[["edit",true]]', sc);
    await shot("17-scene-inspector");
    if (!ARENA) report.skipped.push("addBehaviourOffersPlay, startsInWritesViewActivity, playTakesTheEditorAway, editBringsItBack, removeBehaviourStopsArena: arena/ isn't built");
    else {
      // a block, selected from its outline row; "Add behaviour…" → Target
      const row = await A(`(() => { const r = p.hostA.querySelector('.object-row[data-id="b2"] .row-main').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
      await b.click(row.x, row.y);
      const offered = await A(`[...p.hostA.querySelectorAll('.inspector-body .behaviour-add option')].map((o) => [o.value, o.textContent])`);
      const wasRunning = (await P("running()")).includes("arena.edit");
      // a <select>'s popup isn't in the page in headless Chrome: pick as its change would
      await A(`(() => { const s = p.hostA.querySelector('.inspector-body .behaviour-add'); s.value = "arena.target"; s.dispatchEvent(new Event("change")); return true; })()`);
      // editing, the arena's editing part starts in both views (not its play), and both now offer Play
      const started = await b.waitFor(`__p.running().includes("arena.edit") && __p.running(__p.B).includes("arena.edit") && !__p.running().includes("arena")`, 8000);
      const card = await b.waitFor(`!!__p.hostA.querySelector('.inspector-body .behaviour[data-trait="arena.target"]')`, 2000);
      const switchers = await b.waitFor(`[__p.hostA, __p.hostB].every((h) => !h.querySelector('.activity-switch').hidden)`, 2000);
      const t = (await obj("b2"))?.traits;
      report.behaviour = { offered, wasRunning, traits: t, switchers, labels: await P(`text('.activity-switch button')`) };
      check("addBehaviourOffersPlay", (await selected()) === "b2" && offered.some(([v, l]) => v === "arena.target" && l === "Target") && !offered.some(([v]) => v === "arena.level") && !wasRunning && started && card && t?.["arena.target"] != null && switchers && JSON.stringify(report.behaviour.labels) === '["Play","Edit"]', report.behaviour);
      await sleep(300);
      await shot("18-behaviour-added");

      // nothing selected: Starts in now offers Play too; choosing it writes
      // view.activity, and moves nobody already here
      await b.key("Escape");
      await clickEmpty();
      const radio = async (a) => A(`(() => { const e = p.hostA.querySelector('.starts-in input[data-activity="${a}"]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      const listed = await A(startsIn);
      const pr = await radio("play");
      if (pr) await b.click(pr.x, pr.y);
      await sleep(200);
      const after = { listed, view: (await doc()).view.activity ?? null, now: await A(startsIn), mine: await A(`d.local.get().activity`), peer: await Bv(`d.local.get().activity`), editing: (await P("running()")).includes("scene.toolbar") };
      const er = await radio("edit");
      if (er) await b.click(er.x, er.y);
      await sleep(200);
      after.cleared = !("activity" in ((await doc()).view ?? {}));
      check("startsInWritesViewActivity", JSON.stringify(listed) === '[["edit",true],["play",false]]' && after.view === "play" && JSON.stringify(after.now) === '[["edit",false],["play",true]]' && after.mine === "edit" && after.peer === "edit" && after.editing && after.cleared, after);

      // the switcher: Play takes A's editor away (B keeps editing), Edit brings it back
      const opt = async (a) => A(`p.rect('.activity-switch button[data-activity="${a}"]')`);
      const play = await opt("play");
      await b.click(play.x + play.w / 2, play.y + play.h / 2);
      const inPlay = await b.waitFor(`__p.running().includes("arena") && !__p.running().includes("scene.select")`, 8000);
      await sleep(300);
      const off = await A(`({ toolbar: !!p.hostA.querySelector('.toolbar'), sidebar: !!p.hostA.querySelector('.sidebar'), canvas: p.rect('canvas'), stage: p.rect('.scene-stage'), running: p.running(), pressed: p.text('.activity-switch button[aria-pressed=true]'), peer: p.running(p.B).includes("scene.select") && !!p.hostB.querySelector('.toolbar') })`);
      check("playTakesTheEditorAway", inPlay && !off.toolbar && !off.sidebar && Math.abs(off.canvas.w - off.stage.w) < 1 && Math.abs(off.canvas.h - off.stage.h) < 1 && JSON.stringify(off.pressed) === '["Play"]' && off.peer, off);
      await shot("19-play");
      const edit = await opt("edit");
      await b.click(edit.x + edit.w / 2, edit.y + edit.h / 2);
      await sleep(500);
      const on = await A(`({ toolbar: p.rect('.toolbar'), sidebar: p.rect('.sidebar'), running: p.running(), pressed: p.text('.activity-switch button[aria-pressed=true]'), focusInside: p.hostA.contains(document.activeElement) })`);
      check("editBringsItBack", on.toolbar?.h > 20 && on.sidebar?.w > 200 && on.running.includes("scene.select") && !on.running.includes("arena") && JSON.stringify(on.pressed) === '["Edit"]' && on.focusInside, on);
      await clickEmpty();

      // × on the card: the trait goes, the arena's editing part stops (after
      // a doc-caused stop's linger), and with nothing played the switcher goes
      // the sidebar was made again when editing came back: find the row anew
      const row2 = await A(`(() => { const r = p.hostA.querySelector('.object-row[data-id="b2"] .row-main').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
      await b.click(row2.x, row2.y);
      await b.waitFor(`!!__p.hostA.querySelector('.inspector-body .behaviour[data-trait="arena.target"] .behaviour-remove')`, 2000);
      const x = await A(`p.rect('.inspector-body .behaviour[data-trait="arena.target"] .behaviour-remove')`);
      if (x) await b.click(x.x + x.w / 2, x.y + x.h / 2);
      const gone = (await obj("b2"))?.traits?.["arena.target"] === undefined;
      const stopped = await b.waitFor(`!__p.running().includes("arena.edit") && !__p.running(__p.B).includes("arena.edit")`, 8000);
      const hidden = await A(`p.hostA.querySelector('.activity-switch').hidden`);
      check("removeBehaviourStopsArena", !!x && gone && stopped && hidden && !(await A(`!!p.hostA.querySelector('.inspector-body .behaviour[data-trait="arena.target"]')`)), { x, gone, stopped, hidden, running: await P("running()") });
    }
  }

  report.errors = (await P("errors")).filter((e) => !/KHR_parallel_shader_compile/.test(e));
  check("noErrors", !report.errors.length, report.errors);
} catch (err) {
  check("fatal", false, String(err?.stack || err));
}
report.logs = b.logs.filter((l) => !/KHR_parallel_shader_compile/.test(l)).slice(-20);
report.ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify(report, null, 2));
b.stop(report.ok ? 0 : 1);
