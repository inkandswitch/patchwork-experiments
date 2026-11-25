// A TTS import as work: what the TTS import tool does once a mod has been
// dropped and kept, wherever it runs. The tool asks for it through the task
// system's doWork (kit/task-client.js), so it runs on the person's own queue
// when one of their machines serves it (a browser's run worker, or a Node
// run thread), and otherwise in the page. So it touches no DOM and imports
// nothing a worker could not resolve; images over the size limit are made
// smaller only where there is a canvas to do it (shrink.js), which a Node
// thread has not.
//
// Its input is { import: <the tts-import doc's url>, request } (importAsk in
// request.js): the stored files and the settings, the same value its key is
// made from. It reads the stored files, has the importer find the save,
// fetch and shrink what it needs, store the assets and make the game, and
// writes the outcome on the import doc as one value, `imported`, in one
// change: only if the doc still asks for this request (a person may drop
// another mod while it waits or runs), and only if no run has written this
// request's game already (tasks run at least once). A run that finds the
// game already made returns it and makes none.
//
// It returns the game's url and a line for a person, never data: the report
// is on the import doc.

import { findWhenThere } from "../kit/task-client.js";
import { runImport, source } from "./importer.js";
import { sameRequest } from "./request.js";

/** What it says, and returns, when the import doc came to ask for another import after this one was asked. */
export const MOVED = "Another mod or other settings were chosen after this import was asked for, so it wrote nothing.";

/** What it fails with when the import doc cannot be had. */
export const UNREACHABLE = "The import could not be opened.";

/** What it fails with when a kept file cannot be had. */
export const LOST_FILE = "A file kept from the drop could not be opened: drop the mod again.";

/** What it fails with once stopped. */
export const STOPPED = "The import was stopped.";

/** The line a person sees when it is done. */
export function doneLine(report) {
  const c = report?.counts ?? {};
  return `Imported “${report?.mod?.saveName ?? "the mod"}”: ${c.placed ?? 0} things on the table, ${c.pieces ?? 0} kinds of piece; ${c.assets?.missing ?? 0} assets missing.`;
}

/** A file doc's content as bytes, whatever form the repo hands it back in. */
export function asBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content && ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content != null && typeof content.toString === "function") return new TextEncoder().encode(String(content));
  return null;
}

/** Rejects with STOPPED as soon as `signal` aborts, else settles as `promise` does. */
function untilStopped(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const stop = () => reject(new Error(STOPPED));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

// automerge takes fresh plain values, never undefined
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));

/** The outcome written for this request when it made a game, or null. */
const madeFor = (doc, id) => (doc?.imported?.id === id && typeof doc.imported.gameUrl === "string" ? doc.imported : null);

/**
 * Import the stored files the input names into a game, and write the outcome
 * on the import doc. `fetch` is the network's and `shrink` the importer's
 * default (a test passes its own of each).
 * @param {{ import: string, request: import('./request.js').ImportRequest }} input
 * @param {{ repo: any, log: (...a: unknown[]) => void, progress: (v: unknown) => void, signal: AbortSignal }} ctx
 * @returns {Promise<{ imported: boolean, message: string, gameUrl?: string }>}
 */
export async function importMod(input, ctx, { fetch = (...a) => globalThis.fetch(...a), shrink } = {}) {
  const url = input?.import;
  const request = input?.request;
  if (typeof url !== "string" || !url.startsWith("automerge:") || typeof request?.id !== "string" || !Array.isArray(request.files)) throw new Error("No import was named.");
  const { signal } = ctx;
  const stopped = () => signal?.aborted;
  ctx.progress({ phase: "Opening the import", done: 0, total: 0 });
  // what findWhenThere throws names the doc by its url, which is no message for a person
  const handle = await untilStopped(
    findWhenThere(ctx.repo, url).catch(() => {
      throw new Error(UNREACHABLE);
    }),
    signal,
  );
  const asked = (doc) => sameRequest(doc?.request, request);
  const already = madeFor(handle.doc(), request.id);
  if (already) {
    const message = doneLine(already.report);
    ctx.log(message);
    return { imported: true, message, gameUrl: already.gameUrl };
  }
  if (!asked(handle.doc())) {
    ctx.log(MOVED);
    return { imported: false, message: MOVED };
  }

  ctx.progress({ phase: "Opening the kept files", done: 0, total: request.files.length });
  const sources = await untilStopped(
    Promise.all(
      request.files.map(async (f) => {
        const file = await findWhenThere(ctx.repo, f.url).catch(() => {
          throw new Error(LOST_FILE);
        });
        return source(
          f.path,
          f.size,
          async () => {
            const bytes = asBytes(file.doc()?.content);
            if (!bytes) throw new Error("its file is empty");
            return bytes;
          },
          f.url,
        );
      }),
    ),
    signal,
  );

  let phase = null;
  let result;
  try {
    result = await runImport({
      sources,
      repo: ctx.repo,
      fetch,
      settings: request.settings,
      signal,
      ...(shrink !== undefined ? { shrink } : {}),
      onProgress: (p) => {
        ctx.progress(p);
        // a line for each stage as it starts; the last line says it is done
        if (p.phase !== phase && p.phase !== "Done") ctx.log(`${(phase = p.phase)}…`);
      },
    });
  } catch (err) {
    if (stopped()) throw new Error(STOPPED);
    const error = String(err?.message ?? err);
    // a failure is kept on the doc for whoever opens it later, unless this request was done meanwhile
    handle.change((d) => {
      if (asked(d) && !madeFor(d, request.id)) d.imported = { id: request.id, at: Date.now(), error };
    });
    throw new Error(error);
  }

  let wrote = false;
  let first = null;
  handle.change((d) => {
    if (!asked(d) || stopped()) return;
    first = madeFor(d, request.id);
    if (first) return;
    d.imported = { id: request.id, at: Date.now(), gameUrl: result.gameUrl, report: plain(result.report) };
    if (!Array.isArray(d.games)) d.games = [];
    d.games.push(result.gameUrl);
    if (!d.title || d.title === "TTS import") d.title = `${result.report.mod.saveName} (TTS)`;
    wrote = true;
  });
  if (first) {
    // another run of this request made its game while this one worked: that game is the import's
    const message = doneLine(first.report);
    ctx.log(message);
    return { imported: true, message, gameUrl: first.gameUrl };
  }
  if (!wrote) {
    if (stopped()) throw new Error(STOPPED);
    ctx.log(MOVED);
    return { imported: false, message: MOVED };
  }
  const message = doneLine(result.report);
  ctx.log(message);
  return { imported: true, message, gameUrl: result.gameUrl };
}

/** The task: importMod with the network's fetch and the importer's shrinker. */
export default function importTask(input, ctx) {
  return importMod(input, ctx ?? this);
}
