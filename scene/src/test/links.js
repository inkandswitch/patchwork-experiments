// A view plugin that opens linked docs, for the kernel's tests: the kernel
// opens a stage only when a view plugin asks (api.open), and the links native
// (src/native/links.js) is that plugin in the product. This one asks the
// simplest way: under every object whose source is a scene doc, in every
// stage it opened (and the outermost), level by level in path order; a pin
// (`at.heads`) is opened drawn at those heads. What may open is the
// kernel's to say (one acting stage per doc in a view, nothing acting under
// a drawn one): a refusal is left be. A link that goes closes its stage.
//
//   import { LINK, linkOpener } from "../test/links.js";
//   mountStage({ extensions: [..., linkOpener()], doc: { objects: { L: object({ providerId: LINK, sourceUrl }) } } });

import { plugins } from "../index.js";

/** The provider id of a link: the scene's own source whose content is a scene. */
export const LINK = plugins.find((p) => p.type === "scene:source" && p.content === "scene").id;

export const linkOpener = (id = "t.links", { provides = false } = {}) => ({
  // (`provides`: it provides a service of its own, as the links native does, so it starts with the view's providers, not after them)
  meta: { id, type: "scene:view", ...(provides ? { provides: [id] } : {}) },
  module: {
    create(api) {
      const opened = new Map(); // path key → { close, handle }
      const watched = new Set();
      let busy = null;
      let again = false;
      const watch = (h) => {
        if (watched.has(h) || typeof h.on !== "function") return;
        watched.add(h);
        h.on("change", relink);
        api.signal.addEventListener("abort", () => h.off?.("change", relink));
      };
      // one level at a time, each in path order (by depth, then id): the order the links native opens in
      async function relinkNow() {
        const want = new Set();
        const root = await api.repo.find(api.url);
        if (api.signal.aborted) return;
        let level = [{ path: [], handle: root, acts: true }];
        while (level.length) {
          const next = [];
          for (const { path, handle, acts } of level) {
            watch(handle);
            const objects = handle.doc()?.objects ?? {};
            for (const oid of Object.keys(objects).sort()) {
              const o = objects[oid];
              if (o?.providerId !== LINK || typeof o.sourceUrl !== "string") continue;
              const p = [...path, oid];
              const key = p.join("\u001f");
              const heads = o.at?.heads?.length ? [...o.at.heads] : null;
              want.add(key);
              let rec = opened.get(key);
              if (!rec) {
                let h;
                try {
                  h = await api.repo.find(o.sourceUrl);
                } catch {
                  continue;
                }
                if (api.signal.aborted) return;
                watch(h);
                const at = heads ? h.view(heads) : h;
                const close = api.open(at, { under: [path, oid], acting: acts && !heads, heads });
                if (!close) continue;
                opened.set(key, (rec = { close, handle: at, acting: acts && !heads }));
              }
              next.push({ path: p, handle: rec.handle, acts: rec.acting });
            }
          }
          level = next;
        }
        for (const [key, rec] of [...opened]) if (!want.has(key)) (rec.close(), opened.delete(key));
      }
      function relink() {
        if (busy) return void (again = true);
        const done = api.opening();
        busy = relinkNow().finally(() => {
          busy = null;
          done();
          if (again && !api.signal.aborted) (again = false), relink();
        });
      }
      relink();
      return provides ? { provides: { [id]: () => ({}) } } : {};
    },
  },
});
