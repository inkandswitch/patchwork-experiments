/**
 * Who the agent is, when it touches a document.
 *
 * Until now the agent edited documents as a ghost: it shares `window.repo`, so
 * its changes carried the *user's* automerge actor id and were indistinguishable
 * from theirs in history, in attribution, and in anything built on either.
 *
 * The obvious fix — registering its actor id against an agent contact in the
 * actor-attribution document — is worse than the problem. That map is
 * actor → contact, and the actor is shared, so it would relabel the user's own
 * edits as the agent's. Attribution has to be per *change*, not per actor.
 *
 * Automerge gives us exactly that: every change can carry a message, and it
 * round-trips through `decodeChange`. So every write the agent makes is stamped
 * with its contact url, which is precise, cannot mislabel anyone else's work,
 * and needs no second Repo — it works in the browser today.
 *
 * The contact itself is an ordinary Patchwork contact document, so the agent
 * shows up in presence with a name and a colour like any other participant.
 */

const STAMP_PREFIX = "patchwork-agent:"

/** The agent's colour. Distinct from the human palette on purpose. */
export const AGENT_COLOR = "#7c6ff0"

/** The change message that marks a write as the agent's. */
export function changeMessage(contactUrl) {
  return contactUrl ? `${STAMP_PREFIX}${contactUrl}` : null
}

/** The agent contact behind a change message, or null if a human made it. */
export function contactFromMessage(message) {
  if (typeof message !== "string" || !message.startsWith(STAMP_PREFIX)) return null
  return message.slice(STAMP_PREFIX.length) || null
}

export function isAgentChange(message) {
  return contactFromMessage(message) !== null
}

/**
 * Find or create the agent's contact for this session.
 *
 * Stored on the session document rather than the account, deliberately: the
 * account is a document the safety model always asks before touching, and
 * internal machinery must not quietly write where a tool call would need
 * permission. The cost is that the identity is per-session rather than one
 * agent across every session — worth revisiting, but not by sneaking past a
 * gate.
 */
export async function ensureAgentIdentity(store, repo, { name } = {}) {
  const existing = store.doc()?.agentContact
  if (existing?.url) {
    try {
      await repo.find(existing.url)
      return existing
    } catch {
      // The contact document is gone; fall through and make another.
    }
  }

  const label = name ?? `Agent (${store.doc()?.config?.model?.split("/").pop() ?? "assistant"})`
  const contact = await repo.create2()
  contact.change((doc) => {
    doc.type = "registered"
    doc.name = label
    doc.color = AGENT_COLOR
    doc["@patchwork"] = { type: "contact" }
  })

  const identity = { url: contact.url, name: label, color: AGENT_COLOR }
  store.change((d) => {
    d.agentContact = identity
  })
  return identity
}

/**
 * Apply a change, stamped as the agent's.
 *
 * Every tool that writes goes through this rather than calling
 * `handle.change` directly, so a new write tool cannot quietly produce
 * unattributed edits.
 */
export function applyChange(handle, fn, ctx = {}) {
  const message = ctx.changeMessage ?? null
  if (message) handle.change(fn, { message })
  else handle.change(fn)
}
