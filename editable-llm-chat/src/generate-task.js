// A reply generated as work: what the chat's Send does once the person's
// message and an empty reply are in the chat, wherever it runs. The tool asks
// for it through the task system's doWork (task-client.js), so it runs on
// the person's own queue when one of their machines serves it (a browser's
// run worker, or a Node run thread), and otherwise in the page. So it touches
// no DOM and imports nothing but Automerge's Repo, by bare name, which a
// browser's pool resolves through the page's import map and a Node host to
// its own copy.
//
// Its input is { chat, message, request, apiKey } (replyAsk in reply.js): the
// chat document, the id of the reply to write, the request exactly as it is
// sent to the provider, and the provider's key. The key it is asked under is
// made from the chat and the message, so a reply is asked for once.
//
// Each piece of text the provider sends is spliced onto the end of the
// reply's text in a change of its own; the whole text is never set, so a
// person who edits the reply while it streams keeps their edit, and the next
// piece still goes on the end. The reply is found by its id inside every
// change, because people may insert, delete and edit messages meanwhile.
//
// Tasks run at least once, and a model cannot carry on mid-sentence, so the
// reply names the run writing it (`run`). A run that starts takes the reply
// over and starts afresh, removing any text an earlier run left (the one
// write that is not an append, and there is text to remove only after a
// run was lost). Every append checks, in its own change, that the reply is
// still this run's, so a run that has been taken over stops at once. A run
// that finds the reply ended already does nothing. How the reply ended is
// one field, `ended`: `finished`, `stopped` or `failed` (with `error`).

import { splice } from '@automerge/automerge-repo';

/** What it throws when the chat cannot be had. */
export const UNREACHABLE = 'The chat could not be opened to write the reply.';

/**
 * Where the reply with this id is in a chat now, or null when it is not there.
 * @param {any} doc
 * @param {string} id
 */
function find(doc, id) {
  const messages = doc?.messages;
  if (!Array.isArray(messages) && typeof messages?.findIndex !== 'function') {
    return null;
  }
  const i = messages.findIndex((/** @type {any} */ m) => m?.id === id);
  return i < 0 ? null : { i, m: messages[i] };
}

/**
 * The provider's stream as pieces of text: the request is posted with
 * `stream: true`, and each server-sent event's `delta.content` is a piece.
 * Aborting `signal` ends it with the signal's reason, even when the
 * provider's body does not heed it.
 * @param {typeof globalThis.fetch} fetch
 * @param {{ endpoint: string, model: string, messages: { role: string, content: string }[] }} request
 * @param {string} apiKey
 * @param {AbortSignal} signal
 * @returns {AsyncGenerator<string>}
 */
export async function* streamPieces(fetch, request, apiKey, signal) {
  const response = await fetch(request.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'HTTP-Referer': globalThis.location?.origin ?? 'http://localhost',
      'X-Title': 'Patchwork',
    },
    body: JSON.stringify({ model: request.model, messages: request.messages, stream: true }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error (${response.status}): ${text}`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder();
  let buffer = '';
  /** @param {string} line @returns {{ piece?: string, done?: boolean }} */
  const read = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      return {};
    }
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') {
      return { done: true };
    }
    /** @type {any} */
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      // a line that is not JSON carries no text
      return {};
    }
    if (parsed?.error) {
      throw new Error(`LLM API error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
    }
    const piece = parsed?.choices?.[0]?.delta?.content;
    return typeof piece === 'string' && piece !== '' ? { piece } : {};
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // a cancelled read ends quietly, which must not read as the provider finishing
      signal.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        const { piece, done: over } = read(line);
        if (over) {
          return;
        }
        if (piece) {
          yield piece;
        }
      }
      if (done) {
        return;
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}

/**
 * How a stopped run leaves the reply: `yielded` (another run holds the task)
 * and `stopping` (this machine's pool is going away, and the task will be
 * taken again) hand it to another run, which starts it afresh; any other
 * stop is the person's, and the reply is stopped.
 * @param {unknown} reason  the run's signal's reason
 * @returns {'stopped' | 'taken'}
 */
const stoppedFor = (reason) => (reason === 'yielded' || reason === 'stopping' ? 'taken' : 'stopped');

/**
 * @typedef {object} ReplyInput
 * @property {string} chat  the chat document's url
 * @property {string} message  the id of the reply to write
 * @property {{ endpoint: string, model: string, messages: { role: string, content: string }[] }} request
 * @property {string} apiKey
 */

