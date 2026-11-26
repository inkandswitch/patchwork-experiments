// Stands in for @inkandswitch/patchwork-plugins in ui/switch-checked.test.js:
// one installed agent tool (`fake_echo`, which a pool run offers from the
// catalogue and parks for a page), and one datatype (`note`) for doc_create,
// a built-in page tool.

export const ECHO = {
  id: "fake_echo",
  name: "Echo",
  description: "Echo text back, from a page.",
  input_schema: { type: "object", properties: { text: { type: "string" } } },
  risk: "read",
}

export const ran = []

export function getRegistry(type) {
  if (type === "agent:tool") {
    return {
      all: () => [ECHO],
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
