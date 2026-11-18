// Every web asset a TTS mod names, fetched once from its host, as the game's
// drawer would (pieces.js, look/web.js): its status, size, content type and
// time, and separately whether the host sends Access-Control-Allow-Origin
// (what a browser's cross-origin fetch needs; Node's fetch ignores CORS, so
// this is the one place it is read). Node only. The files are kept, for
// sovereign-run.mjs to answer a page's fetches from, without the network.
//
//   node probes/fetch-assets.mjs --mod <…>/Workshop/<id>.json --out <dir> [--lanes 4]
//
// Writes <dir>/fetch.tsv (one row an asset), <dir>/index.json ({ url: { file,
// contentType, acao, bytes } }) and <dir>/files/. At most --lanes requests at
// once (default 4). Prints, per host, how many a browser could fetch.
// Only fetch what the mod's author published, and keep the files out of the repo.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { collectAssets, readSave } from "../src/tts/tts.js";

const arg = (name, d = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const MOD = arg("mod");
const OUT = arg("out") && resolve(arg("out"));
const LANES = Math.max(1, Math.min(8, Number(arg("lanes", 4))));
if (!MOD || !OUT) throw new Error("usage: fetch-assets.mjs --mod <mod.json> --out <dir>");
mkdirSync(join(OUT, "files"), { recursive: true });

const save = readSave(readFileSync(MOD, "utf8"));
const assets = [...collectAssets(save.objects, { tableURL: save.tableURL }).values()];
// a page's origin (any will do: the hosts that allow one answer "*")
const ORIGIN = "http://127.0.0.1:4497";
const rows = [];
const index = {};
async function one(a) {
  const row = { url: a.url, type: a.type, uses: a.uses, host: new URL(a.url).host };
  try {
    const t0 = Date.now();
    const r = await fetch(a.url, { headers: { Origin: ORIGIN }, redirect: "follow" });
    const bytes = Buffer.from(await r.arrayBuffer());
    Object.assign(row, { status: r.status, finalHost: new URL(r.url).host, bytes: bytes.length, contentType: r.headers.get("content-type") ?? "", acao: r.headers.get("access-control-allow-origin") ?? "", ms: Date.now() - t0 });
    if (r.ok) {
      const name = createHash("sha1").update(a.url).digest("hex").slice(0, 16);
      writeFileSync(join(OUT, "files", name), bytes);
      index[a.url] = { file: `files/${name}`, contentType: row.contentType, acao: row.acao, bytes: bytes.length };
    }
  } catch (err) {
    row.status = "error";
    row.error = String(err?.cause?.code ?? err?.message ?? err);
  }
  rows.push(row);
  console.error(row.status, row.bytes ?? "", row.acao || "(no ACAO)", a.url);
}
const queue = [...assets];
await Promise.all(Array.from({ length: LANES }, async () => { while (queue.length) await one(queue.shift()); }));

const cols = ["host", "finalHost", "url", "type", "uses", "status", "bytes", "contentType", "acao", "ms", "error"];
rows.sort((a, b) => (a.url < b.url ? -1 : 1));
writeFileSync(join(OUT, "fetch.tsv"), [cols.join("\t"), ...rows.map((r) => cols.map((c) => r[c] ?? "").join("\t"))].join("\n") + "\n");
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 1));
const hosts = {};
for (const r of rows) {
  const h = (hosts[r.host] ??= { assets: 0, ok: 0, browser: 0, bytes: 0, failures: {} });
  h.assets++;
  if (r.status === 200) h.ok++, (h.bytes += r.bytes);
  else h.failures[r.status === "error" ? r.error : `HTTP ${r.status}`] = (h.failures[r.status === "error" ? r.error : `HTTP ${r.status}`] ?? 0) + 1;
  if (r.status === 200 && (r.acao === "*" || r.acao === ORIGIN)) h.browser++;
}
console.log(JSON.stringify({ mod: save.saveName, assets: rows.length, hosts }, null, 2));
