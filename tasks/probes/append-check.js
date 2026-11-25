// What a document that probes/append-task.js appended to says about how it
// was written, read the same way on a Node asker (append-run.mjs) and in a
// browser page (browser-run/page.js, check 22). Platform-neutral: it is
// handed the Automerge functions of the asker's own copy.
//
// The asker made the document with an empty `text` and kept every text its
// Repo showed it while the task ran (`seen`). Read from that and from the
// document's history:
//
// - `whole`: the text is the pieces, in order;
// - `changes`: how many changes others made (the task's), which is one per piece;
// - `endAppends`: how many of those only insert, into the text the asker
//   made, each character after the one before and the first after the end
//   of the text as the previous change left it, and insert exactly that
//   piece: an append, never a deletion or a replacement of the text;
// - `notAppend`: the first of those that is not, and how;
// - `prefixes`: whether every text seen was the start of the whole text, as
//   many pieces long as some count of them;
// - `between`: the lengths seen strictly between empty and whole, which show
//   the text arriving piece by piece rather than all at once.

/**
 * @param {any} doc  the document as the asker's Repo has it
 * @param {string[]} pieces
 * @param {string[]} seen  every text the asker's Repo showed, in order
 * @param {{ getAllChanges(doc: any): Uint8Array[], decodeChange(change: Uint8Array): any, getActorId(doc: any): string }} Automerge
 */
export function appendedHow(doc, pieces, seen, { getAllChanges, decodeChange, getActorId }) {
  const asker = getActorId(doc);
  const changes = getAllChanges(doc).map(decodeChange);
  const made = changes.find((c) => c.actor === asker && c.ops.some((op) => op.action === 'makeText' && op.key === 'text'));
  const makeAt = made ? made.ops.findIndex((op) => op.action === 'makeText' && op.key === 'text') : -1;
  const textId = made ? `${made.startOp + makeAt}@${made.actor}` : null;
  const theirs = changes.filter((c) => c.actor !== asker).sort((a, b) => a.startOp - b.startOp);

  let after = '_head';
  let endAppends = 0;
  let notAppend = null;
  theirs.forEach((change, k) => {
    if (notAppend) return;
    let inserted = '';
    for (const [i, op] of change.ops.entries()) {
      const ok = op.action === 'set' && op.insert === true && op.obj === textId && op.elemId === after && op.pred.length === 0;
      if (!ok) {
        notAppend = { change: k, op: i, action: op.action, insert: op.insert ?? null, obj: op.obj, elemId: op.elemId ?? null, expected: after };
        return;
      }
      inserted += op.value;
      after = `${change.startOp + i}@${change.actor}`;
    }
    if (inserted !== pieces[k]) {
      notAppend = { change: k, inserted, piece: pieces[k] ?? null };
      return;
    }
    endAppends++;
  });

  const whole = pieces.join('');
  const sums = new Set(pieces.map((_, k) => pieces.slice(0, k + 1).join('').length));
  const prefixes = seen.every((text) => typeof text === 'string' && whole.startsWith(text) && (text.length === 0 || sums.has(text.length)));
  const between = [...new Set(seen.map((text) => text?.length))].filter((n) => n > 0 && n < whole.length).sort((a, b) => a - b);
  return {
    whole: doc.text === whole,
    text: doc.text,
    changes: theirs.length,
    endAppends,
    notAppend,
    prefixes,
    between,
  };
}

/** Whether what `appendedHow` read is a stream of appends of `pieces`, seen arriving piece by piece. */
export const appendedWell = (how, pieces) =>
  how.whole && how.changes === pieces.length && how.endAppends === pieces.length && how.prefixes && how.between.length > 0;
