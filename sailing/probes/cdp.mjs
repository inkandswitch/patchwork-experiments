// A copy of the scene package's probes/cdp.mjs (packages don't import each other).
// What the browser probes share: serve a directory, start headless Chrome
// (SwiftShader WebGL) with a debugging port, and drive one page over CDP with
// real mouse and key events. Plain node, no dependencies.
//
//   const b = await browser({ root, port, cdp, page: "/probes/editor-probe.html" });
//   await b.js("1 + 1"); await b.drag([x0, y0], [x1, y1]); await b.key("g");
//   await b.shot("/path/to.png"); b.stop(code);
import { spawn } from "node:child_process";
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
    { stdio: "ignore" },
  );
  const stop = (code) => {
    try {
      chrome.kill();
    } catch {}
    server.close();
    setTimeout(() => {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
      process.exit(code);
    }, 300);
  };
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
  async function keyDown(key, mods = 0) {
    const k = keyInfo(key);
    await send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", key, code: k.code, windowsVirtualKeyCode: k.vk, text: k.text, modifiers: modBits(mods) });
  }
  async function keyUp(key, mods = 0) {
    const k = keyInfo(key);
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: k.code, windowsVirtualKeyCode: k.vk, modifiers: modBits(mods) });
  }

  return {
    send,
    js,
    logs,
    reports,
    stop,
    mouse,
    keyDown,
    keyUp,
    /** a full key press */
    async key(key, mods = 0) {
      await keyDown(key, mods);
      await keyUp(key, mods);
      await sleep(60);
    },
    async move(x, y) {
      await mouse("mouseMoved", x, y);
    },
    /** press and release in place */
    async click(x, y, { button = "left", mods = 0, clickCount = 1 } = {}) {
      await mouse("mouseMoved", x, y);
      await mouse("mousePressed", x, y, { button, mods, clickCount });
      await mouse("mouseReleased", x, y, { button, mods, clickCount });
      await sleep(80);
    },
    async dblclick(x, y) {
      await mouse("mouseMoved", x, y);
      await mouse("mousePressed", x, y, { clickCount: 1 });
      await mouse("mouseReleased", x, y, { clickCount: 1 });
      await mouse("mousePressed", x, y, { clickCount: 2 });
      await mouse("mouseReleased", x, y, { clickCount: 2 });
      await sleep(120);
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
        await sleep(16);
      }
      const mid = beforeRelease ? await beforeRelease() : null;
      await mouse("mouseReleased", ex, ey, { mods, button });
      await sleep(settle);
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
        await sleep(16);
        if (during) seen.push(await during(x, y));
      }
      const [lx, ly] = path.at(-1);
      await send("Input.dispatchDragEvent", { type: end === "drop" ? "drop" : "dragCancel", x: lx, y: ly, data, modifiers: modBits(mods) });
      await mouse("mouseReleased", lx, ly);
      await sleep(150);
      return { types: data.items.map((it) => it.mimeType), seen };
    },
    async shot(path, clip) {
      const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(r.data, "base64"));
      return path;
    },
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
