// A stand-in provider for tests: a fetch that answers a chat completions
// request with server-sent events, one piece of text each, every event cut
// in two chunks so that a reader must join lines across reads. Before each
// piece it awaits `gate(i)`, where a test does what it wants to happen
// between pieces (or never resolves, to leave the stream hanging). Like a
// hand-made Response, its body does not heed the request's signal: the
// reader must. Its stream pulls only when read, so `gate(i)` runs once the
// reader has taken every piece before it.

const encoder = new TextEncoder();

/** The server-sent event that carries one piece of text. */
export const event = (piece) => `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`;

/**
 * @param {string[]} pieces
 * @param {{ gate?: (i: number) => unknown, status?: number, body?: string, after?: string }} [options]
 *   status/body: an answer that is not 200; after: an event sent after the pieces instead of [DONE]
 */
export function provider(pieces, { gate = () => new Promise((resolve) => setTimeout(resolve, 1)), status = 200, body = '', after = 'data: [DONE]\n\n' } = {}) {
  /** @type {{ url: string, init: any }[]} */
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (status !== 200) return new Response(body, { status });
    let i = 0;
    const stream = new ReadableStream({
      async pull(controller) {
        await gate(i);
        if (i < pieces.length) {
          const frame = event(pieces[i++]);
          controller.enqueue(encoder.encode(frame.slice(0, 9)));
          controller.enqueue(encoder.encode(frame.slice(9)));
        } else {
          controller.enqueue(encoder.encode(after));
          controller.close();
        }
      },
    }, { highWaterMark: 0 });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return { fetch, calls };
}