/**
 * @typedef {object} Written  what a run returns: how the reply stands, and how much this run wrote
 * @property {'finished' | 'stopped' | 'failed' | 'taken' | 'gone'} ended  `taken`: another run writes the reply now, or will; `gone`: the reply was deleted
 * @property {number} pieces
 * @property {number} chars
 * @property {boolean} [already]  the reply had ended before this run began, and it wrote nothing
 */

/**
 * Writes the reply the input names, as the comment above says. `fetch` is
 * the network's (a test passes its own).
 * @param {ReplyInput} input
 * @param {{ repo: any, run: string, signal: AbortSignal, progress: (v: unknown) => void, log: (...a: unknown[]) => void }} ctx
 * @returns {Promise<Written>}
 */
export async function generate(input, ctx, { fetch = (/** @type {any[]} */ ...a) => globalThis.fetch(...a) } = {}) {
  const { chat, message: id, request, apiKey } = input ?? {};
  if (typeof chat !== 'string' || typeof id !== 'string' || typeof request?.endpoint !== 'string' || !Array.isArray(request?.messages)) {
    throw new Error('No reply was named to write.');
  }
  const run = ctx.run;
  const handle = await ctx.repo.find(chat, { signal: ctx.signal }).catch(() => {
    if (!ctx.signal.aborted) throw new Error(UNREACHABLE);
  });
  // stopped before it took the reply: nothing was written, and the work's ending says it stopped
  if (!handle || ctx.signal.aborted) {
    return { ended: stoppedFor(ctx.signal.reason), pieces: 0, chars: 0 };
  }

  /** @type {Written | null} */
  let before = null;
  handle.change((/** @type {any} */ d) => {
    const found = find(d, id);
    if (!found) {
      before = { ended: 'gone', pieces: 0, chars: 0 };
      return;
    }
    const { i, m } = found;
    if (m.ended) {
      before = { ended: m.ended, pieces: 0, chars: 0, already: true };
      return;
    }
    if (m.content.length > 0) {
      splice(d, ['messages', i, 'content'], 0, m.content.length);
    }
    m.run = run;
  });
  if (before) {
    return before;
  }

  /**
   * Changes the reply if it is still this run's and has not ended.
   * @param {(d: any, i: number, m: any) => void} change
   * @returns {'ok' | 'gone' | 'taken'}
   */
  const write = (change) => {
    /** @type {'ok' | 'gone' | 'taken'} */
    let how = 'gone';
    handle.change((/** @type {any} */ d) => {
      const found = find(d, id);
      if (!found) {
        return;
      }
      if (found.m.run !== run || found.m.ended) {
        how = 'taken';
        return;
      }
      change(d, found.i, found.m);
      how = 'ok';
    });
    return how;
  };

  // ended when the run is stopped, and by this run itself once the reply is no longer its own
  const own = new AbortController();
  const signal = AbortSignal.any([ctx.signal, own.signal]);
  let pieces = 0;
  let chars = 0;
  try {
    for await (const piece of streamPieces(fetch, request, apiKey ?? '', signal)) {
      const how = write((d, i, m) => splice(d, ['messages', i, 'content'], m.content.length, 0, piece));
      if (how !== 'ok') {
        own.abort(how);
        return { ended: how, pieces, chars };
      }
      pieces++;
      chars += piece.length;
      ctx.progress({ pieces, chars });
    }
  } catch (error) {
    if (ctx.signal.aborted) {
      // A stop is not a failure, so it returns: how the run is recorded is its stop's reason either way.
      const ended = stoppedFor(ctx.signal.reason);
      if (ended === 'stopped') {
        write((_d, _i, m) => (m.ended = 'stopped'));
      }
      return { ended, pieces, chars };
    }
    const reason = /** @type {any} */ (error)?.message ?? String(error);
    write((_d, _i, m) => {
      m.ended = 'failed';
      m.error = reason;
    });
    throw new Error(reason);
  }
  const how = write((_d, _i, m) => (m.ended = 'finished'));
  return { ended: how === 'ok' ? 'finished' : how, pieces, chars };
}

/** The task: generate with the network's fetch. */
export default function generateTask(/** @type {ReplyInput} */ input, /** @type {any} */ ctx) {
  // @ts-ignore a pool hands ctx as `this` too
  return generate(input, ctx ?? this);
}
