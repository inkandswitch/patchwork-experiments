// A copy of the scene package's probes/cdp.mjs (packages don't import each other).
// What the browser probes share: serve a directory, start headless Chrome
// (SwiftShader WebGL) with a debugging port, and drive one page over CDP with
// real mouse and key events. Plain node, no dependencies.
//
//   const b = await browser({ root, port, cdp, page: "/probes/editor-probe.html" });
//   await b.js("1 + 1"); await b.drag([x0, y0], [x1, y1]); await b.key("g");
//   await b.shot("/path/to.png"); b.stop(code);
//
// Simulated time (STAGE.md "Time"). A page that mounts its stages on a manual
// clock puts it at window.__time (scene's manualTime(), from
// `(await import(".../scene/dist/index.js")).loadTime()`, set as each host
// element's `time`). Nothing in those stages moves unless it is stepped, so a
// probe waits on frames, never on the wall:
//
//   await b.step(n)                      n frames back to back (only the last draws)
//   await b.advance(ms)                  as many frames as ms takes
//   await b.until(expr, { frames, what, state, draw })
//                                        frame by frame until `expr` is true; else it
//                                        throws, saying what it waited for and `state`
//   await b.soon(expr, { frames })       the same, false instead of throwing (for a check)
//   await b.rest(ms)                     ms of the page's time: frames when simulated, else a sleep
//   await b.hold(expr, ms)               real work (crypto, a build) with the world held still:
//                                        polls the wall for up to ms, a still frame (no time
//                                        passes) each time round; → its value, or false
//
// Touch (Chrome's touch emulation): `await b.touch.emulate(true)` makes the
// page a touch screen (maxTouchPoints 5, `(pointer: coarse)`); then
// `await b.touch.fingers([[id, x, y], …])` sets which fingers are down where:
// a new id presses, a moved one moves (Chrome tells them apart against the
// last call, one pointer event each), and [] lifts them all. CDP can't lift
// one finger while another stays down (a touchMove without it leaves it
// down, a touchEnd lifts every one), so dropping some is refused.
// `b.touch.tap([x, y])` is one finger down and up.
//
// key, click, drag and the rest rest() rather than sleep, and shot() draws a
// frame first. The wall is for loading and sync only: waitFor(expr, ms) polls
// on it, stepping a frame each time round when simulated (a page loading at
// the wall's pace, as it would in a browser).
import { spawn } from "node:child_process";
import { guardChrome, killChrome } from "./chrome-guard.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";

const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html", ".glb": "model/gltf-binary", ".wasm": "application/wasm" };
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// WebGL: SwiftShader (software: the same everywhere, but a few frames a second
// for a big shader), or with `gpu` the machine's own (Metal, on a Mac)
const gpuFlags = (gpu) => (gpu ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]);

/**
 * Serve `root` on `port`; POST /report resolves `reports` (for pages that post one).
 * `mounts` serves other directories under URL prefixes ({ "/camber/": dir }):
 * a probe borrowing another package's build at dev time.
 */
export async function serve(root, port, mounts = {}) {
  const reports = [];
  const server = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/report") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        reports.push(body);
        res.writeHead(204).end();
      });
      return;
    }
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const mount = Object.keys(mounts).find((prefix) => url.startsWith(prefix));
    const base = mount ? mounts[mount] : root;
    const path = join(base, mount ? url.slice(mount.length) : url);
    if (!path.startsWith(base) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    createReadStream(path).pipe(res);
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { server, reports };
}

/**
 * Serve, launch, navigate. Returns the page driver.
 * @param {{ root: string, port: number, cdp: number, page: string, width?: number, height?: number, show?: boolean, gpu?: boolean, timeout?: number, mounts?: Record<string, string> }} o
 */
