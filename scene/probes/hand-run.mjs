// The hand, with a real mouse, in headless Chrome: two peers on one scene, a
// locked board with snap points (extras.snapPoints), blocks and pawns.
//
//   pnpm build
//   node probes/hand-run.mjs [--port 4602] [--cdp 9602] [--show] [--shots <dir>]
//
// Carries a block onto a space (it snaps and rests on the board; the other
// peer sees it in the air, then where it landed), stacks two more on it,
// puts a pawn down freely with Alt, one on the table off the board, drags the
// locked board (it orbits instead) and cancels a carry with Esc. Then a scene
// extension (the probe page's own, on STAGE.md's contract): its lens shows a
// card in the tray to whoever sits there and its back to everyone else, its S
// command shuffles the pile under the pointer, a face-down card picked up,
// flipped (F) and put down shows its face to both, and its landing hook turns
// a card drawn into the tray face up. Last, the gizmo: a real drag on its X
// arrow (B sees the pose before the doc changes), and on a group's pivot
// (both members move). Prints a JSON report; exits non-zero on a failure.
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
const PORT = Number(arg("port", 4602));
const CDP = Number(arg("cdp", 9602));
if ([9222, 9333, 9334].includes(CDP)) throw new Error(`--cdp ${CDP} is reserved`);
const SHOTS = resolve(arg("shots", join(process.env.TMPDIR || tmpdir(), "scene-hand-shots")));
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (!existsSync(join(root, "dist/index.js"))) throw new Error("no dist/: run pnpm build first");

const b = await browser({ root, port: PORT, cdp: CDP, page: "/probes/hand-probe.html", show: !!arg("show", false), timeout: 240_000 });
const { check, checks, details } = checklist();
const report = { checks, details, shots: [] };
const T = (e) => b.js(`window.__table.${e}`);
const near = (a, c, tol = 1e-3) => Array.isArray(a) && a.every((v, i) => Math.abs(v - c[i]) <= tol);
const shot = async (name) => report.shots.push(await b.shot(join(SHOTS, `hand-${name}.png`)));
/** press at `from`, move to `to`, maybe do something, release */
const carry = (from, to, opts = {}) => b.drag(from, to, { steps: 12, ...opts });

/** Hover outwards from the gizmo's centre along world +X until its X arrow lights up. */
async function gizmoHandle() {
  const g = await T("gizmo()");
  if (!g) return null;
  const c0 = await T(`screen(${JSON.stringify(g.at)})`);
  const c1 = await T(`screen(${JSON.stringify([g.at[0] + 0.05, g.at[1], g.at[2]])})`);
  const len = Math.hypot(c1[0] - c0[0], c1[1] - c0[1]);
  const u = [(c1[0] - c0[0]) / len, (c1[1] - c0[1]) / len];
  for (let s = 20; s <= 160; s += 6) {
    const x = c0[0] + u[0] * s, y = c0[1] + u[1] * s;
    await b.move(x, y);
    await sleep(30);
    if ((await T("gizmo()"))?.axis === "X") return { at: [x, y], u };
  }
  return null;
}

