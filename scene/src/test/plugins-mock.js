// A stand-in for @inkandswitch/patchwork-plugins: one registry per plugin
// type, shared by everything in a test file. Use it with
//
//   vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));

const registries = new Map();

function makeRegistry() {
  const plugins = new Map();
  return {
    register(p) {
      plugins.set(p.id, { ...p });
    },
    unregister(id) {
      plugins.delete(id);
    },
    has: (id) => plugins.has(id),
    get: (id) => plugins.get(id),
    filter: (fn) => [...plugins.values()].filter(fn),
    async load(id) {
      const p = plugins.get(id);
      if (!p) return undefined;
      if (!p.module) p.module = await p.load();
      return p;
    },
    on: () => () => {},
  };
}

export function getRegistry(type) {
  if (!registries.has(type)) registries.set(type, makeRegistry());
  return registries.get(type);
}

/** Forget every registered plugin (between tests). */
export function resetRegistries() {
  registries.clear();
}
