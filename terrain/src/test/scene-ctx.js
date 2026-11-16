// A drop context on a fake scene (the template tests'), with a registry
// that may or may not have sailing's sloop.
import { FakeRepo } from "./fake-repo.js";
import { emptyScene } from "./empty-scene.js";

/** A drop context on a fake scene, with a registry that may or may not have sailing's sloop (a stand-in that writes a hull and three stations as sailing's would). */
export function sceneCtx({ sailing }) {
  const repo = new FakeRepo();
  const scene = repo.add(emptyScene());
  let k = 0;
  const newId = (p = "o") => `${p}${++k}`;
  const placed = [];
  const sloop = {
    async create(ctx, at) {
      placed.push(at);
      const hull = ctx.newId("o");
      ctx.change((d) => {
        // (sailing's Sloop brings a Sea and weather only where the scene has no open water)
        if (!Object.values(d.objects).some((o) => o.traits?.water && !o.traits.water.size)) d.objects[ctx.newId("o")] = { name: "Sea", traits: { water: {}, "sailing.sea": { seed: 1, scale: 1 } } };
        if (!d.traits["sailing.weather"]) d.traits["sailing.weather"] = { wind: { speed: 7, from: 45 }, seed: 1 };
        d.objects[hull] = { name: "Sloop", parent: null, transform: { position: [...at.world.position], rotation: [...at.world.rotation], scale: 1 }, traits: { "sailing.ship": {} } };
        const mast = ctx.newId("o");
        d.objects[mast] = { name: "Mast", parent: hull };
        d.objects[ctx.newId("o")] = { name: "Boom and sail", parent: mast, traits: { "sailing.sail": { raised: 1, sheet: 0.5 } } };
        d.objects[ctx.newId("o")] = { name: "Jib", parent: mast, traits: { "sailing.jib": { sheet: 0.5, held: null, furl: 0 } } };
        d.objects[ctx.newId("o")] = { name: "Windlass", parent: hull, traits: { "sailing.anchor": { down: false, rode: 0 } } };
        d.order.push(hull);
      });
      return hull;
    },
  };
  const ctx = {
    repo,
    handle: scene,
    url: scene.url,
    doc: () => scene.doc(),
    scene: () => scene.doc(),
    change: (fn) => scene.change(fn),
    newId,
    notify: () => {},
    async addObject(url, opts) {
      const id = newId("o");
      scene.change((d) => {
        d.objects[id] = { name: opts.name, sourceUrl: url, providerId: opts.providerId, parent: null, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, ...opts.fields, hint: opts.hint };
        d.order.push(id);
      });
      return id;
    },
    async registry(type) {
      return {
        async load(id) {
          if (type === "scene:part" && id === "sailing.sloop" && sailing) return { module: sloop };
          return undefined;
        },
      };
    },
  };
  return { ctx, scene, placed };
}

