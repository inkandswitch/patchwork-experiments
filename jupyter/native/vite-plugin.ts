import type { Plugin } from "vite"

const PREFIX = "\0pyodide-kernel-pypi:"

/**
 * @jupyterlite/pyodide-kernel imports its piplite index and wheels as asset
 * URLs (`import * as url from '../pypi/all.json'`, which webpack makes a
 * URL). The index names its wheels relative to itself, so they can't be
 * renamed: native/scripts/build_kernel.py copies them, unchanged, into
 * dist/native/pypi, and these imports become URLs to there. Chunks are
 * written to dist/, so `./native/` is relative to them.
 */
export function pyodideKernelAssets(): Plugin {
  return {
    name: "pyodide-kernel-assets",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.includes("@jupyterlite/pyodide-kernel") && source.startsWith("../pypi/")) {
        // ".js", or Vite's JSON plugin would parse all.json's id as JSON
        return `${PREFIX}${source.slice("../pypi/".length)}.js`
      }
      return null
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null
      const url = `./native/pypi/${id.slice(PREFIX.length, -".js".length)}`
      return `export default new URL(/* @vite-ignore */ ${JSON.stringify(url)}, import.meta.url).href\n`
    },
  }
}
