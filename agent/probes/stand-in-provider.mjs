// A stand-in for the model provider, for probes: a small HTTP server that
// answers the provider's chat completions request (providers/openrouter.js)
// in its streaming format, one piece of text every `everyMs`, as a canned
// stream (providers/openrouter.test.js frames them the same way). No model,
// no real key: a probe hands the session task `providerUrl` (runners/
// session-task.js) and a made-up key.
//
//   const stand = await standIn((body, n) => ({ pieces: ["Hel", "lo"], everyMs: 300 }))
//   stand.url        where it listens: http://127.0.0.1:<port>
//   stand.requests   each request: { n, at, path, authorization, body, done, aborted, sent }
//   stand.handler    the same answers, for a server of the probe's own (same-origin pages)
//   await stand.close()
//
// It answers CORS for any origin, so a browser's run worker on another port
// can reach it too.
import { createServer } from "node:http";

const frame = (delta, finish = null) => `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, http-referer, x-title",
};

/** `script(body, n)` gives `{ pieces, everyMs }` for the n-th request (from 0). */
export function standInHandler(script, requests = []) {
  return (req, res) => {
    if (req.method === "OPTIONS") return void res.writeHead(204, CORS).end();
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {}
      const seen = { n: requests.length, at: Date.now(), path: new URL(req.url, "http://x").pathname, authorization: req.headers.authorization ?? null, body, done: false, aborted: false, sent: 0 };
      requests.push(seen);
      if (req.method !== "POST" || !/\/chat\/completions$/.test(seen.path)) return void res.writeHead(404, CORS).end();
      const { pieces = ["ok"], everyMs = 200 } = script(body, seen.n) ?? {};
      res.writeHead(200, { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" });
      let i = 0;
      let timer = null;
      res.on("close", () => {
        clearTimeout(timer);
        if (!seen.done) seen.aborted = true;
      });
      const next = () => {
        if (res.destroyed) return;
        if (i < pieces.length) {
          res.write(frame({ content: pieces[i++] }));
          seen.sent = i;
          timer = setTimeout(next, everyMs);
          return;
        }
        res.write(frame({}, "stop"));
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 10, completion_tokens: pieces.length } })}\n\n`);
        res.end("data: [DONE]\n\n");
        seen.done = true;
      };
      next();
    });
  };
}

export async function standIn(script) {
  const requests = [];
  const handler = standInHandler(script, requests);
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    handler,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