try {
  if (!(await b.waitFor("window.__ready", 30_000))) throw new Error("page never ready");
  check("no setup errors", (await T("errors")).length === 0, await T("errors"));
  check("every piece loaded in both views", await b.waitFor(`(() => { const l = window.__table.loaded(); return l[0] === window.__table.total && l[1] === window.__table.total; })()`, 20_000), await T("loaded()"));
  await sleep(400);
  const l1 = await T('id("Block 1")'), l2 = await T('id("Block 2")'), dome = await T('id("Block 3")'), w = await T('id("Pawn 1")'), board = await T('id("Board")');

  // 1. a block onto the centre space, released a little off-centre
  const midB = await carry(await T(`top("${l1}")`), await T("screen([0.012, 0.04, -0.008])"), {
    beforeRelease: async () => {
      await sleep(150);
      return T(`worldB("${l1}")`);
    },
  });
  const p1 = await T(`pos("${l1}")`);
  check("block snaps to the centre space, on the board", near(p1, [0, 0.04, 0]), p1);
  check("while carried, the other peer sees it in the air", midB && midB[1] > 0.04, midB);
  await sleep(300);
  check("other peer shows it where it landed", near(await T(`worldB("${l1}")`), [0, 0.04, 0]), await T(`worldB("${l1}")`));

  // 2. another onto the same space: it stacks
  await carry(await T(`top("${l2}")`), await T("screen([-0.01, 0.072, 0.01])"));
  const p2 = await T(`pos("${l2}")`);
  check("a second block stacks on the first", near(p2, [0, 0.072, 0]), p2);

  // 3. and a third on that
  await carry(await T(`top("${dome}")`), await T("screen([0.005, 0.104, 0])"));
  const p3 = await T(`pos("${dome}")`);
  check("a third stacks on that", near(p3, [0, 0.104, 0]), p3);
  await shot("1-stacked");

  // 4. a pawn held with Alt: put down where dropped, not snapped
  const target4 = [0.075, 0.04, 0.05];
  await carry(await T(`top("${w}")`), await T(`screen(${JSON.stringify(target4)})`), { mods: ["alt"] });
  const p4 = await T(`pos("${w}")`);
  check("alt places freely where dropped (not on a space centre), resting on the board", near(p4, target4, 0.004) && Math.abs(p4[0] - 0.06) > 0.005, p4);

  // 5. a pawn off the board: on the table, unsnapped
  const w2 = await T('id("Pawn 2")');
  await carry(await T(`top("${w2}")`), await T("screen([0.1, 0, 0.38])"));
  const p5 = await T(`pos("${w2}")`);
  check("off the board it rests on the table", Math.abs(p5[1]) < 1e-3 && p5[2] > 0.3, p5);

  // 6. dragging the board orbits instead (it's locked)
  const cam0 = await T("camera()");
  const bp0 = await T(`pos("${board}")`);
  const corner = await T("screen([0.15, 0.03, 0.15])");
  await carry(corner, [corner[0] - 150, corner[1] - 30]);
  const cam1 = await T("camera()");
  check("locked board doesn't move", near(await T(`pos("${board}")`), bp0));
  check("dragging it orbits instead", !near(cam0.position, cam1.position, 1e-4), { cam0, cam1 });

  // 7. Esc cancels a carry
  const l4 = await T('id("Block 4")');
  const before7 = await T(`pos("${l4}")`);
  const s7 = await T(`top("${l4}")`);
  const mid7 = await carry(s7, [s7[0] - 120, s7[1] + 40], {
    beforeRelease: async () => {
      await b.key("Escape");
      return T(`A.viewport.worldOf("${l4}").slice(12, 15)`);
    },
  });
  check("Esc puts it back", near(await T(`pos("${l4}")`), before7) && near(mid7, before7, 1e-5), { doc: await T(`pos("${l4}")`), shownAfterEsc: mid7 });

  // 8. hidden objects
  const settle = () => b.waitFor("window.__table.settled()", 5000, 30);
  const look = (who, id) => T(`look("${who}", "${id}")`);
  await settle();
  check("seated nowhere, both see backs", [await look("a", "inTray"), await look("b", "inTray"), await look("a", "faceDown"), await look("b", "faceDown")].every((x) => x === "back"));
  check("an extension's panel is in the sidebar", (await T('panel("a")'))?.includes("probe panel"), await T('panel("a")'));
  await T('sit("a")');
  await sleep(100);
  await settle();
  check("sitting in seat 1, A sees the card in its tray; B doesn't", (await look("a", "inTray")) === "face" && (await look("b", "inTray")) === "back", [await look("a", "inTray"), await look("b", "inTray")]);
  check("a face-down card stays hidden from both", (await look("a", "faceDown")) === "back" && (await look("b", "faceDown")) === "back");

  // S over a pile shuffles it: the two cards' secrets trade places
  const before8 = await T("secretNames()");
  const pile = await T("hover('faceDown')");
  await b.move(pile[0], pile[1]);
  await sleep(300);
  await b.key("s");
  await sleep(200);
  const names = await T("secretNames()");
  check("S shuffles the pile under the pointer (2 cards), through its command", /Shuffling 2 cards/.test(await T("toast()")) && names.faceDown === before8.under && names.under === before8.faceDown, { toast: await T("toast()"), names, before8 });

  // flipped (F) while carried
  await carry(await T('top("faceDown")'), await T("screen([0.25, 0, 0.05])"), { beforeRelease: () => b.key("f") });
  await settle();
  check("flipped (F) while carried and put down, it is face up", Math.abs((await T('rot("faceDown")'))[2]) < 1e-3, await T('rot("faceDown")'));
  check("and both see its face", (await look("a", "faceDown")) === "face" && (await look("b", "faceDown")) === "face", [await look("a", "faceDown"), await look("b", "faceDown")]);

  // drawing: a face-down card carried into your own tray turns face up for you, and stays hidden from B
  await carry(await T('top("under")'), await T("screen([-0.18, 0.002, 0.25])"));
  await settle();
  check("drawn into your tray, a face-down card lands face up", Math.abs((await T('rot("under")'))[2]) < 1e-3, await T('rot("under")'));
  check("and A sees it, B doesn't", (await look("a", "under")) === "face" && (await look("b", "under")) === "back", [await look("a", "under"), await look("b", "under")]);
  await shot("2-cards");

  // 9. the gizmo, with a real drag on its X arrow: B sees the pose before the doc changes
  await b.key("g");
  const r4 = await T(`row("${l4}")`);
  await b.click(r4[0], r4[1]);
  await sleep(150);
  const h = await gizmoHandle();
  check("the move gizmo is on the selection, and its X arrow is found by hovering", !!h && (await T("gizmo()"))?.target?.id === l4, await T("gizmo()"));
  if (h) {
    const was = (await T(`pos("${l4}")`))[0];
    const mid = await b.drag(h.at, [h.at[0] + h.u[0] * 80, h.at[1] + h.u[1] * 80], {
      beforeRelease: async () => {
        await sleep(200);
        return { doc: (await T(`pos("${l4}")`))[0], b: (await T(`worldB("${l4}")`))[0] };
      },
    });
    const after = (await T(`pos("${l4}")`))[0];
    await sleep(300);
    const bAfter = (await T(`worldB("${l4}")`))[0];
    check("while the gizmo drags it, the other peer sees it move (the doc doesn't yet)", Math.abs(mid.doc - was) < 1e-9 && mid.b - was > 0.01, { was, mid });
    check("let go, it's written, and the other peer shows the doc's pose", after - was > 0.01 && Math.abs(bAfter - after) < 1e-6, { was, after, bAfter });
  }

  // 10. a group moves what's in it: the gizmo holds its pivot, and both pawns move with it
  const [g0, g1] = await T("groupPawns()");
  await sleep(200);
  const rg = await T(`row("pawns")`);
  await b.click(rg[0], rg[1]);
  await sleep(150);
  const hg = await gizmoHandle();
  check("a selected group gets the move gizmo, on its pivot", !!hg && (await T("gizmo()"))?.target?.kind === "group", await T("gizmo()"));
  if (hg) {
    const before = [await T(`pos("${g0}")`), await T(`pos("${g1}")`)];
    await b.drag(hg.at, [hg.at[0] + hg.u[0] * 80, hg.at[1] + hg.u[1] * 80]);
    const after = [await T(`pos("${g0}")`), await T(`pos("${g1}")`)];
    const dx = after.map((p, i) => p[0] - before[i][0]);
    check("moving the group moves both pawns by the same amount", dx[0] > 0.01 && Math.abs(dx[0] - dx[1]) < 1e-6 && after.every((p, i) => Math.abs(p[2] - before[i][2]) < 1e-6 && Math.abs(p[1] - before[i][1]) < 1e-6), { before, after });
  }
  await shot("3-end");
  const errs = (await T("errors")).filter((e) => !/KHR_parallel_shader_compile/.test(e));
  check("no errors", !errs.length, errs);
} catch (err) {
  check("ran", false, String(err?.stack || err));
}
report.logs = b.logs.filter((l) => !/KHR_parallel_shader_compile/.test(l)).slice(-20);
report.ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify(report, null, 2));
b.stop(report.ok ? 0 : 1);
