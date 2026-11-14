// The worker's side of a RemoteHost (remote.js): a Host, run here, with its
// own automerge-repo whose one peer is the page's repo, over a MessagePort.
// Each frame request carries what only the page has (this peer's input, and
// the clock if the page keeps it) and is answered with what the page shows:
// the host's state, the pictures and query answers it asked for and the
// output since the last frame, their buffers transferred.
//
// `endpoint` is the worker's global scope, or anything with postMessage and
// addEventListener("message") (the tests use an in-process pair).
import { Repo, initSubduction, decodeHeads } from "@automerge/automerge-repo";
import { Host } from "../host/host.js";
import { PortAdapter } from "./port.js";

/**
 * Serves one host on an endpoint. `local` adds Host.open options that cannot
 * cross a message (functions: now, perf). Returns { host, repo }, filled in
 * once open (for tests).
 */
export function serve(endpoint, local = {}) {
  const served = { host: null, repo: null };
  let input = null;
  let clock = null; // { t, running }, as the page last read it
  const drawn = new Map(); // view -> the tick and revision last drawn
  const asked = new Map(); // query kind -> the tick and revision last answered
  const live = () => served.host ?? fail("closed");

  const reply = (msg, transfer = []) => endpoint.postMessage(msg, transfer);

  const handlers = {
    async open({ url, link, peerId, wasm, content, options, given }) {
      await initSubduction(); // the repo needs it loaded
      const page = new PortAdapter(link);
      served.repo = new Repo({ peerId, network: [page] });
      // The page closes the link once it holds all this repo has (close below).
      page.once("close", () => served.repo.shutdown());
      served.host = await Host.open(served.repo, url, {
        ...options,
        ...local,
        wasm,
        content,
        input: given.input ? () => input : undefined,
        clock: given.clock ? { t: () => clock.t, running: () => clock.running } : undefined,
      });
      const h = served.host;
      return { url: h.url, id: h.id, delay: h.delay, state: state(h) };
    },

    frame({ input: bytes, clock: c, views, queries = [] }, transfer) {
      const host = live();
      input = bytes;
      clock = c;
      host.frame();
      const pictures = {};
      // A view is drawn again only when the state changed: a rollback can
      // re-step to the same tick and reach another state there.
      const at = `${host.tick}:${host.revision}`;
      for (const view of views) {
        if (drawn.get(view) === at) continue;
        const p = host.picture(view);
        if (!p) continue;
        drawn.set(view, at);
        pictures[view] = p;
        transfer.push(p.rgba.buffer);
      }
      // A query is answered again only when the state changed, as a view is drawn.
      const answers = {};
      for (const kind of queries) {
        if (asked.get(kind) === at) continue;
        const a = host.query(kind);
        if (!a) continue;
        asked.set(kind, at);
        answers[kind] = a;
        transfer.push(a.buffer);
      }
      // The host keeps what it delivered (to compare re-simulations with), so
      // the page gets copies.
      const output = host.output().map((o) => {
        if (!o.audio) return o;
        const samples = o.audio.samples.slice();
        transfer.push(samples.buffer);
        return { ...o, audio: { ...o.audio, samples } };
      });
      return { state: state(host), pictures, answers, output };
    },

    sit({ port }) {
      live().sit(port);
      return state(served.host);
    },
    stand() {
      live().stand();
      return state(served.host);
    },
    pause({ margin }) {
      live().pause(margin);
    },
    resume() {
      live().resume();
    },
    // Stops the host and answers with the heads of every document this repo
    // holds; the page keeps the link until it has them all, then closes it,
    // and the repo shuts down (above). Later requests are refused.
    close() {
      served.host?.close();
      served.host = null;
      const heads = {};
      for (const h of Object.values(served.repo?.handles ?? {})) {
        const hs = h.isReady() ? decodeHeads(h.heads()) : [];
        if (hs.length) heads[h.url] = hs;
      }
      return heads;
    },
  };

  endpoint.addEventListener("message", async ({ data: m }) => {
    const transfer = [];
    try {
      const result = await handlers[m.m](m, transfer);
      reply({ id: m.id, result }, transfer);
    } catch (e) {
      reply({ id: m.id, error: String(e?.stack ?? e) });
    }
  });
  return served;
}

function fail(why) {
  throw new Error(why);
}

function state(host) {
  return {
    tick: host.tick,
    frontier: host.frontier,
    target: host.target(),
    loading: host.loading,
    seat: host.seat,
    status: host.status,
    stats: host.stats,
  };
}
