// A task that streams text into a document the way a model's output is
// streamed: each piece is appended to the end of the document's `text` with
// Automerge's `splice`, one change per piece, `everyMs` apart, and the whole
// text is never set. It imports Automerge by bare name, which a browser's
// pool resolves through the page's import map and a Node host to its own
// copy (src/node/task-imports.ts), so this one file runs unchanged on both:
// probes/append-run.mjs runs it on a Node host, probes/browser-run.mjs (check
// 22) in a browser's run worker.
//
// input: { doc: the document's url, pieces: string[], everyMs: number }
// returns: how many pieces it appended.

import { splice } from '@automerge/automerge';

export default async function append({ doc, pieces, everyMs }, ctx) {
  const handle = await ctx.repo.find(doc, { signal: ctx.signal });
  let appended = 0;
  for (const piece of pieces) {
    if (appended > 0) {
      await new Promise((resolve) => setTimeout(resolve, everyMs));
    }
    if (ctx.signal.aborted) {
      break;
    }
    handle.change((d) => splice(d, ['text'], d.text.length, 0, piece));
    appended++;
    ctx.progress(appended / pieces.length);
  }
  return appended;
}
