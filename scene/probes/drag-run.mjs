// Real drags into and within the scene outline, in headless Chrome.
//
//   pnpm build
//   node probes/drag-run.mjs [--port 4480] [--cdp 9480] [--show]
//
// Serves the package root, opens probes/drag-probe.html (the BUILT tool, an
// in-memory repo, a fake sidebar with the Patchwork sidebar's drag payload),
// and moves a real mouse over CDP. Input.setInterceptDrags hands back the drag
// data Chrome collected from the page's own dragstart, and dispatchDragEvent
// plays it at real coordinates, so dragenter / dragover / dragleave / drop
// fire on whatever element really is there, at the rows' real heights.
// Prints a JSON report; exits non-zero if any check fails.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []),
);
const PORT = Number(args.port ?? 4480);
// Clear of 9222 and of 9333/9334, which long-lived Chromes on this machine use.
const CDP = Number(args.cdp ?? 9480);
if ([9222, 9333, 9334].includes(CDP)) throw new Error(`--cdp ${CDP} is reserved`);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
if (!existsSync(join(root, "dist/index.js"))) throw new Error("no dist/: run pnpm build first");

const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scene-drag-"));
const chrome = spawn(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [args.show ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP}`,
   "--window-size=1400,800", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"].filter(Boolean),
  { stdio: "ignore" },
);
let finished = false;
const stop = (code) => {
  if (finished) return;
  finished = true;
  try { chrome.kill(); } catch {}
  server.close();
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(code); }, 300);
};
const watchdog = setTimeout(() => { console.error("TIMEOUT"); stop(2); }, 120_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 100 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
  if (!target) await sleep(100);
}
if (!target) { console.error("no page target"); stop(1); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
const waiters = new Map();
const logs = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method && waiters.has(msg.method)) { waiters.get(msg.method)(msg.params); waiters.delete(msg.method); }
  if (msg.method === "Runtime.consoleAPICalled") logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (msg.method === "Runtime.exceptionThrown") logs.push(`exception: ${msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text}`);
});
const send = (method, params = {}) => new Promise((r, no) => {
  const i = ++seq;
  pending.set(i, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : r(m.result)));
  ws.send(JSON.stringify({ id: i, method, params }));
});
const once = (method, ms = 3000) => new Promise((r, no) => {
  waiters.set(method, r);
  setTimeout(() => { if (waiters.delete(method)) no(new Error(`no ${method} within ${ms} ms`)); }, ms);
});
const js = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`${expr}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result?.value;
};
const P = (expr) => js(`window.__dragProbe.${expr}`);

const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });

/**
 * Press on (sx, sy), move until Chrome starts a drag, then play that drag along
 * `path` (a list of [x, y]) and `end` it: "drop" at the last point, or "cancel".
 * `during(x, y)` runs after each dragOver, for reading the indicator.
 */
async function drag(sx, sy, path, { end = "drop", during = null } = {}) {
  await mouse("mouseMoved", sx, sy, { buttons: 0 });
  const intercepted = once("Input.dragIntercepted");
  await mouse("mousePressed", sx, sy);
  for (let i = 1; i <= 6; i++) await mouse("mouseMoved", sx + i * 2, sy + i);
  const { data } = await intercepted;
  const types = data.items.map((it) => it.mimeType);
  const [fx, fy] = path[0];
  await send("Input.dispatchDragEvent", { type: "dragEnter", x: fx, y: fy, data });
  const seen = [];
  for (const [x, y] of path) {
    // Twice: on the update that crosses into a new element Blink fires only
    // dragenter / dragleave, and dragover on the next one. A real drag keeps
    // sending updates while the pointer rests, so it never sees the gap.
    await send("Input.dispatchDragEvent", { type: "dragOver", x, y, data });
    await send("Input.dispatchDragEvent", { type: "dragOver", x, y, data });
    await sleep(16);
    if (during) seen.push(await during(x, y));
  }
  const [lx, ly] = path.at(-1);
  if (end === "drop") await send("Input.dispatchDragEvent", { type: "drop", x: lx, y: ly, data });
  else await send("Input.dispatchDragEvent", { type: "dragCancel", x: lx, y: ly, data });
  await mouse("mouseReleased", lx, ly);
  await sleep(150);
  return { types, seen };
}

/** A path from a point to (x, y) in a few steps, so the pointer really travels. */
const towards = ([ax, ay], [bx, by], n = 6) => Array.from({ length: n }, (_, i) => [ax + ((bx - ax) * (i + 1)) / n, ay + ((by - ay) * (i + 1)) / n]);
/** A point a fraction of the way down a row, a little in from the name's left. */
const at = (r, f) => [r.li.x + 120, r.li.y + r.li.h * f];
const center = (b) => [b.x + b.w / 2, b.y + b.h / 2];

const checks = {};
const report = { checks, steps: {} };
let failed = false;
const check = (name, ok, detail) => {
  checks[name] = !!ok;
  if (!ok) failed = true;
  if (detail !== undefined) report.steps[name] = detail;
};

