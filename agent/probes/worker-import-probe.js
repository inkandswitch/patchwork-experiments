/**
 * A SharedWorker that answers one question: can worker code get a working
 * automerge repo without an importmap?
 *
 * A worker has no importmap, so `import "@automerge/automerge-repo"` cannot
 * resolve there. The `tasks` package solves this by loading es-module-shims
 * from a CDN — a third-party origin in the boot path, which is the wrong
 * dependency for a local-first system. The alternative tested here: the page
 * reads the importmap out of its own DOM, resolves the specifiers to absolute
 * URLs, and hands them over, so the worker can `import(absoluteUrl)` directly.
 *
 * The worker reports what happened over the port either way.
 */

self.onconnect = (event) => {
  const port = event.ports[0]
  port.start()

  port.onmessage = async (message) => {
    const { urls, repoPort } = message.data ?? {}
    const report = { step: "starting" }

    try {
      report.step = "importing automerge-repo"
      const repoModule = await import(/* @vite-ignore */ urls["@automerge/automerge-repo"])
      report.repoExports = Object.keys(repoModule).slice(0, 12)
      report.hasRepo = typeof repoModule.Repo === "function"

      report.step = "importing automerge"
      const automerge = await import(/* @vite-ignore */ urls["@automerge/automerge/slim"])
      report.hasSplice = typeof automerge.splice === "function"

      report.step = "importing the messagechannel adapter"
      const adapterModule = await import(
        /* @vite-ignore */ urls["@automerge/automerge-repo-network-messagechannel"]
      )
      report.adapterExports = Object.keys(adapterModule).slice(0, 8)

      if (repoPort) {
        // The subduction wasm has to be initialized before a Repo exists, or
        // the constructor dies on `set_subduction_logger` of undefined. The
        // page does this during boot; a worker has to do it for itself.
        report.step = "initializing subduction wasm"
        if (typeof repoModule.initSubduction === "function") {
          // The loader chain reaches for `document` somewhere, which does not
          // exist in a worker. The wasm glue itself does not need it (it takes
          // an explicit path), so a minimal shim is worth trying before
          // concluding this is impossible.
          if (typeof document === "undefined") {
            globalThis.document = {
              baseURI: location.href,
              currentScript: null,
              querySelector: () => null,
              querySelectorAll: () => [],
              getElementsByTagName: () => [],
              getElementsByClassName: () => [],
              createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
              head: { appendChild() {} },
              addEventListener() {},
            }
            report.shimmedDocument = true
          }
          await repoModule.initSubduction()
          report.subductionInitialized = true
        } else {
          report.subductionInitialized = false
          report.initExports = Object.keys(repoModule).filter((k) => /init|subduction/i.test(k))
        }

        report.step = "constructing a repo over the donated port"
        const AdapterClass =
          adapterModule.MessageChannelNetworkAdapter ?? adapterModule.default
        const repo = new repoModule.Repo({
          network: [new AdapterClass(repoPort)],
        })
        report.repoConstructed = !!repo
        report.peerId = String(repo.peerId ?? "")

        // The decisive question: does this repo actually SYNC with the page's?
        // A repo that cannot see the page's documents is useless to a runner.
        if (message.data.probeDocUrl) {
          report.step = "finding the page's document from the worker"
          try {
            const found = await Promise.race([
              repo.find(message.data.probeDocUrl),
              new Promise((_, reject) => setTimeout(() => reject(new Error("find timed out after 20s")), 20000)),
            ])
            const doc = found.doc()
            report.foundDoc = true
            report.docTitle = doc?.title ?? null

            report.step = "writing from the worker"
            found.change((d) => {
              d.writtenByWorker = true
            })
            report.wrote = true
          } catch (err) {
            report.foundDoc = false
            report.findError = String(err?.message ?? err)
          }
        }
      }

      report.step = "done"
      report.ok = true
    } catch (err) {
      report.ok = false
      report.error = String(err?.message ?? err)
      report.stack = String(err?.stack ?? "").slice(0, 600)
    }

    port.postMessage(report)
  }
}
