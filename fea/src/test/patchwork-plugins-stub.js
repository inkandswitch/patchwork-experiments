// Test stand-in for @inkandswitch/patchwork-plugins (the host provides the
// real one through the importmap; vitest.config.ts aliases it here). Just
// enough registry: register / has / get / filter / load / on.

const registries = new Map();

function makeRegistry() {
  const plugins = new Map();
  const listeners = new Set();
  return {
    register(p) {
      plugins.set(p.id, { ...p });
      for (const l of listeners) l();
    },
    unregister(id) {
      plugins.delete(id);
      for (const l of listeners) l();
    },
    clear() {
      plugins.clear();
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
    on(ev, fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function getRegistry(type) {
  if (!registries.has(type)) registries.set(type, makeRegistry());
  return registries.get(type);
}

/** Tests: empty every registry. */
export function resetRegistries() {
  for (const r of registries.values()) r.clear();
}