export async function browser({ root, port, cdp, page, width = 1440, height = 900, show = false, gpu = false, timeout = 240_000, mounts = {} }) {
  const { server, reports } = await serve(root, port, mounts);
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "scene-probe-"));
  const chrome = spawn(
    CHROME,
    [show ? "" : "--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${cdp}`, `--window-size=${width},${height}`, ...gpuFlags(gpu), "--hide-scrollbars", "about:blank"].filter(Boolean),
    { stdio: "ignore", detached: true },
  );
  const stop = (code) => {
    killChrome(chrome);
    server.close();
    setTimeout(() => {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
      process.exit(code);
    }, 300);
  };
  // Chrome dies with this process however it ends (chrome-guard.mjs)
  guardChrome(chrome, { profile, stop });
  const timer = setTimeout(() => {
    console.error("TIMEOUT");
    stop(2);
  }, timeout);
  timer.unref?.();
  let target;
  for (let i = 0; i < 150 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json()).find((t) => t.type === "page");
    } catch {}
    if (!target) await sleep(100);
  }
  if (!target) throw new Error("Chrome didn't start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const waiters = new Map(); // CDP event → resolve, for once()
  const logs = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method && waiters.has(m.method)) {
      waiters.get(m.method)(m.params);
      waiters.delete(m.method);
    }
    if (m.method === "Runtime.consoleAPICalled") logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
  });
  const send = (method, params = {}) =>
    new Promise((r, no) => {
      const i = ++seq;
      pending.set(i, (m) => (m.error ? no(new Error(`${method}: ${m.error.message}`)) : r(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  /** The next CDP event of this kind. */
  const once = (method, ms = 3000) =>
    new Promise((r, no) => {
      waiters.set(method, r);
      setTimeout(() => {
        // only if it's still this one waiting (a later once() may have taken its place)
        if (waiters.get(method) !== r) return;
        waiters.delete(method);
        no(new Error(`no ${method} within ${ms} ms`));
      }, ms);
    });
  const js = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expr.slice(0, 200)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}${page}` });

  // ── simulated time ──
  let sim = null; // does the page run on window.__time (asked once it has one)
  const simulated = async () => sim ?? ((await js("!!window.__time").catch(() => false)) ? (sim = true) : false);
  const FRAME_MS = 1000 / 60;
  // After the frames, one of the browser's own rendering steps (a real animation frame): the drawn
  // frame presented, and layout and resize observers run, as a browser runs them after a frame. (The
  // page's clock is untouched by it; only the DOM catches up: a canvas that follows its box, say.) At
  // most 100 ms of the wall: a browser may hold its frames back (a page it thinks is hidden).
  const PRESENT = "new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 100); })";
  /** n frames of the page's clock. */
  const step = (n = 1) => js(`window.__time.step(${Math.max(0, Math.round(n))}).then(() => ${PRESENT})`);
  /** ms of the page's clock, in frames. */
  const advance = (ms) => js(`window.__time.advance(${Number(ms)}).then(() => ${PRESENT})`);
  /** ms of the page's time: frames when it is simulated, else the wall. */
  const rest = async (ms) => ((await simulated()) ? step(Math.max(1, Math.round(ms / FRAME_MS))) : sleep(ms));
  /**
   * Step until `expr` holds → its value; after `frames`, throw with `what` and `state` (an expression) in the
   * message. `draw`: each frame drawn (a condition on what's drawn, such as a label, which moves only when drawn).
   */
  const until = (expr, { frames = 600, what = expr, state = null, draw = false } = {}) =>
    js(`window.__time.until(() => (${expr}), { frames: ${Math.round(frames)}, what: ${JSON.stringify(String(what).slice(0, 300))}, state: ${state ? `() => (${state})` : "null"}, draw: ${!!draw} })`);
  /** until(), with false for a wait that runs out. */
  const soon = async (expr, { frames = 600, draw = false } = {}) => {
    try {
      return await until(expr, { frames, draw });
    } catch (err) {
      if (/after \d+ frames/.test(String(err?.message))) return false;
      throw err;
    }
  };

  const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  const modBits = (m) => (typeof m === "number" ? m : (m ?? []).reduce((a, k) => a | (MODS[k] ?? 0), 0));
  const BUTTON_BITS = { left: 1, right: 2, middle: 4 };
  const at = { x: 0, y: 0 };
  let intercepting = false; // Input.setInterceptDrags is on (htmlDrag)
  async function mouse(type, x, y, { mods = 0, button = "left", buttons, clickCount = 1 } = {}) {
    at.x = x;
    at.y = y;
    const b = buttons ?? (type === "mouseReleased" || type === "mouseMoved" ? 0 : BUTTON_BITS[button]);
    await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : button, buttons: b, clickCount, modifiers: modBits(mods) });
  }
  const KEYS = {
    Escape: { code: "Escape", vk: 27 },
    Delete: { code: "Delete", vk: 46 },
    Backspace: { code: "Backspace", vk: 8 },
    Enter: { code: "Enter", vk: 13 },
    Alt: { code: "AltLeft", vk: 18 },
    Shift: { code: "ShiftLeft", vk: 16 },
  };
  const keyInfo = (key) => KEYS[key] ?? (key.length === 1 ? { code: /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : "", vk: key.toUpperCase().charCodeAt(0), text: key } : { code: key, vk: 0 });
  // A key reaches the page as an input task of its own, which the dispatch's reply doesn't wait for: a step sent
  // straight after it could run first, and the key land a frame later in one run than in another (sailing/DESIGN.md,
  // "Determinism"). So each key waits, on the wall and stepping no frames, until the page has seen it: a count of the
  // key events the window has captured (installed by the first key). A key the page hasn't seen in 1 s is an error:
  // whatever the probe checks after it would be checking a key that never came.
  const KEYS_SEEN = "(window.__cdpKeys ??= (() => { const s = { n: 0 }; for (const t of ['keydown', 'keyup']) addEventListener(t, () => s.n++, true); return s; })()).n";
  async function keySent(params) {
    const before = await js(KEYS_SEEN);
    await send("Input.dispatchKeyEvent", params);
    for (const t0 = Date.now(); (await js(KEYS_SEEN)) <= before; await sleep(1))
      if (Date.now() - t0 > 1000) throw new Error(`the page never saw ${params.type} ${params.key} (1 s)`);
  }
  async function keyDown(key, mods = 0) {
    const k = keyInfo(key);
    await keySent({ type: k.text ? "keyDown" : "rawKeyDown", key, code: k.code, windowsVirtualKeyCode: k.vk, text: k.text, modifiers: modBits(mods) });
  }
  async function keyUp(key, mods = 0) {
    const k = keyInfo(key);
    await keySent({ type: "keyUp", key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers: modBits(mods) });
  }

  // ── touch ──
  let down = []; // the ids the last fingers() left down
  const touch = {
    /** Make the page a touch screen, or not. */
    emulate: (enabled) => send("Emulation.setTouchEmulationEnabled", { enabled, maxTouchPoints: 5 }),
    /** The fingers down now, [[id, x, y], …]: against the last call, a new id presses, a moved one moves; [] lifts all (CDP lifts none alone). */
    async fingers(points) {
      const ids = points.map(([id]) => id);
      if (ids.length && down.some((id) => !ids.includes(id))) throw new Error("CDP can't lift one finger while another stays down: lift them all ([])");
      const type = !points.length ? "touchEnd" : down.length ? "touchMove" : "touchStart";
      await send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y })) });
      down = ids;
      await rest(16);
    },
    /** One finger down and up at [x, y], with nothing else down. */
    async tap([x, y], id = 1) {
      await touch.fingers([[id, x, y]]);
      await touch.fingers([]);
      await rest(60);
    },
  };

  return {
    send,
    js,
    logs,
    reports,
    stop,
    mouse,
    keyDown,
    keyUp,
    touch,
    simulated,
    step,
    advance,
    until,
    soon,
    rest,
    /** a full key press */
    async key(key, mods = 0) {
      await keyDown(key, mods);
      await keyUp(key, mods);
      await rest(60);
    },
    async move(x, y) {
      await mouse("mouseMoved", x, y);
    },
    /** press and release in place */
    async click(x, y, { button = "left", mods = 0, clickCount = 1 } = {}) {
      await mouse("mouseMoved", x, y);
      await mouse("mousePressed", x, y, { button, mods, clickCount });
      await mouse("mouseReleased", x, y, { button, mods, clickCount });
      await rest(80);
    },
    async dblclick(x, y) {
      await mouse("mouseMoved", x, y);
      await mouse("mousePressed", x, y, { clickCount: 1 });
      await mouse("mouseReleased", x, y, { clickCount: 1 });
      await mouse("mousePressed", x, y, { clickCount: 2 });
      await mouse("mouseReleased", x, y, { clickCount: 2 });
      await rest(120);
    },
    /**
     * Press at `from`, move to `to` in steps, then (unless `hold`) release.
     * `during(i)` runs after each step; `beforeRelease()`'s value is returned.
     */
    async drag([sx, sy], [ex, ey], { mods = 0, steps = 12, button = "left", beforeRelease, settle = 250 } = {}) {
      await mouse("mouseMoved", sx, sy);
      await mouse("mousePressed", sx, sy, { mods, button });
      const bits = BUTTON_BITS[button];
      for (let i = 1; i <= steps; i++) {
        await mouse("mouseMoved", sx + ((ex - sx) * i) / steps, sy + ((ey - sy) * i) / steps, { mods, buttons: bits, button });
        await rest(16);
      }
      const mid = beforeRelease ? await beforeRelease() : null;
      await mouse("mouseReleased", ex, ey, { mods, button });
      await rest(settle);
      return mid;
    },
    /**
     * A drag the page starts itself (draggable elements, dataTransfer):
     * press on `from`, move until Chrome starts it, then play it along
     * `path` ([[x, y], …]) and drop at the last point (or `end: "cancel"`).
     * Input.setInterceptDrags hands back the data the page's dragstart set,
     * and dispatchDragEvent plays it at real coordinates, so dragover and
     * drop fire on whatever is really there. `during(x, y)` runs after each
     * step; their values are returned.
     */
    async htmlDrag([sx, sy], path, { end = "drop", during = null, mods = 0 } = {}) {
      // once, and left on: asking again leaves the next drag's start unheard
      if (!intercepting) await send("Input.setInterceptDrags", { enabled: true });
      intercepting = true;
      await mouse("mouseMoved", sx, sy);
      const intercepted = once("Input.dragIntercepted");
      await mouse("mousePressed", sx, sy);
      for (let i = 1; i <= 6; i++) await mouse("mouseMoved", sx + i * 2, sy + i, { buttons: 1 });
      const { data } = await intercepted;
      const [fx, fy] = path[0];
      await send("Input.dispatchDragEvent", { type: "dragEnter", x: fx, y: fy, data, modifiers: modBits(mods) });
      const seen = [];
      for (const [x, y] of path) {
        // twice: crossing into a new element, Blink fires only enter / leave on the first
        await send("Input.dispatchDragEvent", { type: "dragOver", x, y, data, modifiers: modBits(mods) });
        await send("Input.dispatchDragEvent", { type: "dragOver", x, y, data, modifiers: modBits(mods) });
        await rest(16);
        if (during) seen.push(await during(x, y));
      }
      const [lx, ly] = path.at(-1);
      await send("Input.dispatchDragEvent", { type: end === "drop" ? "drop" : "dragCancel", x: lx, y: ly, data, modifiers: modBits(mods) });
      await mouse("mouseReleased", lx, ly);
      await rest(150);
      return { types: data.items.map((it) => it.mimeType), seen };
    },
    async shot(path, clip) {
      if (await simulated()) await step(1); // a frame drawn: frames stepped in a wait draw nothing
      const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(r.data, "base64"));
      return path;
    },
    /**
     * Real work with the world held still (simulated pages): poll `expr` on the wall for up to ms,
     * a still frame each time round (the update flush and the loops run; no time passes, so nothing
     * moves however long the work takes). Not simulated, a waitFor.
     */
    async hold(expr, ms = 20_000, every = 40) {
      if (!(await simulated())) return this.waitFor(expr, ms, every);
      const t0 = Date.now();
      for (;;) {
        let v;
        try {
          v = await js(expr);
        } catch {
          v = false;
        }
        if (v) return v;
        if (Date.now() - t0 > ms) return false;
        await js("window.__time.step(1, { still: true })");
        await sleep(every);
      }
    },
    /** Loading and sync: poll `expr` on the wall for up to ms (a frame stepped each time round, when simulated). */
    async waitFor(expr, ms = 20_000, every = 50) {
      const t0 = Date.now();
      for (;;) {
        let v;
        try {
          v = await js(expr);
        } catch {
          v = false;
        }
        if (v) return v;
        if (Date.now() - t0 > ms) return false;
        if (await simulated()) await step(1);
        await sleep(every);
      }
    },
  };
}

/** A check list that prints as JSON and sets the exit code. */
export function checklist() {
  const checks = {};
  const details = {};
  let failed = false;
  return {
    checks,
    details,
    check(name, ok, detail) {
      checks[name] = !!ok;
      if (!ok) failed = true;
      if (detail !== undefined) details[name] = detail;
      console.error(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
    },
    get failed() {
      return failed;
    },
  };
}
