// Stands in for @inkandswitch/patchwork-plugins in ui/switch-checked.test.js,
// the page's registry and the in-process pool's alike: one installed agent
// tool declared for a page (`fake_echo`, which a burst offers and parks), and
// one datatype (`note`) for doc_create, a built-in page tool.

export const ECHO = {
  id: "fake_echo",
  name: "Echo",
  description: "Echo text back, from a page.",
  input_schema: { type: "object", properties: { text: { type: "string" } } },
  where: "host",
  risk: "read",
}

export const ran = []

export function getRegistry(type) {
  if (type === "agent:tool") {
    return {
      all: () => [ECHO],
      get: (id) => (id === ECHO.id ? ECHO : undefined),
      load: async (id) => (id === ECHO.id ? { module: { execute: async (input) => (ran.push(input?.text ?? null), `echoed ${input?.text ?? ""} in a page`) } } : null),
    }
  }
  if (type === "patchwork:datatype") {
    return { all: () => [], load: async (id) => (id === "note" ? { id, module: {} } : null) }
  }
  return { all: () => [], load: async () => null }
}

export async function createDocOfDatatype2(_datatype, repo, init) {
  const handle = repo.create({})
  handle.change((d) => init(d))
  return handle
}
