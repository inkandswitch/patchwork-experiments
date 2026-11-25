/**
 * Layers are directories.
 *
 * A module imports from its own directory and from the directories below it,
 * and from nowhere else, whether the import is static or dynamic. The order
 * is LAYERS, lowest first; index.js, at the root, is above them all.
 *
 * KNOWN is what does not obey yet. It may only shrink: an import upward that
 * is not in it fails, and so does an entry that is no longer true.
 */

import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, posix } from "node:path"

export const LAYERS = [
  "host", // the host's modules and context, wherever this is running
  "net", // where a request may go, and what an interruption is
  "documents", // what documents hold, read and written with no session in sight
  "providers", // model providers
  "session", // the session document, as plain data
  "kernel", // running a session: the loop, the runner, tools as the loop sees them
  "tools", // tool definitions
  "knowledge", // notes, guides and skills
  "workflow", // plans and the driver that runs them
  "assembly", // the tools put together
  "runners", // a tab, a shared worker, node
  "ui", // views
]

const KNOWN = [
  "kernel/loop.js -> knowledge/guides.js",
  "kernel/loop.js -> knowledge/notes.js",
  "kernel/loop.js -> knowledge/skills.js",
  "kernel/runner.js -> assembly/builtin.js",
  "kernel/runner.js -> tools/watch.js",
  "kernel/runner.js -> workflow/plan.js",
  "kernel/scope.js -> assembly/builtin.js",
  "kernel/scope.js -> workflow/plan.js",
  "workflow/driver.js -> assembly/builtin.js",
  "workflow/driver.js -> assembly/plugins.js",
  "workflow/driver.js -> runners/tab.js",
]

const ROOT = process.cwd()
const SKIP = new Set(["node_modules", "dist", "probes", "scripts", "vendor", "fixtures", ".pushwork"])

function sources(dir = "") {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (SKIP.has(name)) return []
    const path = dir ? `${dir}/${name}` : name
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path)
    return /\.m?js$/.test(name) && !/\.test\.js$/.test(name) ? [path] : []
  })
}

const IMPORT = /(?:\bimport|\bexport)\s[^'"]*?\bfrom\s*["'](\.[^"']+)["']|\bimport\(\s*["'](\.[^"']+)["']\s*\)|\bimport\s*["'](\.[^"']+)["']/g

/** Every import of one package module by another, as [from, to]. */
function imports(files) {
  const known = new Set(files)
  const edges = []
  for (const from of files) {
    const text = readFileSync(join(ROOT, from), "utf8")
    for (const match of text.matchAll(IMPORT)) {
      const to = posix.normalize(posix.join(posix.dirname(from), match[1] ?? match[2] ?? match[3]))
      if (known.has(to)) edges.push([from, to])
    }
  }
  return edges
}

const layerOf = (path) => (path.includes("/") ? path.split("/")[0] : null)
const rank = (path) => {
  const layer = layerOf(path)
  return layer === null ? LAYERS.length : LAYERS.indexOf(layer)
}

describe("layers", () => {
  const files = sources()
  const edges = imports(files)

  it("every source file is in a layer, or is the root's index.js", () => {
    expect(files.filter((path) => rank(path) < 0)).toEqual([])
    expect(files.filter((path) => layerOf(path) === null)).toEqual(["index.js"])
  })

  it("nothing imports upward, but what is known to", () => {
    const upward = [...new Set(edges.filter(([from, to]) => rank(to) > rank(from)).map(([from, to]) => `${from} -> ${to}`))].sort()
    expect(upward).toEqual([...KNOWN].sort())
  })

  it("no module imports itself by way of others, once the known imports are set aside", () => {
    const known = new Set(KNOWN)
    const next = new Map(files.map((path) => [path, []]))
    for (const [from, to] of edges) if (!known.has(`${from} -> ${to}`)) next.get(from).push(to)
    const done = new Set()
    const cycles = []
    const visit = (path, trail) => {
      if (trail.includes(path)) return void cycles.push([...trail.slice(trail.indexOf(path)), path].join(" -> "))
      if (done.has(path)) return
      for (const to of next.get(path)) visit(to, [...trail, path])
      done.add(path)
    }
    for (const path of files) visit(path, [])
    expect(cycles).toEqual([])
  })
})