try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/probes/drag-probe.html` });
  for (let i = 0; i < 200; i++) { if (await js("!!window.__dragProbe")) break; await sleep(50); }
  const fatal = await js("window.__dragProbe?.fatal ?? null");
  if (fatal) throw new Error(fatal);
  await sleep(300);
  await send("Input.setInterceptDrags", { enabled: true });
  report.outlineBefore = await P("outline()");
  report.rowHeights = Object.fromEntries(await Promise.all(["G", "G2", "L1"].map(async (id) => [id, (await P(`row("${id}")`)).li.h])));

  // 1. A sidebar document dragged across the viewport and onto group G's middle.
  {
    const src = center(await P(`sidebarItem("cube.stl")`));
    const vp = center(await P("viewport()"));
    const g = await P(`row("G")`);
    const into = at(g, 0.5);
    let hintOverViewport = null;
    const { types, seen } = await drag(src[0], src[1], [...towards(src, vp, 4), ...towards(vp, into, 6)], {
      during: async () => ({ hint: await P("hintHidden()"), mark: await P("mark()") }),
    });
    hintOverViewport = seen[3]?.hint === false;
    await sleep(400);
    const d = await P("doc()");
    const added = Object.keys(d.objects).find((id) => !["G", "G2", "L1", "L2", "L3"].includes(id));
    check("sidebarDropLandsInGroup", added && d.objects[added].parent === "G", {
      dragTypes: types,
      markOverG: seen.at(-1)?.mark,
      added: added && { name: d.objects[added].name, parent: d.objects[added].parent, providerId: d.objects[added].providerId },
    });
    check("hintShownOverViewport", hintOverViewport);
    check("hintDownAfterTreeDrop", await P("hintHidden()"));
    check("indicatorIntoGroup", JSON.stringify(seen.at(-1)?.mark) === JSON.stringify({ id: "G", drop: "into" }));
    report.addedId = added;
  }

  // 2. A sidebar drag that only passes through the tool and is cancelled must
  //    not leave the whole-tool hint up (the tree drop above stopped propagation).
  {
    const src = center(await P(`sidebarItem("cube.stl")`));
    const vp = center(await P("viewport()"));
    const { seen } = await drag(src[0], src[1], [...towards(src, vp, 4), ...towards(vp, src, 4)], {
      end: "cancel",
      during: async () => P("hintHidden()"),
    });
    check("hintDownAfterPassThroughDrag", await P("hintHidden()"), { hiddenAlongPath: seen });
  }

  // 3. Reorder: drag L3 by its name onto the top half of L1.
  {
    const l3 = await P(`row("L3")`);
    const l1 = await P(`row("L1")`);
    const before = (await P("doc()")).objects.L3.transform;
    const dest = at(l1, 0.25);
    const { seen, types } = await drag(l3.main.x + 10, l3.main.y + l3.main.h / 2, towards(center(l3.li), dest, 5), { during: async () => P("mark()") });
    const d = await P("doc()");
    const roots = d.order.filter((id) => (d.objects[id]?.parent ?? null) === null);
    check("rowReorders", roots.indexOf("L3") === roots.indexOf("L1") - 1, { roots, mark: seen.at(-1), dragTypes: types });
    check("indicatorBeforeRow", JSON.stringify(seen.at(-1)) === JSON.stringify({ id: "L1", drop: "before" }));
    check("reorderKeepsTransform", JSON.stringify(d.objects.L3.transform) === JSON.stringify(before));
  }

  // 4. A row released on itself writes nothing.
  {
    const l1 = await P(`row("L1")`);
    const heads = await P("heads()");
    await drag(l1.main.x + 10, l1.main.y + l1.main.h / 2, [at(l1, 0.3), at(l1, 0.2)]);
    check("selfDropWritesNothing", (await P("heads()")) === heads);
  }

  // 5. Reparent: drag L2 (world x=3) into G (x=1, scale 2): local x=1, scale 0.5.
  {
    const l2 = await P(`row("L2")`);
    const g = await P(`row("G")`);
    const { seen } = await drag(l2.main.x + 10, l2.main.y + l2.main.h / 2, towards(center(l2.li), at(g, 0.5), 6), { during: async () => P("marks()") });
    const o = (await P("doc()")).objects.L2;
    check("indicatorFollowsPointer", JSON.stringify(seen.at(-1)) === JSON.stringify(["G:into"]) && seen.every((m) => m.length <= 1));
    check("rowReparentsIntoGroup", o.parent === "G" && Math.abs(o.transform.position[0] - 1) < 1e-6 && Math.abs(o.transform.scale - 0.5) < 1e-6, {
      marksAlongPath: seen,
      parent: o.parent,
      transform: o.transform,
    });
  }

  // 6. A cycle: G dragged into its own child G2 is refused and changes nothing.
  {
    await P("clearToast()");
    const g = await P(`row("G")`);
    const g2 = await P(`row("G2")`);
    const heads = await P("heads()");
    const { seen } = await drag(g.main.x + 10, g.main.y + g.main.h / 2, towards(center(g.li), at(g2, 0.5), 5), { during: async () => P("mark()") });
    check("cycleRefused", (await P("heads()")) === heads && (await P("doc()")).objects.G.parent == null, { mark: seen.at(-1), toast: await P("toast()") });
    check("indicatorIntoChildGroup", JSON.stringify(seen.at(-1)) === JSON.stringify({ id: "G2", drop: "into" }));
    check("cycleToast", /inside itself/.test((await P("toast()")) ?? ""));
  }

  report.outlineAfter = await P("outline()");
  report.errors = await P("errors");
} catch (err) {
  failed = true;
  report.fatal = String(err?.stack || err);
}
report.ok = !failed;
report.logs = logs.filter((l) => !/KHR_parallel_shader_compile/.test(l)).slice(-20);
console.log(JSON.stringify(report, null, 2));
clearTimeout(watchdog);
ws.close();
stop(failed ? 1 : 0);
