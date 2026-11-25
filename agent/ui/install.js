/**
 * Installing what the session built.
 *
 * The last step of a session that builds a tool is installing it. Left to
 * the agent's words that is "add automerge:294ckni359B9QkiTV4tW8W1taW4q to
 * your module settings": fifty characters of base58 to select without missing
 * one, pasted into a document you have to go and find.
 *
 * This is deliberately a button in the view and not a tool. Installing adds code
 * that runs on every future load, which is why the module settings document is
 * on the always-ask list: the consent has to come from a person. A button IS
 * that consent, directly, with no approval card standing in for it. Giving the
 * agent an `install` verb would route around the gate rather than satisfy it.
 *
 * Two ways to install, because a tool under development and a tool you are
 * happy with want different things:
 *
 *   - live    `automerge:<id>`          follows the agent's next edit
 *   - pinned  `automerge:<id>#<heads>`  frozen at exactly this version
 *
 * Pinning is how you promote one version: keep using it while the agent goes on
 * experimenting, and a later edit cannot change what you installed.
 */

/** Split an installed entry into its document and its pinned heads, if any. */
export function splitModuleUrl(entry) {
  const raw = String(entry ?? "")
  const hash = raw.indexOf("#")
  return hash === -1 ? { url: raw, heads: null } : { url: raw.slice(0, hash), heads: raw.slice(hash + 1) }
}

/** Build the entry to install: bare for live, heads-pinned for a fixed version. */
export function moduleUrlFor(packageUrl, heads = null) {
  const { url } = splitModuleUrl(packageUrl)
  if (!heads?.length) return url
  // Sorted, because heads are a SET — two peers can hold the same version and
  // list it in different orders, and an unsorted join would make those look
  // like different versions.
  return `${url}#${[...heads].sort().join("|")}`
}

/**
 * How this package currently stands in the installed list.
 *
 * `installed` is about the document, not the exact entry: a package installed at
 * a pinned version is still installed, and saying otherwise would invite a
 * second entry for the same tool.
 */
export function installState(settingsDoc, packageUrl) {
  const { url } = splitModuleUrl(packageUrl)
  const modules = settingsDoc?.modules ?? []
  const index = modules.findIndex((entry) => splitModuleUrl(entry).url === url)
  if (index === -1) return { installed: false, pinned: null, index: -1, entry: null }
  const entry = modules[index]
  return { installed: true, pinned: splitModuleUrl(entry).heads, index, entry }
}

/**
 * Install, re-pin, or move a package to live, in one place.
 *
 * Replaces an existing entry rather than adding a second one — two entries for
 * one package means the same plugins registered twice, and which one wins is
 * whatever order they happen to load in.
 */
export function applyInstall(settingsHandle, packageUrl, { heads = null } = {}) {
  const target = moduleUrlFor(packageUrl, heads)
  let changed = false
  settingsHandle.change((doc) => {
    if (!doc.modules) doc.modules = []
    const state = installState(doc, packageUrl)
    if (state.index === -1) {
      doc.modules.push(target)
      changed = true
    } else if (doc.modules[state.index] !== target) {
      doc.modules[state.index] = target
      changed = true
    }
  })
  return { changed, entry: target }
}

export function applyUninstall(settingsHandle, packageUrl) {
  let removed = false
  settingsHandle.change((doc) => {
    const state = installState(doc, packageUrl)
    if (state.index === -1) return
    doc.modules.splice(state.index, 1)
    removed = true
  })
  return removed
}

/**
 * Is the installed pin behind what the package is now?
 *
 * The question a pinned install creates and nothing else answers: you froze a
 * version, the agent kept working, and the tool you are using is no longer the
 * tool in the transcript. Without this the only symptom is edits that appear to
 * do nothing.
 *
 * Heads are compared as a SET — same members, any order, is the same version.
 */
export function pinIsBehind(pinned, currentHeads) {
  if (!pinned || !currentHeads?.length) return false
  const was = new Set(String(pinned).split("|").filter(Boolean))
  const now = new Set(currentHeads)
  if (was.size !== now.size) return true
  for (const head of was) if (!now.has(head)) return true
  return false
}

/** A version label a person can compare at a glance. */
export function shortHeads(heads) {
  if (!heads) return null
  const first = String(heads).split("|")[0]
  return first.slice(0, 7)
}

/**
 * The install controls' view of the account, for one session view.
 *
 *   watchInstalls({ repo, settingsUrl, onChange })
 *     settings()      the module-settings document, or null (which hides the controls)
 *     heads()         { [packageUrl]: heads } for what the session made
 *     refresh(doc)    read both, once the session has made something
 *     install(ref, { heads })   heads null for live, "current" to pin what it is now
 *     uninstall(ref)
 *     dispose()
 *
 * The module-settings document is read once and kept watched, so the controls
 * show what is actually installed — including a change made in another tab.
 * Only once there is something installable: reading it eagerly would fetch a
 * document most sessions never touch.
 */
export function watchInstalls({ repo, settingsUrl = () => globalThis.accountDocHandle?.doc()?.moduleSettingsUrl, onChange = () => {} }) {
  let found = null // Promise<handle | null>, once asked for
  let settings = null
  let off = () => {}
  let disposed = false
  const heads = {}

  function ensureSettings() {
    found ??= (async () => {
      const url = settingsUrl()
      if (!url || !repo) return null
      try {
        const handle = await repo.find(url)
        const changed = () => {
          settings = handle.doc() ?? null
          if (!disposed) onChange()
        }
        handle.on("change", changed)
        off = () => handle.off("change", changed)
        changed()
        return handle
      } catch {
        return null // no settings document reachable; the controls stay hidden
      }
    })()
    // Asked again later, a settings document that was not there may be now.
    return found.then((handle) => {
      if (!handle) found = null
      return handle
    })
  }

  /**
   * Current heads for each package this session made.
   *
   * Only so the install strip can say when a pinned version has fallen behind.
   * Cheap — the documents are already in the repo — and refreshed whenever the
   * session changes, which is whenever the agent has edited something.
   */
  async function refreshHeads(doc) {
    const packages = (doc?.made ?? []).filter((a) => a.kind === "package")
    if (!packages.length || !repo) return
    let changed = false
    for (const artifact of packages) {
      try {
        const now = (await repo.find(artifact.url)).heads?.() ?? []
        if (heads[artifact.url]?.join("|") !== now.join("|")) {
          heads[artifact.url] = now
          changed = true
        }
      } catch {
        /* an unreadable package simply has no version to compare */
      }
    }
    if (changed && !disposed) onChange()
  }

  return {
    settings: () => settings,
    heads: () => heads,
    refresh(doc) {
      if (!doc?.made?.length) return
      ensureSettings()
      refreshHeads(doc)
    },
    async install(artifact, { heads: wanted = null } = {}) {
      const handle = await ensureSettings()
      if (!handle) return
      // "current" means pin to whatever this package is right now, which has to
      // be read at the moment of clicking — not when the artifact was recorded.
      let pin = null
      if (wanted === "current") {
        pin = (await repo.find(artifact.url)).heads?.() ?? null
        if (!pin?.length) return
      }
      applyInstall(handle, artifact.url, { heads: pin })
      settings = handle.doc() ?? null
      onChange()
    },
    async uninstall(artifact) {
      const handle = await ensureSettings()
      if (!handle) return
      applyUninstall(handle, artifact.url)
      settings = handle.doc() ?? null
      onChange()
    },
    dispose() {
      disposed = true
      off()
    },
  }
}
