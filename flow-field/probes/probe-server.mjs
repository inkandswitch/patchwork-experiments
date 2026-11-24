// Serves a directory with open CORS and collects one JSON report from the page.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const dir = resolve(process.argv[2]);
const port = Number(process.argv[3] ?? 4456);
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".css": "text/css", ".html": "text/html" };

const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "POST" && req.url === "/report") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(204).end();
      console.log(body);
      if (!process.env.KEEP_SERVING) setTimeout(() => process.exit(0), 50);
    });
    return;
  }
  const path = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(path) || statSync(path).isDirectory()) return void res.writeHead(404).end();
  res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(res);
});
server.listen(port, () => console.error(`probe server on ${port}`));
if (!process.env.KEEP_SERVING) setTimeout(() => { console.error("TIMEOUT: no report"); process.exit(2); }, Number(process.env.PROBE_TIMEOUT_MS ?? 120000));
