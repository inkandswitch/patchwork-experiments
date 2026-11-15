// What the ocean probe needs of a browser: serve a directory (with three.js
// mounted at /three/), start headless Chrome (SwiftShader WebGL) with a
// debugging port, evaluate in the page and take screenshots over CDP. Plain
// node, no dependencies. A trimmed copy of the scene package's probes/cdp.mjs:
// packages don't import each other.
import { spawn } from "node:child_process";
import { guardChrome, killChrome } from "./chrome-guard.mjs";
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";

const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serve `root`, and `mounts` ({ "/three/": dir }) beside it, on `port`. */
export async function serve(root, port, mounts = {}) {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const mount = Object.keys(mounts).find((m) => url.startsWith(m));
    const base = mount ? mounts[mount] : root;
    const path = join(base, mount ? url.slice(mount.length) : url);
    if (!path.startsWith(base) || !existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
    createReadStream(path).pipe(res);
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return server;
}

/**
 * Serve, launch, navigate. Returns the page driver.
 * @param {{ root: string, mounts?: object, port: number, cdp: number, page: string, width?: number, height?: number, timeout?: number }} o
 */
export async function browser({ root, mounts, port, cdp, page, width = 1280, height = 720, timeout = 600_000 }) {
  const server = await serve(root, port, mounts);
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "ocean-probe-"));
  const chrome = spawn(
    CHROME,
    ["--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`, `--remote-debugging-port=${cdp}`, `--window-size=${width},${height}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "about:blank"],
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
  const logs = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
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
  const js = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${expr.slice(0, 200)}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}${page}` });

  return {
    js,
    logs,
    stop,
    async shot(path) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(r.data, "base64"));
      return path;
    },
    async waitFor(expr, ms = 30_000, every = 100) {
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
