// Protocol handlers resolve a URL → an opstream. `find(url)` dispatches by scheme.
// Handlers are registerable (extensible). This is lb's `find` idea: a small set of
// protocols, each turning a url into something you can connect to.
//
// "Improve an API by making it do less": a handler is just `(url, opts) => opstream`.
//
// TODO (see TODO.md): a handler that also answers `@patchwork/handoff` would make
// its urls importable (a fetchable resource via the bootloader's handoff channel),
// bridging `find` and `import`.
import { automergeOpstream } from "./opstreams.js";

export function createProtocols() {
  const handlers = new Map();

  function register(scheme, handler) {
    handlers.set(scheme, handler);
    return () => handlers.delete(scheme);
  }

  async function find(url, opts) {
    const s = String(url);
    const i = s.indexOf(":");
    const scheme = i === -1 ? s : s.slice(0, i);
    const handler = handlers.get(scheme);
    if (!handler) throw new Error(`sketchy.find: no protocol handler for "${scheme}:"`);
    return handler(s, opts || {});
  }

  return {
    register,
    find,
    has: (scheme) => handlers.has(scheme),
    schemes: () => [...handlers.keys()],
  };
}

// automerge:<docId>[#path/parts] → an opstream attached to that doc (a subtree if
// a fragment path is given). `opts.path` / `opts.heads` also accepted (heads ⇒
// read-only, the absence-of-apply convention).
export function automergeProtocol(repo) {
  return async (url, opts = {}) => {
    const hash = url.indexOf("#");
    const base = hash === -1 ? url : url.slice(0, hash);
    const frag = hash === -1 ? "" : url.slice(hash + 1);
    const path = frag ? frag.split("/").filter(Boolean) : opts.path || [];
    const handle = await repo.find(base);
    return automergeOpstream(handle, { path, heads: opts.heads });
  };
}
