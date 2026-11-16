// How long the full volume result of a run takes to post through the sync
// server and to fetch into a fresh peer: the decomposed case as ParaView
// would open it (every processor's polyMesh and the last time's fields),
// packed into automerge docs.
//
//   node probes/bulk-bench.mjs post --case ~/.patchwork-openfoam/runs/<id> [--chunk-mb 8] [--codec none|zstd] [--sync wss://…]
//   node probes/bulk-bench.mjs get  --url automerge:<index> [--parallel 8] [--sync wss://…]
//
// Layout: one index doc ({ files: [{path, offset, length}], total, sha256,
// codec, chunks: [url] }) and the bytes, concatenated (and compressed, if
// asked) and cut into chunk docs ({ data: Uint8Array }). --chunk-mb 0 puts it
// all in one chunk doc.
//
// "Posted" means the sync server's heads for every doc equal ours (the
// subduction-remote-heads event), not just that we've written it locally.
// Each command prints one JSON line of timings at the end.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { zstdCompressSync, zstdDecompressSync, constants as Z } from "node:zlib";
import { Repo, initSubduction } from "@automerge/automerge-repo";

const [cmd, ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : acc), []));
const SYNC = args.sync ?? process.env.PATCHWORK_SYNC ?? "wss://subduction.sync.inkandswitch.com";
const MB = 1024 * 1024;
const t0 = performance.now();
const now = () => performance.now() - t0;
const log = (...a) => console.error(`${(now() / 1000).toFixed(2).padStart(7)}s`, ...a);
const rss = () => Math.round(process.memoryUsage().rss / MB);
const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Every file a viewer needs: processor*\/constant/polyMesh/** and processor*\/<last time>/** (sorted). */
function caseFiles(dir) {
  const procs = readdirSync(dir).filter((n) => /^processor\d+$/.test(n)).sort((a, b) => +a.slice(9) - +b.slice(9));
  const times = readdirSync(join(dir, procs[0])).filter((n) => /^[0-9.eE+-]+$/.test(n) && n !== "0").sort((a, b) => +a - +b);
  const last = times.at(-1);
  if (!last) throw new Error(`${dir}: no time written past 0`);
  const walk = (d) => readdirSync(d).sort().flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  return { last, paths: procs.flatMap((p) => [...walk(join(dir, p, "constant", "polyMesh")), ...walk(join(dir, p, last))]) };
}

async function post() {
  const dir = resolve(String(args.case).replace(/^~/, process.env.HOME));
  const chunkMB = Number(args["chunk-mb"] ?? 8);
  const codec = args.codec ?? "none";
  const T = {};

  let t = now();
  const { last, paths } = caseFiles(dir);
  const bufs = paths.map((p) => readFileSync(p));
  const files = [];
  let off = 0;
  for (let i = 0; i < paths.length; i++) {
    files.push({ path: relative(dir, paths[i]), offset: off, length: bufs[i].length });
    off += bufs[i].length;
  }
  const raw = Buffer.concat(bufs);
  bufs.length = 0;
  T.read = now() - t;
  const rawSha = sha(raw);
  log(`${paths.length} files, ${(raw.length / MB).toFixed(1)} MB raw (time ${last}), rss ${rss()} MB`);

  t = now();
  const body = codec === "zstd" ? zstdCompressSync(raw, { params: { [Z.ZSTD_c_compressionLevel]: Number(args.level ?? 3), [Z.ZSTD_c_nbWorkers]: 4 } }) : raw;
  T.compress = now() - t;
  if (codec === "zstd") log(`zstd → ${(body.length / MB).toFixed(1)} MB (${((100 * body.length) / raw.length).toFixed(0)}%) in ${(T.compress / 1000).toFixed(1)} s`);

  const size = chunkMB > 0 ? Math.round(chunkMB * MB) : body.length;
  const parts = [];
  for (let o = 0; o < body.length; o += size) parts.push(body.subarray(o, Math.min(body.length, o + size)));

  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const want = new Map(); // documentId → our heads, until the server has them
  const acked = new Map(); // documentId → ms
  let onAll;
  const allAcked = new Promise((r) => (onAll = r));
  const check = (id, heads) => {
    const ours = want.get(id);
    if (!ours || acked.has(id)) return;
    if ([...heads].sort().join() === [...ours].sort().join()) {
      acked.set(id, now());
      if (acked.size === want.size && sealed) onAll();
    }
  };
  let sealed = false;
  repo.on("subduction-remote-heads", ({ documentId, heads }) => check(documentId, heads));

  t = now();
  const chunkUrls = [];
  const created = [];
  for (const p of parts) {
    const h = await repo.create2({ data: new Uint8Array(p) });
    want.set(h.documentId, h.heads());
    chunkUrls.push(h.url);
    created.push(now());
  }
  const index = await repo.create2({
    "@patchwork": { type: "openfoam-bulk" },
    title: `${dir.split("/").pop()} @ ${last}`,
    time: last,
    files,
    total: raw.length,
    sha256: rawSha,
    codec,
    encodedSize: body.length,
    chunks: chunkUrls,
  });
  want.set(index.documentId, index.heads());
  T.create = now() - t;
  log(`made ${parts.length} chunk doc(s) of ≤ ${(size / MB).toFixed(1)} MB + index in ${(T.create / 1000).toFixed(1)} s, rss ${rss()} MB`);
  log(`index ${index.url}`);
  sealed = true;
  if (acked.size === want.size) onAll();

  const tick = setInterval(() => log(`server has ${acked.size}/${want.size} docs, rss ${rss()} MB`), 5000);
  const limit = Number(args.timeout ?? 1800) * 1000;
  const ok = await Promise.race([allAcked.then(() => true), new Promise((r) => setTimeout(() => r(false), limit))]);
  clearInterval(tick);
  T.posted = now() - t;
  const ackTimes = [...acked.values()].sort((a, b) => a - b);
  log(ok ? `server has everything ${((T.posted) / 1000).toFixed(1)} s after the first create` : `TIMEOUT: server has ${acked.size}/${want.size}`);
  console.log(JSON.stringify({
    cmd: "post", case: dir.split("/").pop(), time: last, files: files.length, rawMB: +(raw.length / MB).toFixed(1), codec, encodedMB: +(body.length / MB).toFixed(1),
    chunkMB, chunks: parts.length, ok, acked: acked.size, of: want.size,
    s: { read: +(T.read / 1000).toFixed(2), compress: +(T.compress / 1000).toFixed(2), create: +(T.create / 1000).toFixed(2), posted: +(T.posted / 1000).toFixed(2), firstAck: ackTimes.length ? +((ackTimes[0] - (t0 + t - t0)) / 1000).toFixed(2) : null },
    MBps: ok ? +((body.length / MB) / (T.posted / 1000)).toFixed(2) : null, rssMB: rss(), index: index.url, sync: SYNC,
  }));
  await repo.shutdown().catch(() => {});
  process.exit(ok ? 0 : 1);
}

