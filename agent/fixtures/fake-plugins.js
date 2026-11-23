// Stands in for @inkandswitch/patchwork-plugins in runner-ctx.test.js.
export const marker = "the page's registry"
export function getRegistry(type) {
  return { all: () => [], type }
}
