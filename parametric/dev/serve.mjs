/**
 * The development module server.
 *
 * Serves this repo over HTTP so the Patchwork host can load tools straight from
 * disk, with `pushwork` out of the loop entirely. Edit a file, reload, see it.
 *
 *     node dev/serve.mjs          # http://localhost:5199
 *
 * Why this exists: publishing through pushwork puts an Automerge folder document
 * between the file you edited and the module the host runs, and that document
 * pins each file at particular heads. When the pin lags, the host serves a
 * version of your tool that no longer exists anywhere on disk, while every check
 * available from the CLI reports success. It cost more time in one session than
 * the features being written. `packageListURL` accepts HTTP manifests alongside
 * Automerge ones, so during development there is no reason to publish at all.
 *
 * Two headers do the real work:
 *
 *   Access-Control-Allow-Origin  the host runs on another port, and importing an
 *                                ES module cross-origin needs it.
 *   Cache-Control: no-store      a dev server that lets the browser cache a
 *                                module recreates the exact staleness this is
 *                                meant to remove.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 5198);

const TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

createServer(async (req, res) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, must-revalidate",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...headers, "Access-Control-Allow-Headers": "*" });
    return res.end();
  }
  try {
    // Strip the query (cache-busters) and refuse anything climbing out of ROOT.
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const target = join(ROOT, normalize(path));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403, headers);
      return res.end("outside the repo");
    }
    const info = await stat(target);
    const file = info.isDirectory() ? join(target, "index.html") : target;
    const body = await readFile(file);
    res.writeHead(200, {
      ...headers,
      "Content-Type": TYPES[extname(file)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, headers);
    res.end("not found");
  }
}).listen(PORT, () => {
  console.log(`parametric dev modules  http://localhost:${PORT}`);
  console.log(`manifest           http://localhost:${PORT}/dev/modules.json`);
  console.log();
  console.log("Boot the host with both lists, so pkg-base's tools stay loaded:");
  console.log(`  http://localhost:5183/?system-package-list=/modules.json,http://localhost:${PORT}/dev/modules.json`);
});