async function get() {
  const url = args.url;
  const parallel = Number(args.parallel ?? 8);
  const T = {};
  setTimeout(() => {
    log("TIMEOUT");
    console.log(JSON.stringify({ cmd: "get", url, ok: false, timeout: Number(args.timeout ?? 600) }));
    process.exit(1);
  }, Number(args.timeout ?? 600) * 1000).unref();
  await initSubduction();
  const repo = new Repo({ network: [], subductionWebsocketEndpoints: [SYNC] });
  const find = async (u) => {
    for (let i = 0; ; i++) {
      try {
        const h = await repo.find(u);
        if (h.doc()) return h;
      } catch (err) {
        if (i >= 5) throw err;
      }
      await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** i)));
    }
  };

  let t = now();
  const idx = (await find(url)).doc();
  T.index = now() - t;
  log(`index: ${idx.files.length} files, ${(idx.total / MB).toFixed(1)} MB (${idx.codec}, ${(idx.encodedSize / MB).toFixed(1)} MB in ${idx.chunks.length} chunk(s))`);

  t = now();
  const out = new Array(idx.chunks.length);
  const each = [];
  let next = 0, got = 0, bytes = 0;
  const tick = setInterval(() => log(`${got}/${idx.chunks.length} chunks, ${(bytes / MB).toFixed(1)} MB, ${((bytes / MB) / ((now() - t) / 1000)).toFixed(1)} MB/s, rss ${rss()} MB`), 5000);
  await Promise.all(Array.from({ length: Math.min(parallel, idx.chunks.length) }, async () => {
    while (next < idx.chunks.length) {
      const i = next++;
      const s = now();
      const d = (await find(idx.chunks[i])).doc();
      out[i] = new Uint8Array(d.data);
      each.push(now() - s);
      got++;
      bytes += out[i].length;
    }
  }));
  clearInterval(tick);
  T.chunks = now() - t;

  t = now();
  const body = Buffer.concat(out);
  const raw = idx.codec === "zstd" ? zstdDecompressSync(body) : body;
  T.decode = now() - t;
  const ok = raw.length === idx.total && sha(raw) === idx.sha256;
  T.total = T.index + T.chunks + T.decode;
  each.sort((a, b) => a - b);
  log(ok ? `got all ${(raw.length / MB).toFixed(1)} MB, digest matches` : `MISMATCH: ${raw.length} bytes, digest ${sha(raw).slice(0, 12)} vs ${idx.sha256.slice(0, 12)}`);
  console.log(JSON.stringify({
    cmd: "get", files: idx.files.length, rawMB: +(idx.total / MB).toFixed(1), codec: idx.codec, encodedMB: +(idx.encodedSize / MB).toFixed(1), chunks: idx.chunks.length, parallel, ok,
    s: { index: +(T.index / 1000).toFixed(2), chunks: +(T.chunks / 1000).toFixed(2), decode: +(T.decode / 1000).toFixed(2), total: +(T.total / 1000).toFixed(2), chunkMedian: +(each[each.length >> 1] / 1000).toFixed(2), chunkMax: +(each.at(-1) / 1000).toFixed(2) },
    MBps: +((idx.encodedSize / MB) / (T.chunks / 1000)).toFixed(2), rssMB: rss(),
  }));
  await repo.shutdown().catch(() => {});
  process.exit(ok ? 0 : 1);
}

if (cmd === "post") await post();
else if (cmd === "get") await get();
else {
  console.error("usage: bulk-bench.mjs post --case <dir> [--chunk-mb 8] [--codec none|zstd] | get --url automerge:<index>");
  process.exit(2);
}
