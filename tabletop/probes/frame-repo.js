// For a probe with two viewers who have DIFFERENT packages installed: each
// viewer is an iframe (its own module graph, so its own plugin registry),
// and the documents are the parent page's. A frame reads a document as a
// copy made in its own realm (so `instanceof Uint8Array` holds there) and
// writes by handing its whole copy back, which is what two peers on one
// sync server amount to for a probe: one history, everyone sees every write.
//
//   const repo = frameRepo(parent.shared, "a");      // shared: { repo: FakeRepo, listeners: { a: Set, b: Set } }
//
// Ephemeral messages (presence, poses, sends) on a handle go to the other
// frame's listeners on that handle, a few ms late.

export function frameRepo(shared, who) {
  const other = who === "a" ? "b" : "a";
  const mine = new Map(); // url → this frame's handle
  const wrap = (h) => {
    if (mine.has(h.url)) return mine.get(h.url);
    let seen = null;
    let local = null;
    const changeFns = new Map();
    const ephFns = new Map();
    const fh = {
      url: h.url,
      doc() {
        const d = h.doc();
        if (d !== seen) {
          seen = d;
          local = structuredClone(d);
        }
        return local;
      },
      heads: () => Array.from(h.heads()),
      view: (heads) => ({ url: `${h.url}#${Array.from(heads).join("|")}`, doc: () => fh.doc(), heads: () => Array.from(heads), isReadOnly: () => true }),
      change(fn) {
        const draft = structuredClone(fh.doc());
        fn(draft);
        h.change((d) => {
          for (const k of Object.keys(d)) delete d[k];
          Object.assign(d, draft);
        });
      },
      on(ev, fn) {
        if (ev === "ephemeral-message") {
          const f = ({ message }) => fn({ message: structuredClone(message), senderId: "peer" });
          ephFns.set(fn, f);
          shared.listeners[who].add({ url: h.url, f });
          return;
        }
        const f = () => fn({ handle: fh, doc: fh.doc() });
        changeFns.set(fn, f);
        h.on(ev, f);
      },
      off(ev, fn) {
        if (ev === "ephemeral-message") {
          const f = ephFns.get(fn);
          for (const l of [...shared.listeners[who]]) if (l.f === f) shared.listeners[who].delete(l);
          return;
        }
        h.off(ev, changeFns.get(fn));
      },
      broadcast(message) {
        setTimeout(() => {
          for (const l of [...shared.listeners[other]]) if (l.url === h.url) l.f({ message });
        }, 5);
      },
    };
    mine.set(h.url, fh);
    return fh;
  };
  return {
    add: (doc, url) => wrap(shared.repo.add(doc, url)),
    create2: async (doc) => wrap(await shared.repo.create2(doc)),
    find: async (url) => wrap(await shared.repo.find(String(url).split("#")[0])),
  };
}
