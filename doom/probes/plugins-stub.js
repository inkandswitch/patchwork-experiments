// Stand-in for the host's @inkandswitch/patchwork-plugins (mapped by the probe's importmap).
const registries = new Map();
function makeRegistry() {
  const plugins = new Map();
  const listeners = new Set();
  return {
    // as the real one: the importUrl is kept on the plugin, unless it has its own
    register(p, importUrl) { plugins.set(p.id, { ...p, ...(importUrl && !p.importUrl ? { importUrl } : {}) }); for (const l of [...listeners]) l(); },
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
export const getAllRegistries = () => registries;
/** As the real one: each plugin into its type's registry, from this importUrl. */
export function registerPlugins(plugins, importUrl) {
  for (const p of plugins) getRegistry(p.type).register(p, importUrl);
}
