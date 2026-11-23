/**
 * Every module of the runner takes automerge from host-modules.js: one bare
 * `@automerge/...` import anywhere in the graph keeps the SharedWorker runner
 * from loading (it has no importmap). This scans the package's own source, so
 * a new module that slips back to a bare specifier fails here, not in a worker.
 */

import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = import.meta.dirname ?? process.cwd()
const SKIP = new Set(["node_modules", "dist", "probes", "scripts", "vendor", "fixtures", ".pushwork"])

function sources(dir) {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.js$/.test(name) && !/\.test\.js$/.test(name) ? [path] : []
  })
}

// A static import (at a line's start, so prose quoting one in a skill or a
// tool description is not counted) or a dynamic one, of a bare @automerge package.
const BARE = /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']@automerge\/|\bimport\s*\(\s*["']@automerge\//m

describe("automerge imports", () => {
  it("no module but host-modules.js imports automerge by bare specifier", () => {
    const offenders = sources(ROOT)
      .filter((path) => !path.endsWith("host-modules.js"))
      .filter((path) => BARE.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path))
    expect(offenders).toEqual([])
  })
})
