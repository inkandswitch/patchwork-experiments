/**
 * Layers are directories.
 *
 * A module imports from its own directory and from the directories below it,
 * and from nowhere else, whether the import is static or dynamic. The order
 * is LAYERS, lowest first; index.js, at the root, is above them all.
 *
 * A test obeys the same rule, so the tests of a directory run on that layer
 * and those below it and nothing else: what fixtures/ holds counts as
 * whatever it imports. The tests at the root are about the package as a
 * whole, and import none of it.
 *
 * KNOWN is what does not obey, and is empty. Anything put there may only
 * leave again: an import upward that is not in it fails, and so does an
 * entry that is no longer true.
 */

import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, posix } from "node:path"

export const LAYERS = [
  "host", // the host's modules and context, wherever this is running
  "net", // where a request may go, and what an interruption is
  "documents", // what documents hold, read and written with no session in sight
  "session", // the session document, as plain data
  "kernel", // running a session: the loop, the runner, tools as the loop sees them
  "providers", // model providers, which turn the kernel's request into theirs
  "tools", // tool definitions
  "knowledge", // notes, guides and skills
  "workflow", // plans and the driver that runs them
  "assembly", // the tools put together
  "runners", // a tab, a shared worker, node
  "ui", // views
]

const KNOWN = []

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

/** Every import of one package module by another, as [from, to]: of `targets` by `files`. */
function imports(files, targets = files) {
  const known = new Set(targets)
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

/** Every test file, and every fixture, which is judged by what it imports. */
function testFiles(dir = "") {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (name === "node_modules" || name === "dist" || name === "probes" || name === "scripts" || name === "vendor" || name === ".pushwork") return []
    const path = dir ? `${dir}/${name}` : name
    if (statSync(join(ROOT, path)).isDirectory()) return testFiles(path)
    return /\.test\.js$/.test(name) || (dir === "fixtures" && /\.js$/.test(name)) ? [path] : []
  })
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

  it("only host/modules.js imports automerge by its bare name", () => {
    // Everything else takes automerge from there: one bare `@automerge/...`
    // import anywhere in the graph keeps the shared worker's runner from
    // loading, since a worker has no importmap. A static import at a line's
    // start, so prose quoting one in a skill or a tool description is not
    // counted, or a dynamic one. The node runner (.mjs) is not in a worker's
    // graph, and brings its own.
    const BARE = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']@automerge\/|\bimport\s*\(\s*["']@automerge\//m
    const offenders = files.filter((path) => path.endsWith(".js") && path !== "host/modules.js" && BARE.test(readFileSync(join(ROOT, path), "utf8")))
    expect(offenders).toEqual([])
  })

  it("a test imports nothing above the directory it is in", () => {
    const tests = testFiles()
    const edges = imports(tests, [...files, ...tests])
    const fixtures = new Map()
    // The highest layer a file reaches: its own for a source file, and for a
    // fixture the highest of what it imports.
    const reach = (path, seen = new Set()) => {
      if (!path.startsWith("fixtures/")) return rank(path)
      if (fixtures.has(path)) return fixtures.get(path)
      if (seen.has(path)) return -1
      seen.add(path)
      const highest = Math.max(-1, ...edges.filter(([from]) => from === path).map(([, to]) => reach(to, seen)))
      fixtures.set(path, highest)
      return highest
    }
    const above = edges
      .filter(([from]) => !from.startsWith("fixtures/"))
      .filter(([from, to]) => reach(to) > (layerOf(from) === null ? -1 : rank(from)))
      .map(([from, to]) => `${from} -> ${to}`)
    expect(above).toEqual([])
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
