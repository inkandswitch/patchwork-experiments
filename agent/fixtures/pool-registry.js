// Stands in for @inkandswitch/patchwork-plugins (setHostUrls) as a realm's
// registry, a pool's or a page's: `installed[type]` is what a test
// registers, each plugin loaded through its own load(), as core's registry
// loads one. A type nothing is registered under is an empty registry.
export const installed = {}

export function getRegistry(type) {
  const all = () => installed[type] ?? []
  return {
    all,
    get: (id) => all().find((plugin) => plugin.id === id),
    has: (id) => all().some((plugin) => plugin.id === id),
    load: async (id) => {
      const plugin = all().find((p) => p.id === id)
      return plugin ? { ...plugin, module: await plugin.load() } : undefined
    },
  }
}
