// Stands in for the Tasks package's task client (host/import.js taskClient)
// in tests: the names the agent uses, hearing and stopping nothing unless a
// test says. Its poolHere reads what the real one reads.
export const standIn = (over = {}) => ({
  CANCELLED: "The task was cancelled",
  POOL_ID_KEY: "patchwork-tasks-pool-id",
  poolHere: () => Object.keys(globalThis.patchworkTasks?.poolHosts ?? {}).length > 0,
  inSamePackage: () => null,
  doWork: async () => ({ outcome: "idle" }),
  watchWork: () => () => {},
  stopWork: async () => false,
  ...over,
})

// And for @inkandswitch/patchwork-plugins (setHostUrls): a registry whose
// `patchwork:library` has the task client once a test installs one.
let installed = null
let arrived = () => {}
const arrival = new Promise((resolve) => (arrived = resolve))

export function install(client) {
  installed = client
  arrived()
}

export function getRegistry(type) {
  if (type !== "patchwork:library") throw new Error(`no registry ${type} here`)
  return {
    has: (id) => id === "tasks-next" && installed != null,
    loadWhenReady: async (id) => {
      if (id !== "tasks-next") return new Promise(() => {})
      await arrival
      return { id, module: installed }
    },
  }
}
