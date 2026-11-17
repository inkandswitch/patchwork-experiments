// The scene editor (the stage, editing), driven with a real mouse
// and keyboard in headless Chrome.
//
//   pnpm build
//   node probes/editor-run.mjs [--port 4600] [--cdp 9600] [--show] [--shots <dir>]
//
// Opens probes/editor-probe.html: the BUILT tool, two views of one doc (A big,
// B small; each one's broadcasts reach only the other), a locked board with a
// 5×5 grid of connectors, three blocks and two pawns. Then, with real CDP mouse
// and key events: the layout (toolbar top, the drawer at the right with the
// Inspector pane each viewer opened from the toolbar: the tree on top, the
// fields below; canvas the rest); click to select (the tree's row and the
// fields in the one pane, B's box);
// Escape; no tools to pick (G, R and H do nothing); a halo drag (B sees the
// pose mid-drag, then the landed transform); the use prompt left over a halo
// handle goes back under the pointer when . moves the eye (a press there is
// the halo's drag); carrying by the trait (snaps to a
// connector, Q turns, Esc puts back, Alt places freely); orbit on the locked
// board; Measure (its Dimensions tab); Delete; . (Frame); the Inspector's ×
// and the toolbar's Inspector; . on a selection; the context menu; no modes (the
// Edit body the doc starts people in, no activity anywhere); a pasted automerge URL; a dimension
// selected by its label and deleted; the inspector on the Scene (the
// toolbar's Inspector: Starts in, Look or Edit) and "Add behaviour…" (an arena
// Target on a block starts the arena in both views, beside the editor: its
// Play in the toolbar, the editor still there in both; × stops it); the
// drawer's grip (drag, keys, double-click, an editor's own width, a narrow
// stage, the width remembered on opening again); a tall tree (capped at ~40%
// of the pane, its bar on top, a selection deep in it revealed, and again
// after × and the toolbar's Inspector). The arena's checks need
// arena/ built (its dist/ is registered alongside); without it they are
// skipped and say so. Prints a JSON report and exits non-zero if any check
// fails.
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
// Simulated time: both views run on the page's manual clock (window.__time). A wait on the views is frames
// (soon: at most ms of that clock), never a sleep; the wall (b.waitFor) is for loading and building only.
const FRAME = 1000 / 60;
const soon = (expr, ms) => b.soon(expr, { frames: Math.ceil(ms / FRAME) });
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
  await b.rest(600);
  // the tree is the top of the inspector's pane, which each viewer opens (the toolbar's Inspector): both open it
  for (const h of ["hostA", "hostB"]) await b.js(`(() => { const e = [...__p.${h}.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === "Inspector"); e?.click(); return !!e; })()`);
  await soon(`!!__p.hostA.querySelector('.stage-drawer .object-row') && !!__p.hostB.querySelector('.stage-drawer .object-row')`, 5000);
  await b.rest(400);
  await shot("0-open");

  // ── layout ────────────────────────────────────────────────────────────────
  {
    const L = await b.js(`(() => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
      const h = __p.hostA;
      return { stage: r(h.querySelector('.scene-stage')), toolbar: r(h.querySelector('.toolbar')), drawer: r(h.querySelector('.stage-drawer')), canvas: r(h.querySelector('canvas')),
        buttons: [...h.querySelectorAll('.toolbar button')].map((e) => e.textContent.trim()), picker: [...h.querySelectorAll('.toolbar select')].map((e) => [...e.options].map((o) => o.textContent)),
        oneRow: new Set([...h.querySelectorAll(".toolbar button, .toolbar select")].map((e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 20); })).size,
        tabs: [...h.querySelectorAll('.stage-drawer-tab-name')].map((e) => e.textContent.trim()),
        pane: r(h.querySelector('.stage-drawer [data-panel="inspector"]')), tree: r(h.querySelector('.stage-drawer .inspector-tree')), fields: r(h.querySelector('.stage-drawer .inspector-body')),
        rows: [...h.querySelectorAll('.object-row')].map((e) => e.textContent.replace('×','').trim()) };
    })()`);
    report.layout = L;
    const want = ["Inspector", "Dimensions", "Frame all", "Measure", "Snap", "Grid", "Axes", "Bounds", "Undo", "Redo"];
    check("toolbarButtons", want.every((w) => L.buttons.includes(w)) && !["Objects", "Move", "Rotate", "No gizmo", "Hand", "Panel"].some((w) => L.buttons.includes(w)) && L.picker[0]?.includes("cm"), { buttons: L.buttons, picker: L.picker });
    const t = L.toolbar, s = L.drawer, c = L.canvas, st = L.stage;
    check("toolbarAlongTop", t && Math.abs(t.y - st.y) < 1 && Math.abs(t.w - st.w) < 1 && L.oneRow === 1, { t, st, rows: L.oneRow });
    check("drawerAtRight", s && Math.abs(s.r - st.r) < 1 && Math.abs(s.y - t.b) < 1 && Math.abs(s.b - st.b) < 1 && s.w > 200 && s.w < 400, { s });
    check("canvasFillsTheRest", c && Math.abs(c.x - st.x) < 1 && Math.abs(c.y - t.b) < 1 && Math.abs(c.r - s.x) < 1 && Math.abs(c.b - st.b) < 1, { c });
    // chrome follows attention: only the pane the viewer opened, one tab for the tree and the fields;
    // Parts is a toggle in the toolbar only when a package offers parts (arena's do)
    check("drawerHasOnlyTheInspector", JSON.stringify(L.tabs) === '["Inspector"]' && L.buttons.includes("Parts") === !!ARENA_PARTS, { tabs: L.tabs, parts: L.buttons.includes("Parts") });
    // the tree on top (at most ~40% of the pane), the fields under it, both inside the one pane
    const tr = L.tree, f = L.fields, pn = L.pane;
    check("treeAboveTheFields", tr && f && pn && tr.y >= pn.y - 1 && tr.b <= f.y + 1 && f.b <= pn.b + 1 && tr.h <= 0.4 * pn.h + 2 && f.h > 40, { pane: pn, tree: tr, fields: f });
    check("outlineRows", JSON.stringify(L.rows) === JSON.stringify(["Board", "Block 1", "Block 2", "Block 3", "Pawn 1", "Pawn 2"]), L.rows);
  }

  // ── click selects; B sees it; Escape deselects ─────────────────────────────
  {
    const p = await scr("b0", [0, 0.016, 0]);
    await b.click(p.x, p.y);
    await b.rest(250);
    check("clickSelects", (await selected()) === "b0", await selected());
    check("outlineRowHighlighted", await A(`!!p.hostA.querySelector('.object-row[data-id="b0"][data-selected]')`));
    // the one pane: its tree marks the row, its fields show the object (one selection)
    const insp = await A(`(() => ({ tabs: [...p.hostA.querySelectorAll('.stage-drawer-tab-name')].map((e) => e.textContent.trim()), shown: p.hostA.querySelector('.stage-drawer-tab[aria-selected="true"] .stage-drawer-tab-name')?.textContent ?? null, name: p.hostA.querySelector('.inspector-body .name-input')?.value ?? null, id: p.hostA.querySelector('.inspector-body .inspector')?.dataset.id ?? null, row: [...p.hostA.querySelectorAll('.inspector-tree .object-row[aria-selected="true"]')].map((e) => e.dataset.id) }))()`);
    check("inspectorShowsIt", JSON.stringify(insp.tabs) === '["Inspector"]' && insp.shown === "Inspector" && insp.name === "Block 1" && insp.id === "b0" && JSON.stringify(insp.row) === '["b0"]', insp);
    const peerBox = await soon(`(() => { let f = null; __p.B.viewport.scene.traverse((o) => { if (String(o.userData?.selection ?? '').startsWith('peer:') && o.visible) f = o; }); return f && f.box.max.x > f.box.min.x; })()`, 3000);
    const bRow = await Bv(`!!p.hostB.querySelector('.object-row[data-id="b0"][data-remote-selected]')`);
    const bPres = await Bv(`Object.values(d.presence.get()).some((s) => s.keys?.['scene.select']?.selected === 'b0')`);
    check("peerSeesSelectionBox", peerBox && bPres, { peerBox, bPres, bRow });
    check("peerOutlineMarksRow", bRow);
    await shot("1-selected");
    await b.key("Escape");
    await b.rest(150);
    check("escapeDeselects", (await selected()) === null, await selected());
    check("peerBoxGoneAfterEscape", await soon(`(() => { let f = false; __p.B.viewport.scene.traverse((o) => { if (String(o.userData?.selection ?? '').startsWith('peer:')) f = true; }); return !f; })()`, 3000));
  }

  // ── no tools to pick: G, R and H are nobody's; the toolbar ────────────────
  {
    const seen = {};
    for (const k of ["r", "h", "g"]) {
      await b.key(k);
      await b.rest(100);
      seen[k] = { pressed: await pressed(), objects: JSON.stringify((await doc()).objects) };
    }
    check("noToolKeys", Object.values(seen).every((s) => !["Move", "Rotate", "Hand", "No gizmo"].some((x) => s.pressed.includes(x))) && new Set(Object.values(seen).map((s) => s.objects)).size === 1, seen);
    // the toolbar's own buttons, clicked
    const btn = async (label) => A(`(() => { const e = [...p.hostA.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    let q;
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

  // ── a halo drag: B sees the pose mid-drag, then the landed transform ───────
  {
    const p = await scr("b1", [0, 0.016, 0]);
    await b.click(p.x, p.y);
    await b.rest(200);
    check("haloOnSelection", (await P("halo()"))?.id === "b1", await P("halo()"));
    // the X arrow, and which way on screen +X runs
    const h0 = await P('haloAt("move", 0)'), h1 = await P('haloAt("move", 0, 0.05)');
    const len = h0 && h1 ? Math.hypot(h1.x - h0.x, h1.y - h0.y) : 0;
    const ux = len ? (h1.x - h0.x) / len : 0, uy = len ? (h1.y - h0.y) / len : 0;
    const handle = h0 && len ? { x: h0.x, y: h0.y } : null;
    if (handle) {
      await b.move(handle.x, handle.y);
      await b.rest(60);
    }
    check("haloArrowOnScreen", !!handle, { h0, h1 });
    if (handle) {
      const before = (await obj("b1")).transform.position;
      const mid = await b.drag([handle.x, handle.y], [handle.x + ux * 90, handle.y + uy * 90], {
        steps: 14,
        beforeRelease: async () => {
          await b.rest(250); // the pose goes out throttled; give it a beat
          await shot("2-halo-mid-drag");
          return {
            doc: (await obj("b1")).transform.position,
            bShown: await Bv(`d.viewport.worldOf("b1").slice(12, 15)`),
            aShown: await A(`d.viewport.worldOf("b1").slice(12, 15)`),
            bHeldBy: await Bv(`d.presence.heldBy?.("b1") ?? null`),
          };
        },
      });
      const after = (await obj("b1")).transform.position;
      check("haloDocUnchangedMidDrag", near(mid.doc, before), mid);
      check("peerSeesPoseMidDrag", mid.bShown[0] - before[0] > 0.01 && Math.abs(mid.bShown[0] - mid.aShown[0]) < 0.01, round(mid));
      check("haloMovesBlock", after[0] - before[0] > 0.02 && Math.abs(after[1] - before[1]) < 1e-6 && Math.abs(after[2] - before[2]) < 1e-6, { before, after });
      await b.rest(400);
      const bLanded = await Bv(`d.viewport.worldOf("b1").slice(12, 15)`);
      check("peerSeesLandedTransform", near(bLanded, after, 1e-5), { bLanded, after });
    }
  }

  // ── the use prompt goes back under the pointer when the eye moves (STAGE.md, Fixed since) ──
  // Block 1 selected, its halo up. Frame it (.) to learn where a spot the halo's widget pick takes (its X arrow, or framed
  // this close its rotate ring) lands then, and put the camera
  // back; set the pointer so the prompt's first button lies over that spot, and go onto it: the prompt
  // holds still under it. Press .: the eye moves, the prompt goes back under the pointer (36 px below), and a
  // press there is the halo's, a halo drag, not the button the prompt left there.
  {
    const btn = () => A(`(() => { const e = p.hostA.querySelector('.use-prompt:not([hidden]) .use-verb'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, text: e.textContent }; })()`);
    const under = (pt) => A(`(() => { const e = document.elementFromPoint(${pt.x}, ${pt.y}); return e ? (e.closest(".use-verb") ? "prompt" : e === d.viewport.canvas ? "canvas" : e.className || e.tagName) : null; })()`);
    const cam0 = await A(`d.viewport.getCamera()`);
    await b.key(".");
    await b.rest(600);
    const cam1 = await camera();
    // a spot on the X arrow the view's widget pick takes as the halo's (framed close, its third along may not be)
    const picks = [];
    let H = null;
    for (const along of [0, 0.002, 0.004, 0.006, 0.008, 0.01, 0.015, 0.02, -0.002, -0.004]) {
      const q = await P(`haloAt("move", 0, ${along})`);
      const w = q && (await A(`(() => { const r = d.viewport.canvas.getBoundingClientRect(); const w = d.view.pickWidget({ x: ${q.x} - r.left, y: ${q.y} - r.top }); return w?.owner === "scene.halo"; })()`));
      picks.push({ along, q, w });
      if (w) {
        H = { x: q.x, y: q.y, along };
        break;
      }
    }
    const H1 = H && (await P(`haloAt("move", 0, ${H.along + 0.05})`));
    report.details.handleSpots = picks;
    await A(`(d.viewport.setCamera(${JSON.stringify(cam0)}), true)`);
    await b.rest(300);
    let ptr = H && { x: H.x, y: H.y - 50 };
    let bt = null;
    if (ptr) {
      await b.move(ptr.x, ptr.y);
      await b.rest(120);
      bt = await btn();
      if (bt) {
        ptr = { x: ptr.x + H.x - bt.x, y: ptr.y + H.y - bt.y };
        await b.move(ptr.x, ptr.y);
        await b.rest(120);
        bt = await btn();
      }
    }
    report.details.promptOverHandle = { H, ptr, bt, selected: await selected(), picks };
    check("promptOverHandleSpot", !!bt && Math.abs(bt.x - H.x) < bt.w / 2 && Math.abs(bt.y - H.y) < bt.h / 2, report.details.promptOverHandle);
    if (bt) {
      // onto its button: it holds still, and the button is what's under the pointer
      await b.move(H.x, H.y);
      await b.rest(120);
      const held = await btn();
      const under0 = await under(H);
      check("promptHoldsUnderThePointer", !!held && Math.abs(held.x - bt.x) < 0.5 && Math.abs(held.y - bt.y) < 0.5 && under0 === "prompt", { held, bt, under0 });
      // the eye moves (Frame, as before): the prompt goes back under the pointer
      await b.key(".");
      await b.rest(600);
      const cam2 = await camera();
      const moved = await btn();
      const under1 = await under(H);
      report.details.promptAfterFrame = { cam1: round(cam1), cam2: round(cam2), moved, under1 };
      check("framedAsBefore", near(cam2.position, cam1.position, 1e-3) && near(cam2.target, cam1.target, 1e-3), report.details.promptAfterFrame);
      check("promptBackUnderThePointer", !!moved && Math.abs(moved.x - H.x) < 1 && moved.y > H.y + 30 && under1 === "canvas", report.details.promptAfterFrame);
      // a press there is the halo's: a drag from it is the halo's gesture
      const len = Math.hypot(H1.x - H.x, H1.y - H.y);
      const before = (await obj("b1")).transform;
      const at = await A(`(() => { const r = d.viewport.canvas.getBoundingClientRect(); const x = ${H.x} - r.left, y = ${H.y} - r.top; const w = d.view.pickWidget({ x, y }); return { halo: p.halo()?.id ?? null, widget: w ? { owner: w.owner ?? null, part: w.part ?? null } : null, selected: d.local.get().selected ?? null }; })()`);
      const mid = await b.drag([H.x, H.y], [H.x + ((H1.x - H.x) / len) * 120, H.y + ((H1.y - H.y) / len) * 120], { steps: 12, beforeRelease: async () => ({ gesture: await A(`d.local.get().gesture?.owner ?? null`), written: (await obj("b1")).transform, shown: await A(`d.viewport.worldOf("b1").slice(12, 15)`) }) });
      await b.rest(300);
      const after = (await obj("b1")).transform;
      // (framed this close, the spot may be the halo's ring rather than its arrow: either way the press opens the
      // halo's drag, not the prompt's verb)
      check("pressThereIsTheHalos", at.widget?.owner === "scene.halo" && mid.gesture === "scene.halo", { before, after, at, mid, verb: bt.text });
      // and the prompt's verb (Flip) didn't run: Block 1 as written is as it was until the drag lets go, and the
      // gesture is the halo's, not a carry's
      check("promptVerbDidNotRun", JSON.stringify(mid.written) === JSON.stringify(before) && mid.gesture === "scene.halo", { before, written: mid.written, gesture: mid.gesture, verb: bt.text });
    }
    // the camera as the steps after expect it
    await A(`(d.viewport.setCamera(${JSON.stringify(cam0)}), true)`);
    await b.move(10, 10);
    await b.rest(300);
  }

  // ── carrying: by the trait, no tool to pick ──────────────────────────────
  {
    await b.key("Escape");
    check("carryRunsByTrait", (await P("running()")).includes("scene.carry"), await P("running()"));
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
        await b.rest(200);
        await shot("3-hand-carry");
        return { bShown: await Bv(`d.viewport.worldOf("b2").slice(12, 15)`), ring: await A(`(() => { let r = null; d.viewport.topScene?.traverse((o) => { if (o.isLine && o.visible && o.geometry?.attributes?.position?.count === 49) r = [o.position.x, o.position.y, o.position.z]; }); return r; })()`) };
      },
    });
    const t1 = (await obj("b2")).transform;
    report.hand = { before, mid: round(mid), snapped: t1 };
    check("handSnapsToConnector", near(t1.position, [0.06, 0.04, 0], 1e-4), { position: t1.position, mid: round(mid) });
    check("peerSeesCarry", mid.bShown && Math.abs(mid.bShown[0] - before.position[0]) > 0.05, round(mid.bShown));
    // Q while carrying turns it
    await carry("b2", [-0.055, 0.04, 0.065], { during: async () => { await b.key("q"); await b.rest(80); } });
    const t2 = (await obj("b2")).transform;
    const yaw = Math.abs(t2.rotation[1]) > 1e-3 ? Math.abs(t2.rotation[1]) : null;
    check("handQTurns", near(t2.position, [-0.06, 0.04, 0.06], 1e-4) && yaw && Math.abs(yaw - Math.PI / 4) < 1e-3, t2);
    // Escape cancels: back where it was, on both views
    const docBefore = JSON.stringify((await obj("b2")).transform);
    const midEsc = await carry("b2", [0.12, 0.04, -0.12], {
      during: async () => {
        const moved = await A(`d.viewport.worldOf("b2").slice(12, 15)`);
        await b.key("Escape");
        await b.rest(100);
        return { moved, after: await A(`d.viewport.worldOf("b2").slice(12, 15)`) };
      },
    });
    await b.rest(300);
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
    // . frames everything again (nothing is selected; F is carry's Flip now)
    await b.key(".");
    await b.rest(400);
    const cam2 = await camera();
    const inView = await A(`(() => { const r = d.viewport.canvas.getBoundingClientRect(); return ["board","b0","b1","b2","p0","p1"].every((id) => { const s = p.screen(id); return s && s.x > r.left && s.x < r.right && s.y > r.top && s.y < r.bottom; }); })()`);
    check("periodFramesAll", !near(cam1.position, cam2.position, 1e-3) && inView, { cam2: round(cam2), inView });
  }

  // ── measure: M, two clicks on the board ─────────────────────────────────
  {
    await b.key("m");
    // Measure is a held tool (STAGE.md, "Bodies"): it goes in the one slot
    check("measureArmed", (await A(`d.local.get().held?.ext`)) === "scene.measure" && (await pressed()).includes("Measure"), await A(`d.local.get().held`));
    const p1 = await world([-0.12, 0.04, -0.13]), p2 = await world([0.12, 0.04, -0.13]);
    await b.click(p1.x, p1.y);
    await b.move(p1.x + (p2.x - p1.x) * 0.85, p1.y + (p2.y - p1.y) * 0.85 + 3);
    await b.rest(100);
    await shot("6-measure-rubber-band");
    report.shots.push(await b.shot(join(SHOTS, "editor-6b-rubber-band-zoom.png"), { x: Math.min(p1.x, p2.x) - 30, y: Math.min(p1.y, p2.y) - 40, width: Math.abs(p2.x - p1.x) + 60, height: Math.abs(p2.y - p1.y) + 80 }));
    report.rubberBand = await A(`(() => { let n = 0, vis = []; for (const s of [d.viewport.scene, d.viewport.topScene]) s?.traverse((o) => { if ((o.isLine || o.isLineSegments) && o.visible && o.parent?.name?.includes?.('measure')) vis.push(o.type); }); return vis; })()`);
    await b.click(p2.x, p2.y);
    await b.rest(300);
    const dims = Object.values((await doc()).dimensions ?? {});
    const label = await A(`[...p.hostA.querySelectorAll('.scene-stage *')].filter((e) => !e.children.length && /\\d\\s*cm$/.test(e.textContent.trim()) && /dim/.test(e.className)).map((e) => e.textContent.trim())`);
    report.measure = { dims, label };
    const wd = dims[0] && [dims[0].a.world ?? null, dims[0].b.world ?? null];
    check("measureWritesDimension", dims.length === 1 && label.some((l) => /^24(\.0+)?\s*cm$/.test(l)), { dims, label, wd });
    // the toolbar's Dimensions opens its tab, listing it; then back to the Inspector
    await A(`(() => { const e = [...p.hostA.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === "Dimensions"); e.click(); return true; })()`);
    await b.rest(200);
    check("dimensionInItsTab", (await A(`p.text('.stage-drawer [data-panel="dimensions"]').join(' ')`)).includes("24"), await A(`p.text('.stage-drawer [data-panel="dimensions"]')`));
    await A(`(() => { const e = [...p.hostA.querySelectorAll('.stage-drawer-tab-name')].find((x) => x.textContent.trim() === "Inspector"); e.click(); return true; })()`);
    await shot("7-measured");
    await b.key("Escape");
    await b.key("Escape");
    // the ladder: the first Escape puts the tool down, the second lets the selection go
    check("measureDisarmed", (await A(`d.local.get().held`)) == null, await A(`d.local.get().held`));
  }

  // ── a dimension: its label selects it (the one selection); Delete removes it ──
  {
    const ids0 = Object.keys((await doc()).dimensions ?? {});
    const p = await scr("b2", [0, 0.0319, 0]);
    await b.click(p.x, p.y);
    const first = await selected();
    const lab = await A(`p.rect('.dimension-label')`);
    if (lab) await b.click(lab.x + lab.w / 2, lab.y + lab.h / 2);
    await b.rest(150);
    const sel = await selected();
    const marks = await A(`({ dimRow: !!p.hostA.querySelector('.dimension-row[data-selected]'), objRows: [...p.hostA.querySelectorAll('.object-row[data-selected]')].map((e) => e.dataset.id), halo: p.halo()?.id ?? null })`);
    // selecting the dimension let go of the block: there is one selection
    check("dimensionLabelSelects", first === "b2" && ids0.length === 1 && sel === `dimension:${ids0[0]}` && marks.dimRow && !marks.objRows.length && !marks.halo, { ids0, first, lab, sel, marks });
    const peer = await soon(`Object.values(__p.B.presence.get()).some((s) => s.keys?.['scene.select']?.selected === ${JSON.stringify(sel)})`, 2000);
    check("peerHearsDimensionSelected", peer);
    await shot("7b-dimension-selected");
    const n0 = Object.keys((await doc()).objects).length;
    await b.key("Delete");
    await b.rest(200);
    const after = { dims: Object.keys((await doc()).dimensions ?? {}), objects: Object.keys((await doc()).objects).length, selected: await selected(), label: await A(`p.rect('.dimension-label')`) };
    check("deleteRemovesDimension", after.dims.length === 0 && after.objects === n0 && after.selected === null && !after.label, { n0, ...after });
  }

  // ── Delete removes the selected block ───────────────────────────────────
  {
    const p = await scr("p0", [0, 0.015, 0]);
    await b.click(p.x, p.y);
    check("pawnSelected", (await selected()) === "p0", await selected());
    await b.key("Delete");
    await b.rest(200);
    check("deleteRemoves", !(await obj("p0")) && !(await doc()).order.includes("p0") && (await selected()) === null);
    check("peerOutlineLosesRow", await soon(`!__p.hostB.querySelector('.object-row[data-id="p0"]')`, 2000));
  }

  // ── the drawer: its tabs' × close them, and the canvas takes the room; the toolbar's Inspector opens it again ──
  {
    for (let i = 0; i < 4 && (await A(`!!p.hostA.querySelector('.stage-drawer-tab-close')`)); i++) {
      const x = await A(`p.rect('.stage-drawer-tab-close')`);
      await b.click(x.x + x.w / 2, x.y + x.h / 2);
      await b.rest(150);
    }
    const hid = await A(`({ drawer: p.rect('.stage-drawer'), canvas: p.rect('canvas'), stage: p.rect('.scene-stage') })`);
    check("closingTheTabsGivesTheCanvasTheRoom", !hid.drawer && Math.abs(hid.canvas.w - hid.stage.w) < 1, hid);
    await shot("8-no-drawer");
    await A(`(() => { const e = [...p.hostA.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === "Inspector"); e.click(); return true; })()`);
    await b.rest(200);
    const back = await A(`({ drawer: p.rect('.stage-drawer'), canvas: p.rect('canvas') })`);
    check("inspectorOpensItAgain", back.drawer?.w > 200 && Math.abs(back.canvas.x + back.canvas.w - back.drawer.x) < 1, back);
  }

  // ── . frames the selection (a click selects the pawn) ──────────────────
  {
    const p = await scr("p1", [0, 0.015, 0]);
    await b.click(p.x, p.y);
    await b.rest(200);
    await b.key(".");
    await b.rest(500);
    const cam = await camera();
    const t = (await obj("p1")).transform.position;
    const dist = Math.hypot(cam.target[0] - t[0], cam.target[1] - (t[1] + 0.015), cam.target[2] - t[2]);
    const span = Math.hypot(...cam.position.map((v, i) => v - cam.target[i]));
    check("frameKeyFramesSelection", dist < 0.01 && span < 0.3, { target: round(cam.target), pawn: t, span: round(span) });
    await shot("9-framed-pawn");
    // let the pawn go, then . frames everything
    await b.key("Escape");
    await b.key(".");
    await b.rest(400);
  }

  // ── the context menu ────────────────────────────────────────────────────
  {
    await b.key("Escape");
    const p = await scr("b1", [0, 0.016, 0]);
    await b.click(p.x, p.y, { button: "right" });
    await b.rest(150);
    const items = await A(`p.text('.context-menu .menu-item .menu-label')`);
    const menuRect = await A(`p.rect('.context-menu')`);
    await shot("10-menu");
    check("menuOpensAtPointer", menuRect && Math.abs(menuRect.x - p.x) < 40 && Math.abs(menuRect.y - p.y) < 40, { menuRect, at: p });
    check("menuHasRemoveAndSelect", items.includes("Remove") && items.includes("Select"), items);
    const sel = await A(`(() => { const e = [...p.hostA.querySelectorAll('.context-menu .menu-item')].find((x) => x.querySelector('.menu-label')?.textContent.trim() === "Select"); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (sel) await b.click(sel.x, sel.y);
    await b.rest(100);
    check("menuSelectSelects", (await selected()) === "b1" && !(await A(`p.rect('.context-menu')`)), await selected());
    // and Remove from the menu
    const q = await scr("b1", [0, 0.016, 0]);
    await b.click(q.x, q.y, { button: "right" });
    await b.rest(150);
    const rm = await A(`(() => { const e = [...p.hostA.querySelectorAll('.context-menu .menu-item')].find((x) => x.querySelector('.menu-label')?.textContent.trim() === "Remove"); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (rm) await b.click(rm.x, rm.y);
    await b.rest(200);
    check("menuRemoveRemoves", !(await obj("b1")));
  }

  // ── no modes: the Edit body (the doc starts people in it), and no activity anywhere ──
  {
    const sw = await A(`({ switcher: !!p.hostA.querySelector('.activity-switch'), body: d.local.get().body?.id, activity: "activity" in d.local.get(), activities: "activities" in d.local.get() })`);
    check("noModes", !sw.switcher && sw.body === "edit" && !sw.activity && !sw.activities, sw);
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
    await b.rest(500);
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
      // the built object's documents, a section each (STAGE.md, "The interface"): its Source, then its Build (the
      // controls, open); no button anywhere opens the source but a section's Open
      const docs = await A(`[...p.hostA.querySelectorAll('.inspector-body .doc-section')].map((s) => [s.dataset.section, s.querySelector('.section-label').textContent, !s.hasAttribute('data-folded'), !!s.querySelector('.scene-render-controls')])`);
      check("sectionsSourceThenBuild", JSON.stringify(docs) === JSON.stringify([["source", "Source", true, false], ["build", "Build", true, true]]), docs);
      // long fields (two sections) never squeeze the tree: it keeps its rows' height, up to its 40%
      const sq = await A(`(() => { const t = p.hostA.querySelector('.inspector-tree'), pane = p.hostA.querySelector('.inspector-pane'), want = t.querySelector('.scene-outline').scrollHeight; return { tree: t.getBoundingClientRect().height, pane: pane.getBoundingClientRect().height, want, fieldsScroll: p.hostA.querySelector('.inspector-body').scrollHeight }; })()`);
      check("treeNotSqueezedByLongFields", sq.tree >= Math.min(sq.want, 0.38 * sq.pane) && sq.fieldsScroll > sq.pane - sq.tree, sq);
      // an open section's box has a height of its own, which its (stand-in) view fills, so a tool that fills its host
      // gets one; a tool taller than it scrolls inside it (the build controls are the stand-in's mount here)
      const hs = await A(`[...p.hostA.querySelectorAll('.inspector-body .doc-section:not([data-folded])')].map((s) => { const e = s.querySelector('.section-embed'), v = e.querySelector('patchwork-view'); return [s.dataset.section, Math.round(e.getBoundingClientRect().height), Math.round(v?.getBoundingClientRect().height ?? 0)]; })`);
      check("sectionsHaveAHeight", hs.length === 2 && hs.every(([, box, view]) => box >= 120 && Math.abs(view - (box - 2)) <= 2), hs);
      check("noOpenSource", (await A(`p.hostA.querySelectorAll('.open-source, .open-file, .open-linked, .open-about').length`)) === 0);
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

  // ── attachment: a child follows its parent's halo drag, keeping its local transform ──
  {
    await b.key("Escape");
    // attach Block 1 (b0) to Block 3 (b2) through the inspector's "Attached to"
    const r0 = await A(`(() => { const r = p.hostA.querySelector('.object-row[data-id="b0"] .row-main').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
    await b.click(r0.x, r0.y);
    const wBefore = await A(`d.viewport.worldOf("b0").slice(12, 15)`);
    const attached = await A(`(() => { const s = p.hostA.querySelector('.inspector-body select.attach'); if (!s) return false; const i = [...s.options].findIndex((o) => /Block 3/.test(o.textContent)); if (i < 0) return false; s.selectedIndex = i; s.dispatchEvent(new Event("change")); return true; })()`);
    await b.rest(250);
    const c0 = await obj("b0");
    const w0 = await A(`d.viewport.worldOf("b0").slice(12, 15)`);
    check("attachKeepsWorldPose", attached && c0.parent === "b2" && near(w0, wBefore, 1e-6) && !near(c0.transform.position, wBefore, 1e-4), { attached, parent: c0?.parent, local: c0?.transform.position, wBefore, w0 });
    // move the parent with its halo (deselect first: Block 1's halo can lie over Block 3)
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
    await b.rest(150);
    check("parentSelected", (await selected()) === "b2", await selected());
    const s0 = await P('haloAt("move", 0)'), s1 = await P('haloAt("move", 0, 0.05)');
    const L = s0 && s1 ? Math.hypot(s1.x - s0.x, s1.y - s0.y) : 0;
    const u = L ? [(s1.x - s0.x) / L, (s1.y - s0.y) / L] : [0, 0];
    const h = L ? [s0.x, s0.y] : null;
    if (h) {
      const pBefore = (await obj("b2")).transform.position;
      await b.drag(h, [h[0] + u[0] * 70, h[1] + u[1] * 70]);
      const pAfter = (await obj("b2")).transform.position;
      const c1 = await obj("b0");
      const w1 = await A(`d.viewport.worldOf("b0").slice(12, 15)`);
      const dx = pAfter[0] - pBefore[0];
      check("childFollowsParent", dx > 0.01 && JSON.stringify(c1.transform) === JSON.stringify(c0.transform) && Math.abs(w1[0] - w0[0] - dx) < 1e-6 && Math.abs(w1[2] - w0[2]) < 1e-6, { dx, w0, w1, local: c1.transform.position });
      await shot("16-attached-moved");
    } else check("childFollowsParent", false, "no halo arrow found");
  }

  // ── the inspector: the Scene (Starts in), and "Add behaviour…" on a block ──
  {
    await b.key("Escape");
    await clickEmpty();
    // nothing selected: the inspector, opened by the selections before, stays open, now on the Scene
    // (HISTORY.md, TOOLS Decisions 6, "The inspector stays open"); its tab is shown to look at it
    check("inspectorStaysOpenOnTheScene", await soon(`!!__p.hostA.querySelector('.stage-drawer [data-panel="inspector"] .inspector[data-kind="scene"]')`, 3000), await A(`[...p.hostA.querySelectorAll('.stage-drawer-tab-name')].map((e) => e.textContent.trim())`));
    await A(`(() => { const e = [...p.hostA.querySelectorAll('.stage-drawer-tab-name')].find((x) => x.textContent.trim() === "Inspector"); e?.click(); return true; })()`);
    await b.rest(150);
    const startsIn = `(() => {
      const r = p.hostA.querySelector('.inspector[data-kind="scene"]');
      return [...(r?.querySelectorAll('.starts-in input[data-body]') ?? [])].map((e) => [e.dataset.body, e.checked]);
    })()`;
    const sc = await A(`(() => {
      const r = p.hostA.querySelector('.inspector[data-kind="scene"]');
      return r && { shown: r.getBoundingClientRect().height > 40, kind: r.querySelector('.inspector-kind')?.textContent ?? null,
        label: r.querySelector('.starts-in-group .group-label')?.textContent ?? null,
        startsIn: ${startsIn},
        addable: [...r.querySelectorAll('.behaviour-add option')].map((o) => o.textContent) };
    })()`);
    report.sceneInspector = sc ?? { selected: await selected(), tabs: await A(`[...p.hostA.querySelectorAll('.stage-drawer-tab-name')].map((e) => e.textContent.trim())`), kinds: await A(`[...p.hostA.querySelectorAll('.inspector')].map((e) => e.dataset.kind)`), pressed: await pressed() };
    check("sceneSectionStartsIn", (await selected()) === null && sc?.shown && sc.kind === "Scene" && sc.label === "Starts in" && JSON.stringify(sc.startsIn) === '[["look",false],["edit",true]]', sc);
    await shot("17-scene-inspector");
    if (!ARENA) report.skipped.push("addBehaviourRunsTheArena, theGameRunsBesideTheEditor, removeBehaviourStopsArena: arena/ isn't built");
    else {
      // a block, selected from its row in the pane's tree; "Add behaviour…" → Target
      await A(`(() => { const e = [...p.hostA.querySelectorAll('.stage-drawer-tab-name')].find((x) => x.textContent.trim() === "Inspector"); e?.click(); return true; })()`);
      await b.rest(150);
      const row = await A(`(() => { const r = p.hostA.querySelector('.object-row[data-id="b2"] .row-main').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
      await b.click(row.x, row.y);
      await soon(`__p.A.local.get().selected === "b2"`, 3000);
      await b.rest(200);
      const offered = await A(`[...p.hostA.querySelectorAll('.inspector-body .behaviour-add option')].map((o) => [o.value, o.textContent])`);
      const wasRunning = (await P("running()")).includes("arena");
      // a <select>'s popup isn't in the page in headless Chrome: pick as its change would
      await A(`(() => { const s = p.hostA.querySelector('.inspector-body .behaviour-add'); s.value = "arena.target"; s.dispatchEvent(new Event("change")); return true; })()`);
      // the arena starts in both views, its Play in each toolbar beside the editor's
      const started = await b.waitFor(`__p.running().includes("arena") && __p.running(__p.B).includes("arena")`, 8000);
      const card = await soon(`!!__p.hostA.querySelector('.inspector-body .behaviour[data-trait="arena.target"]')`, 2000);
      const t = (await obj("b2"))?.traits;
      report.behaviour = { offered, wasRunning, traits: t, play: await A(`!!p.hostA.querySelector('.toolbar [data-command="play"]')`) };
      check("addBehaviourRunsTheArena", (await selected()) === "b2" && offered.some(([v, l]) => v === "arena.target" && l === "Target") && !offered.some(([v]) => v === "arena.level") && !wasRunning && started && card && t?.["arena.target"] != null && report.behaviour.play, report.behaviour);
      await b.rest(300);
      await shot("18-behaviour-added");
      // the game runs beside the editor: nothing went from either view, and the doc still starts people in Edit (a behaviour doesn't move its start)
      const both = await A(`({ toolbar: !!p.hostA.querySelector('.toolbar'), select: p.running().includes("scene.select"), peerToolbar: !!p.hostB.querySelector('.toolbar'), peerEditor: p.running(p.B).includes("scene.inspector"), start: window.sceneHandle.doc().view?.start ?? null })`);
      check("theGameRunsBesideTheEditor", both.toolbar && both.select && both.peerToolbar && both.peerEditor && both.start?.body === "edit", both);
      await shot("19-game-and-editor");

      // × on the card: the trait goes, and the arena stops (after a doc-caused stop's linger)
      await A(`(() => { const e = [...p.hostA.querySelectorAll('.stage-drawer-tab-name')].find((x) => x.textContent.trim() === "Inspector"); e?.click(); return true; })()`);
      await b.rest(150);
      const row2 = await A(`(() => { const r = p.hostA.querySelector('.object-row[data-id="b2"] .row-main').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; })()`);
      await b.click(row2.x, row2.y);
      await soon(`!!__p.hostA.querySelector('.inspector-body .behaviour[data-trait="arena.target"] .behaviour-remove')`, 2000);
      // (the block's Carryable card above it now: bring it into view)
      await A(`(() => { const e = [...p.hostA.querySelectorAll('.stage-drawer-tab-name')].find((x) => x.textContent.trim() === "Inspector"); e?.click(); return true; })()`);
      await b.rest(150);
      await A(`p.hostA.querySelector('.inspector-body .behaviour[data-trait="arena.target"] .behaviour-remove').scrollIntoView({ block: "center" })`);
      const x = await A(`p.rect('.inspector-body .behaviour[data-trait="arena.target"] .behaviour-remove')`);
      if (x) await b.click(x.x + x.w / 2, x.y + x.h / 2);
      const gone = (await obj("b2"))?.traits?.["arena.target"] === undefined;
      const stopped = await soon(`!__p.running().includes("arena") && !__p.running(__p.B).includes("arena")`, 8000);
      check("removeBehaviourStopsArena", !!x && gone && stopped && !(await A(`!!p.hostA.querySelector('.inspector-body .behaviour[data-trait="arena.target"]')`)), { x, gone, stopped, running: await P("running()") });
    }
  }

  // ── the drawer's grip (HISTORY.md, TOOLS Decisions 9): a drag widens the shown kind, the canvas gives the room, the
  // selection stays; an editor's pane has its own width; a double-click gives the default back; a narrow stage
  // clamps a stored width without forgetting it; opening the scene again remembers it ──
  {
    const R = () => A(`({ drawer: p.rect('.stage-drawer'), canvas: p.rect('canvas'), stage: p.rect('.scene-stage'), grip: p.rect('.stage-drawer-grip'),
      kind: p.hostA.querySelector('.stage-drawer')?.dataset.kind ?? null, rows: p.hostA.querySelectorAll('.stage-drawer .object-row').length,
      prefs: JSON.parse(localStorage.getItem('scene-prefs:' + window.sceneHandle.url) ?? '{}'), locked: !!document.pointerLockElement })`);
    const tab = (name) => A(`(() => { const e = [...p.hostA.querySelectorAll('.stage-drawer-tab-name')].find((x) => x.textContent.trim() === ${JSON.stringify(name)}); e?.click(); return !!e; })()`);
    const near1 = (a, c, eps = 2) => Math.abs(a - c) <= eps;
    const gripAt = (g) => [g.x + g.w / 2, g.y + g.h / 2];
    // the Inspector shown (the stage's chrome), Block 1 selected
    if (!(await tab("Inspector"))) await A(`(() => { [...p.hostA.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === "Inspector").click(); return true; })()`);
    await A(`(p.A.view.atom.swap((m) => ({ ...m, selected: Object.freeze(["b0"]) })), true)`);
    await b.rest(200);
    await tab("Inspector");
    await b.rest(150);
    const r0 = await R();
    const sel0 = await selected();
    check("gripOnTheDrawersEdge", r0.grip && r0.kind === "chrome" && r0.grip.x >= r0.drawer.x - 1.5 && r0.grip.x + r0.grip.w <= r0.drawer.x + 8 && near1(r0.drawer.w, 290), r0);
    const [gx, gy] = gripAt(r0.grip);
    await b.drag([gx, gy], [gx - 200, gy], { steps: 10 });
    const r1 = await R();
    check("gripDragWidensTheDrawer", near1(r1.drawer.w, r0.drawer.w + 200) && near1(r1.canvas.w, r0.canvas.w - 200) && near1(r1.canvas.x + r1.canvas.w, r1.drawer.x, 1) && r1.rows > 0, { before: r0, after: r1 });
    check("gripDragStoresTheChromeWidth", near1(r1.prefs["drawer.chrome"], r0.drawer.w + 200) && !("drawer.editor" in r1.prefs), r1.prefs);
    check("gripDragSelectsNothingLocksNothing", (await selected()) === sel0 && sel0 === "b0" && !r1.locked, { sel0, now: await selected(), locked: r1.locked });
    // the grip's keys: ArrowLeft widens by 16
    await A(`(p.hostA.querySelector('.stage-drawer-grip').focus(), true)`);
    await b.key("ArrowLeft");
    const rk = await R();
    check("gripArrowLeftWidens16", near1(rk.drawer.w, r1.drawer.w + 16) && near1(rk.prefs["drawer.chrome"], r1.drawer.w + 16) && (await selected()) === "b0", { before: r1.drawer.w, after: rk.drawer.w, prefs: rk.prefs });
    await shot("9-grip-wide");
    // an editor's pane: its own width (the editor default, 46% of the stage), set apart from the chrome's
    await A(`(() => { const el = document.createElement("div"); el.textContent = "An editor"; el.className = "probe-editor"; p.closeEditor = p.A.host.record("scene.select").api.dock(el, { title: "Editor" }); return true; })()`);
    await b.rest(150);
    const re = await R();
    check("editorPaneHasItsOwnDefault", re.kind === "editor" && near1(re.drawer.w, 0.46 * re.stage.w), re);
    const [ex, ey] = gripAt(re.grip);
    await b.drag([ex, ey], [ex - 100, ey], { steps: 6 });
    const re2 = await R();
    check("editorWidthIsItsOwn", near1(re2.drawer.w, re.drawer.w + 100) && near1(re2.prefs["drawer.editor"], re.drawer.w + 100) && near1(re2.prefs["drawer.chrome"], rk.drawer.w), re2);
    await tab("Inspector");
    await b.rest(150);
    const rc = await R();
    check("switchingKindsSwitchesWidths", rc.kind === "chrome" && near1(rc.drawer.w, rk.drawer.w), { chrome: rc.drawer.w, want: rk.drawer.w });
    // a double-click: the chrome's default back, the editor's kept
    const [dx, dy] = gripAt(rc.grip);
    await b.dblclick(dx, dy);
    await b.rest(150);
    const rd = await R();
    check("doubleClickGivesTheDefaultBack", near1(rd.drawer.w, 290) && !("drawer.chrome" in rd.prefs) && "drawer.editor" in rd.prefs && (await selected()) === "b0", rd);
    // set it again, then a narrow stage: at most 70% of it, and the stored width back when it grows
    await b.drag(gripAt(rd.grip), [gripAt(rd.grip)[0] - 300, gripAt(rd.grip)[1]], { steps: 8 });
    const rw = await R();
    await A(`(p.hostA.style.width = "600px", true)`);
    await b.rest(250);
    const rn = await R();
    check("narrowStageClampsTheDrawer", rn.drawer.w <= 0.7 * rn.stage.w + 1 && rn.canvas.w >= 0.3 * rn.stage.w - 1 && rn.prefs["drawer.chrome"] === rw.prefs["drawer.chrome"], { stored: rw.prefs, narrow: rn });
    await A(`(p.hostA.style.width = "", true)`);
    await b.rest(250);
    const rg = await R();
    check("widerAgainTheStoredWidthReturns", near1(rg.drawer.w, rw.drawer.w) && near1(rw.drawer.w, rw.prefs["drawer.chrome"]), { stored: rw.prefs["drawer.chrome"], back: rg.drawer.w });
    // opened again (as a reload would): the stored widths are read back
    await A(`(p.closeEditor?.(), true)`);
    await P("remountA()");
    await b.rest(400);
    await A(`(() => { [...p.hostA.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === "Inspector").click(); return true; })()`);
    await b.rest(300);
    const rr = await R();
    check("openedAgainTheWidthIsRemembered", rr.kind === "chrome" && near1(rr.drawer.w, rw.drawer.w), { stored: rw.prefs["drawer.chrome"], now: rr.drawer.w });
    report.grip = { r0: r0.drawer.w, dragged: r1.drawer.w, key: rk.drawer.w, editor: [re.drawer.w, re2.drawer.w], reset: rd.drawer.w, set: rw.drawer.w, narrow: [rn.drawer.w, rn.stage.w], back: rg.drawer.w, reopened: rr.drawer.w };
    await shot("10-grip-reopened");
  }

  // ── a tall tree: at most ~40% of the pane, scrolling under its bar; a selection deep in it is revealed, and again on opening
  {
    await b.js(`(window.sceneHandle.change((d) => { for (let i = 0; i < 70; i++) { const id = "tall" + i; d.objects[id] = { kind: "group", name: "Tall " + i, group: null, visible: true, opacity: 1 }; d.order.push(id); } }), true)`);
    await b.rest(300);
    const T = (id = "tall69") => A(`(() => {
      const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { y: b.y, h: b.height, b: b.bottom }; };
      const h = p.hostA, tree = h.querySelector('.stage-drawer .inspector-tree'), list = tree?.querySelector('.object-list');
      return { open: !!h.querySelector('.stage-drawer [data-panel="inspector"]'), pane: r(h.querySelector('.stage-drawer [data-panel="inspector"]')), tree: r(tree), fields: r(h.querySelector('.stage-drawer .inspector-body')),
        bar: r(h.querySelector('.inspector-tree .outline-bar')), row: r(h.querySelector('.inspector-tree .object-row[data-id="${id}"]')), scrollTop: list?.scrollTop ?? null, scrollH: list?.scrollHeight ?? null };
    })()`);
    // in view: inside the tree and below its bar (the rows scroll under nothing)
    const inView = (t) => !!t.row && !!t.bar && t.row.y >= t.bar.b - 1 && t.row.b <= t.tree.b + 1;
    const t0 = await T();
    check("tallTreeCappedAt40", t0.open && t0.tree.h <= 0.4 * t0.pane.h + 2 && t0.tree.h >= 0.38 * t0.pane.h && t0.fields.h >= 0.55 * t0.pane.h && t0.scrollH > t0.tree.h + 100, t0);
    // the last group, below the tree's fold, selected elsewhere (as a click in the view would): its rows scrolled to it, the bar still on top
    await A(`(p.A.host.record("scene.inspector").api.view.select("tall69"), true)`);
    await b.rest(300);
    const t1 = await T();
    check("tallTreeRevealsTheSelection", inView(t1) && t1.scrollTop > 0, t1);
    check("tallTreeBarStaysOnTop", !!t1.bar && Math.abs(t1.bar.y - t1.tree.y) <= 1, t1);
    // back up to the first row: scrolled into view below the bar, not under it
    await A(`(p.A.host.record("scene.inspector").api.view.select("board"), true)`);
    await b.rest(300);
    const tUp = await T("board");
    check("tallTreeRowUpTopIsBelowTheBar", inView(tUp) && tUp.scrollTop < t1.scrollTop, tUp);
    await A(`(p.A.host.record("scene.inspector").api.view.select("tall69"), true)`);
    await b.rest(300);
    // × and the toolbar's Inspector: the same selection, revealed again in the reopened pane
    await A(`(() => { [...p.hostA.querySelectorAll('.stage-drawer-tab')].find((t) => t.textContent.includes("Inspector"))?.querySelector('.stage-drawer-tab-close')?.click(); return true; })()`);
    await b.rest(200);
    const shut = await T();
    await A(`(() => { [...p.hostA.querySelectorAll('.toolbar button')].find((x) => x.textContent.trim() === "Inspector").click(); return true; })()`);
    await b.rest(300);
    const t2 = await T();
    check("tallTreeRevealedAgainOnOpening", !shut.open && t2.open && inView(t2), { shut: shut.open, t2 });
    report.tallTree = { capped: t0, revealed: t1, up: tUp, reopened: t2 };
    await shot("11-tall-tree");
  }

  report.errors = (await P("errors")).filter((e) => !/KHR_parallel_shader_compile/.test(e));
  check("noErrors", !report.errors.length, report.errors);
} catch (err) {
  check("fatal", false, String(err?.stack || err));
}
report.logs = b.logs.filter((l) => !/KHR_parallel_shader_compile/.test(l)).slice(-20);
report.ok = Object.values(checks).every(Boolean);
report.frames = await b.js("window.__time?.frames() ?? null").catch(() => null); // of the page's clock
console.log(JSON.stringify(report, null, 2));
b.stop(report.ok ? 0 : 1);
