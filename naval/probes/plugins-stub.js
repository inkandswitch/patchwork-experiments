// Stand-in for the host's @inkandswitch/patchwork-plugins (mapped by the probe's importmap).
const registries = new Map();
function makeRegistry() {
  const plugins = new Map();
  const listeners = new Set();
  return {
    register(p) { plugins.set(p.id, { ...p }); for (const l of listeners) l(); },
    has: (id) => plugins.has(id),
    get: (id) => plugins.get(id),
    filter: (fn) => [...plugins.values()].filter(fn),
    all: () => [...plugins.values()],
    async load(id) {
      const p = plugins.get(id);
      if (!p) return undefined;
      if (!p.module) p.module = await p.load();
      return p;
    },
    on(ev, fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
export function getRegistry(type) {
  if (!registries.has(type)) registries.set(type, makeRegistry());
  return registries.get(type);
}
