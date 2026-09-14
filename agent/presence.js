/**
 * Being visibly present in a document while working in it.
 *
 * Editing someone's document with no warning and no trace is unnerving. People
 * get an avatar when they open a document; an agent that writes to the same
 * documents should too, using the same mechanism, so it shows up in the
 * presence UI that already exists rather than in a parallel one of its own.
 *
 * Patchwork's convention (doc-presence): automerge-repo's `Presence` per
 * document handle, with a state of `{contactUrl, name, color, focused}` and a
 * heartbeat. This joins that, with the agent's contact.
 *
 * Presence is ephemeral by design — it reaches connected peers and is never
 * written to the document — so an agent that crashes mid-turn simply stops
 * appearing, rather than leaving a tombstone.
 */

const HEARTBEAT_MS = 2000
const PEER_TTL_MS = 10000

/**
 * Join a document's presence as the agent. Returns a handle with `working()`,
 * `idle()` and `leave()`.
 *
 * Everything is best-effort: presence is a courtesy, and no failure here should
 * ever stop the agent doing the work it was asked to do.
 */
export async function joinAsAgent(repo, docUrl, identity, { importHost } = {}) {
  if (!docUrl || !identity?.url) return null

  try {
    const load = importHost ?? ((name) => import(/* @vite-ignore */ name))
    const { Presence } = await load("@automerge/automerge-repo")
    if (!Presence) return null

    const handle = await repo.find(docUrl)
    const presence = new Presence({ handle })

    presence.start({
      initialState: {
        contactUrl: identity.url,
        name: identity.name,
        color: identity.color,
        focused: true,
        // Not part of the convention, but harmless to peers that ignore it and
        // useful to any view that wants to render an agent differently.
        agent: true,
        activity: "here",
      },
      heartbeatMs: HEARTBEAT_MS,
      peerTtlMs: PEER_TTL_MS,
    })

    const set = (activity) => {
      try {
        if (presence.running) presence.broadcast("activity", activity)
      } catch {
        /* a peer went away mid-broadcast; not our problem */
      }
    }

    return {
      docUrl,
      working: (what) => set(what ? `working: ${what}` : "working"),
      idle: () => set("here"),
      leave: () => {
        try {
          presence.stop()
        } catch {
          /* already gone */
        }
      },
    }
  } catch {
    // No Presence class, no network, not in a browser — all fine.
    return null
  }
}

/**
 * Keep presence pointed at whichever document the session is working on.
 *
 * The subject can change between turns, so this joins lazily and leaves the
 * previous document behind rather than accumulating sessions.
 */
export function createPresenceTracker({ repo, identity, importHost }) {
  let current = null
  let joining = null

  return {
    async follow(docUrl) {
      if (!identity?.url || current?.docUrl === docUrl) return current
      current?.leave()
      current = null
      if (!docUrl) return null

      joining = joinAsAgent(repo, docUrl, identity, { importHost })
      current = await joining
      return current
    },
    working(what) {
      current?.working(what)
    },
    idle() {
      current?.idle()
    },
    leave() {
      current?.leave()
      current = null
    },
  }
}
