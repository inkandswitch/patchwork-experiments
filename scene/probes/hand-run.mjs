// The hand, with a real mouse, in headless Chrome: two peers on one scene, a
// locked board with snap points (extras.snapPoints), blocks and pawns.
//
//   pnpm build
//   node probes/hand-run.mjs [--show]
//
// Carries a block onto a space (it snaps and rests on the board; the other
// peer sees it in the air, then where it landed), stacks two more on it,
// puts a pawn down freely with Alt, one on the table off the board, drags the
// locked board (it orbits instead) and cancels a carry with Esc. Then a scene
// extension (the probe page's own): its lens shows a card in the tray to
// whoever sits there and its back to everyone else, its S command shuffles a
// pile, a face-down card picked up, flipped (F) and put down shows its face to
// both, and its landing hook turns a card drawn into the tray face up. Prints a
// JSON report and a screenshot path; exits non-zero if any check fails.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(ROOT, "dist/index.js"))) throw new Error("no dist/: run pnpm build first");
const SHOW = process.argv.includes("--show");
// clear of 9222 and 9333/9334, which long-lived Chromes on this machine use
const PORT = 4492, CDP = 9492;
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const path = join(ROOT, pathname);
  if (!path.startsWith(ROOT) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scene-hand-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [SHOW ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
   "--window-size=1400,800", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"].filter(Boolean), { stdio: "ignore" });
const stop = (code) => { try { chrome.kill(); } catch {} server.close(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 300); };
setTimeout(() => { console.error("TIMEOUT"); stop(2); }, 150_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 100 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === "page"); } catch {} if (!target) await sleep(100); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map(); const logs = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails?.exception?.description}`);
});
const send = (method, params = {}) => new Promise((r, no) => { const i = ++seq; pending.set(i, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : r(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`); return r.result?.value; };
const T = (e) => js(`window.__table.${e}`);
await send("Runtime.enable");
await send("Page.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/probes/hand-probe.html` });
for (let i = 0; i < 400 && !(await js("!!window.__ready").catch(() => false)); i++) await sleep(100);

const checks = {}, report = { checks, steps: {} };
let failed = false;
const check = (name, ok, detail) => { checks[name] = !!ok; if (!ok) failed = true; if (detail !== undefined) report.steps[name] = detail; };
const MOD = { alt: 1 };
const mouse = (type, x, y, mods = 0, buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : buttons, clickCount: 1, modifiers: mods });
async function carry([sx, sy], [ex, ey], { mods = 0, steps = 12, beforeRelease } = {}) {
  await mouse("mouseMoved", sx, sy, 0, 0);
  await mouse("mousePressed", sx, sy, mods);
  for (let i = 1; i <= steps; i++) { await mouse("mouseMoved", sx + ((ex - sx) * i) / steps, sy + ((ey - sy) * i) / steps, mods); await sleep(16); }
  const mid = beforeRelease ? await beforeRelease() : null;
  await mouse("mouseReleased", ex, ey, mods);
  await sleep(250);
  return mid;
}
const near = (a, b, tol = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

try {
  check("no setup errors", (await T("errors")).length === 0, await T("errors"));
  check("every piece loaded in both views", (await T("loaded()")).every((n) => n > 0) && (await T("loaded()"))[0] === (await T("total")), await T("loaded()"));
  const l1 = await T('id("Block 1")'), l2 = await T('id("Block 2")'), dome = await T('id("Block 3")'), w = await T('id("Pawn 1")'), board = await T('id("Board")');

  // 1. a level 1 block onto the centre space, released a little off-centre
  const to = await T("screen([0.012, 0.04, -0.008])");
  const midB = await carry(await T(`top("${l1}")`), to, { beforeRelease: () => js(`[window.__table.carrying(), window.__table.worldB("${l1}")]`) });
  const p1 = await T(`pos("${l1}")`);
  check("block snaps to the centre space, on the board", near(p1, [0, 0.04, 0]), p1);
  check("while carried, the other peer sees it in the air", midB[0] === l1 && midB[1][1] > 0.04, midB);
  await sleep(300);
  check("other peer shows it where it landed", near(await T(`worldB("${l1}")`), [0, 0.04, 0]), await T(`worldB("${l1}")`));

  // 2. a level 2 onto the same space: it stacks
  await carry(await T(`top("${l2}")`), await T("screen([-0.01, 0.072, 0.01])"));
  const p2 = await T(`pos("${l2}")`);
  check("a second block stacks on the first", near(p2, [0, 0.072, 0]), p2);

  // 3. a dome on top of that
  await carry(await T(`top("${dome}")`), await T("screen([0.005, 0.104, 0])"));
  const p3 = await T(`pos("${dome}")`);
  check("a third stacks on that", near(p3, [0, 0.104, 0]), p3);

  // 4. a pawn held with Alt: put down exactly where dropped, not snapped
  const target4 = [0.075, 0.04, 0.05];
  await carry(await T(`top("${w}")`), await T(`screen(${JSON.stringify(target4)})`), { mods: MOD.alt });
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
  check("locked board doesn't move", near(await T(`pos("${board}")`), bp0));
  const cam1 = await T("camera()");
  check("dragging it orbits instead", !near(cam0.position, cam1.position, 1e-4), { cam0, cam1 });

  // 7. Esc cancels a carry
  const l1b = await T('id("Block 4")');
  const before7 = await T(`pos("${l1b}")`);
  const s7 = await T(`top("${l1b}")`);
  await mouse("mouseMoved", s7[0], s7[1], 0, 0);
  await mouse("mousePressed", s7[0], s7[1]);
  for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", s7[0] - i * 15, s7[1] + i * 5); await sleep(16); }
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await mouse("mouseReleased", s7[0] - 120, s7[1] + 40);
  await sleep(200);
  check("Esc puts it back", near(await T(`pos("${l1b}")`), before7), await T(`pos("${l1b}")`));

  // 8. hidden objects
  const settle = async () => { for (let i = 0; i < 100 && !(await T("settled()")); i++) await sleep(30); };
  const look = (who, id) => T(`look("${who}", "${id}")`);
  await settle();
  check("seated nowhere, both see backs", [await look("a", "inTray"), await look("b", "inTray"), await look("a", "faceDown"), await look("b", "faceDown")].every((x) => x === "back"));
  check("an extension's panel is in the sidebar", (await T('panel("a")'))?.includes("probe panel"), await T('panel("a")'));
  await T('sit("a")');
  await sleep(100);
  await settle();
  check("sitting in seat 1, A sees the card in its tray; B doesn't", (await look("a", "inTray")) === "face" && (await look("b", "inTray")) === "back", [await look("a", "inTray"), await look("b", "inTray")]);
  check("a face-down card stays hidden from both", (await look("a", "faceDown")) === "back" && (await look("b", "faceDown")) === "back");

  // S over a pile shuffles it through its deck: the two cards' secrets trade places, or not, at random
  const pile = await T("hover('faceDown')");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pile[0], y: pile[1], buttons: 0 });
  await sleep(300);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "s", code: "KeyS", text: "s" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "s", code: "KeyS" });
  await sleep(200);
  const names = await T("secretNames()");
  check("S shuffles the pile under the pointer (2 cards), through its deck", /Shuffling 2 cards/.test(await T("toast()")) && [names.faceDown, names.under].sort().join() === "Blue 3,Red 7", { toast: await T("toast()"), names });
  await carry(await T('top("faceDown")'), await T("screen([0.25, 0, 0.05])"), {
    beforeRelease: () => send("Input.dispatchKeyEvent", { type: "keyDown", key: "f", code: "KeyF" }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: "f", code: "KeyF" })),
  });
  await settle();
  check("flipped (F) while carried and put down, it is face up", Math.abs((await T('rot("faceDown")'))[2]) < 1e-3, await T('rot("faceDown")'));
  check("and both see its face", (await look("a", "faceDown")) === "face" && (await look("b", "faceDown")) === "face", [await look("a", "faceDown"), await look("b", "faceDown")]);

  // drawing: a face-down card carried into your own tray turns face up for you, and stays hidden from B
  await carry(await T('top("under")'), await T("screen([-0.18, 0.002, 0.25])"));
  await settle();
  check("drawn into your tray, a face-down card lands face up", Math.abs((await T('rot("under")'))[2]) < 1e-3, await T('rot("under")'));
  check("and A sees it, B doesn't", (await look("a", "under")) === "face" && (await look("b", "under")) === "back", [await look("a", "under"), await look("b", "under")]);

  // a group moves what's in it: the gizmo holds its pivot, and both pawns move with it (one change)
  const gm = await T("moveGroup(0.1)");
  check("a selected group gets the move gizmo, on its pivot", gm.held, gm);
  check("moving the group moves both pawns by the same amount", gm.after.every((p, i) => Math.abs(p[0] - gm.before[i][0] - 0.1) < 1e-6 && Math.abs(p[2] - gm.before[i][2]) < 1e-6), gm);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  report.screenshot = join(profile, "..", "scene-hand-probe.png");
  writeFileSync(report.screenshot, Buffer.from(shot.data, "base64"));
} catch (err) {
  check("ran", false, String(err?.stack || err));
}
report.logs = logs.filter((l) => !/^(debug|log)/.test(l)).slice(0, 30);
console.log(JSON.stringify(report, null, 2));
stop(failed ? 1 : 0);
