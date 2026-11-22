// Tests read package files with fetch(new URL("./x", import.meta.url)): that
// works in a page and a worker, where package_test serves them. Node's fetch
// refuses file: URLs, so under `vitest run` they are read from disk here.
import { readFile } from "node:fs/promises"

const networkFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input)
  if (!url.startsWith("file:")) return networkFetch(input, init)
  try {
    return new Response(await readFile(new URL(url)))
  } catch {
    return new Response(null, { status: 404, statusText: `no file at ${url}` })
  }
}
