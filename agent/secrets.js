/**
 * Per-device secrets.
 *
 * "Bring in outside data" mostly means authenticated sources, and that needs
 * somewhere to keep a token. The constraints are sharp:
 *
 *   - It must never enter the session document. Documents sync to every peer
 *     they are shared with and to the sync server.
 *   - It must never enter the transcript. The transcript IS the document, and
 *     it is also what gets sent to the model on every turn.
 *   - The agent must never see the value. It refers to a secret by name; the
 *     tool substitutes the value at the moment of the request.
 *
 * So secrets live in this device's localStorage and are addressed by name. The
 * cost of that is honest and worth stating: they do not follow you to another
 * device, and clearing site data loses them. Syncing secrets across devices in
 * a local-first system is a real design problem — key management, not
 * plumbing — and this deliberately does not pretend to solve it.
 */

const PREFIX = "patchwork-agent:secret:"

const storage = () => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // private mode, a worker, or storage disabled
  }
}

/** Names only. This is what the agent is allowed to know. */
export function listSecrets(store = storage()) {
  if (!store) return []
  const names = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key?.startsWith(PREFIX)) names.push(key.slice(PREFIX.length))
  }
  return names.sort()
}

/**
 * The value. Called only by a tool at the moment it makes a request — never
 * returned to the model, never written to a document.
 */
export function readSecret(name, store = storage()) {
  if (!store || !name) return null
  try {
    return store.getItem(PREFIX + name)
  } catch {
    return null
  }
}

export function writeSecret(name, value, store = storage()) {
  if (!store || !name) return false
  try {
    if (value) store.setItem(PREFIX + name, value)
    else store.removeItem(PREFIX + name)
    return true
  } catch {
    return false
  }
}

export function hasSecret(name, store = storage()) {
  return !!readSecret(name, store)
}

/**
 * Redact any known secret value that appears in text.
 *
 * Defence in depth. A tool should never put a secret in its output, but a
 * remote server can echo an Authorization header back in an error message, and
 * that output goes into the document and then to the model. This is the last
 * gate before that happens.
 */
export function redact(text, store = storage()) {
  if (typeof text !== "string" || !text) return text
  let out = text
  for (const name of listSecrets(store)) {
    const value = readSecret(name, store)
    if (value && value.length >= 8 && out.includes(value)) {
      out = out.split(value).join(`[secret:${name} redacted]`)
    }
  }
  return out
}
