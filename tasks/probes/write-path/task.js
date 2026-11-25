// The task that probes/write-path.mjs asks, on a Node host and in a
// browser's run worker alike: the probe hands it over as a data: URL, so it
// imports nothing and uses only what both platforms have (Web Crypto,
// performance, the run's ctx.repo).
//
// input { size, count = 1, ack = false, limitMs = 120000 }: writes `count`
// documents { content: <size random bytes> } through ctx.repo, flushes, and
// returns each one's url and SHA-256. With `ack`, it then waits until the
// sync server has said it holds every one of them at their current heads
// (see serverWatch), and says how long that took.
//
// input { read: url, sha256, limitMs = 120000 }: finds that document,
// asking again whenever a find rejects, until its content hashes to
// `sha256`, and says how long that took from the moment the code started and
// how each find went. It returns { ok: false, observed } at the limit rather
// than throwing, so that the probe keeps what was seen.

const CHUNK = 65536; // the most getRandomValues fills in one call

const now = () => performance.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Random bytes, so that nothing on the way can make them smaller. */
function randomBytes(size) {
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += CHUNK) {
    crypto.getRandomValues(bytes.subarray(at, Math.min(size, at + CHUNK)));
  }
  return bytes;
}

const headsKey = (heads) => [...heads].map(String).sort().join(',');

/**
 * What the sync server says it holds. A Subduction Repo emits
 * 'subduction-remote-heads' when a Subduction peer it is connected to (here
 * only the sync server) reports a document's heads; a document is held there
 * when those heads are this Repo's own. It is listened to before anything is
 * written, because the report can come before anyone waits for it.
 */
function serverWatch(repo) {
  const available = typeof repo.on === 'function' && typeof repo.resyncSubduction === 'function';
  const seen = new Map();
  const reports = [];
  const t0 = now();
  const onHeads = ({ documentId, storageId, heads }) => {
    seen.set(String(documentId), headsKey(heads));
    reports.push({ documentId: String(documentId), storageId: String(storageId), at: Math.round(now() - t0) });
  };
  if (available) {
    repo.on('subduction-remote-heads', onHeads);
  }
  return {
    available,
    async wait(handles, limitMs) {
      const started = now();
      if (!available) {
        return { available, acked: null, ms: 0 };
      }
      const server = await repo.connectedSubductionPeerIds?.().catch(() => null);
      let resyncs = 0;
      let lastResync = started;
      let left = handles;
      while (now() - started < limitMs) {
        left = handles.filter((handle) => seen.get(String(handle.documentId)) !== headsKey(handle.heads()));
        if (!left.length) {
          break;
        }
        // A report that never comes is known to happen (openfoam's
        // segments.js): ask for another sync round now and then.
        if (now() - lastResync > 10_000) {
          for (const handle of left) {
            repo.resyncSubduction(handle.documentId);
          }
          resyncs++;
          lastResync = now();
        }
        await sleep(20);
      }
      repo.off?.('subduction-remote-heads', onHeads);
      const ours = new Set(handles.map((handle) => String(handle.documentId)));
      const mine = reports.filter((report) => ours.has(report.documentId));
      return {
        available,
        acked: left.length === 0,
        ms: Math.round(now() - started),
        left: left.length,
        resyncs,
        reportsForOurs: mine.length,
        reportsInAll: reports.length,
        reporters: [...new Set(mine.map((report) => report.storageId))].map((id) => ({
          id: id.slice(0, 12),
          isConnectedServer: server ? server.includes(id) : null,
        })),
      };
    },
  };
}

async function write(input, ctx) {
  const t0 = now();
  const { size, count = 1, ack = false, limitMs = 120_000 } = input;
  const watch = ack ? serverWatch(ctx.repo) : null;
  const handles = [];
  const docs = [];
  for (let i = 0; i < count; i++) {
    const content = randomBytes(size);
    const handle = ctx.repo.create({ content });
    handles.push(handle);
    docs.push({ url: handle.url, sha256: await sha256(content) });
  }
  const madeMs = Math.round(now() - t0);
  await ctx.repo.flush(handles.map((handle) => handle.documentId));
  const flushedMs = Math.round(now() - t0);
  const acked = watch ? await watch.wait(handles, limitMs) : null;
  return { docs, madeMs, flushedMs, ack: acked, ms: Math.round(now() - t0) };
}

async function read(input, ctx) {
  const t0 = now();
  const { read: url, sha256: want, limitMs = 120_000 } = input;
  const rejections = [];
  let finds = 0;
  let firstFind = null;
  while (now() - t0 < limitMs) {
    const at = Math.round(now() - t0);
    finds++;
    let handle;
    try {
      handle = await ctx.repo.find(url);
    } catch (error) {
      const after = Math.round(now() - t0) - at;
      firstFind ??= { rejectedAfterMs: after };
      rejections.push({ at, after, message: String(error?.message ?? error).slice(0, 80) });
      await sleep(250);
      continue;
    }
    firstFind ??= { resolvedAfterMs: Math.round(now() - t0) - at };
    for (;;) {
      const content = handle.doc()?.content;
      if (content?.byteLength === input.size && (await sha256(content)) === want) {
        return { ok: true, ms: Math.round(now() - t0), finds, firstFind, rejections: summarise(rejections) };
      }
      if (now() - t0 > limitMs) {
        return {
          ok: false,
          ms: Math.round(now() - t0),
          observed: content ? `found, but ${content.byteLength} bytes that do not hash right` : 'found, with no content',
          finds,
          firstFind,
          rejections: summarise(rejections),
        };
      }
      await sleep(100);
    }
  }
  return { ok: false, ms: Math.round(now() - t0), observed: 'never found', finds, firstFind, rejections: summarise(rejections) };
}

/** Every rejection counted, the first few and the last kept as they were. */
const summarise = (list) => ({ count: list.length, first: list.slice(0, 4), last: list.length > 4 ? list.at(-1) : null });

export default async function (input, ctx) {
  return input?.read ? read(input, ctx) : write(input, ctx);
}
