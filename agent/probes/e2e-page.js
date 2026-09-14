/**
 * The in-page half of the end-to-end probe.
 *
 * This runs inside a real patchwork.inkandswitch.com tab, so everything it
 * touches is the real thing: the importmap, the plugin registry, a live
 * automerge repo syncing to the real server, and a real model call over the
 * network from a browser origin (which is the only way to find out whether
 * OpenRouter's CORS actually permits it).
 *
 * It reports a trajectory rather than a verdict — every status transition with
 * a timestamp — because when this fails, "it didn't work" is useless and
 * "status went running → awaiting-approval → running → error at t+9s" is not.
 */

window.__agentProbe = async function (opts) {
  const started = Date.now()
  const steps = []
  const at = () => Date.now() - started
  const step = (name, detail = {}) => {
    steps.push({ t: at(), name, ...detail })
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function waitFor(label, predicate, timeoutMs = 45000) {
    const until = Date.now() + timeoutMs
    for (;;) {
      let value
      try {
        value = predicate()
      } catch (err) {
        value = false
        step(`${label}: predicate threw`, { error: String(err?.message ?? err) })
      }
      if (value) {
        step(`waited for ${label}`, { ok: true })
        return value
      }
      if (Date.now() > until) {
        step(`waited for ${label}`, { ok: false, timedOut: true })
        throw new Error(`Timed out waiting for ${label}`)
      }
      await sleep(200)
    }
  }

  let host = null
  let cleanup = null
  const out = {}

  try {
    // ---- 1. Is the harness actually installed in this Patchwork? --------
    const { getRegistry, createDocOfDatatype2 } = await import("@inkandswitch/patchwork-plugins")
    const { decide } = await import(opts.agentBase + "loop.js")
    const { callsAwaitingApproval } = await import(opts.agentBase + "session.js")
    const { handleStore } = await import(opts.agentBase + "store.js")
    const automerge = await import("@automerge/automerge/slim")
    const toolRegistry = getRegistry("patchwork:tool")
    const datatypeRegistry = getRegistry("patchwork:datatype")
    const componentRegistry = getRegistry("patchwork:component")

    step("registry", {
      tool: toolRegistry.all().some((p) => p.id === "agent-session"),
      datatype: datatypeRegistry.all().some((p) => p.id === "agent-session"),
      panel: componentRegistry.all().some((p) => p.id === "agent-panel"),
      totalTools: toolRegistry.all().length,
    })

    // ---- 2. A document for it to work on -------------------------------
    const subject = await window.repo.create2()
    subject.change((d) => {
      d.title = "Untitled"
      d.items = ["leeks", "butter"]
    })
    step("created subject", { url: subject.url, title: subject.doc().title })

    // ---- 3. A session, created the way Patchwork creates documents -----
    const datatype = await datatypeRegistry.load("agent-session")
    const session = await createDocOfDatatype2(datatype, window.repo)
    session.change((d) => {
      d.subject = subject.url
      d.config.model = opts.model
    })
    step("created session", { url: session.url, model: session.doc().config.model })

    // ---- 4. Mount the real tool ----------------------------------------
    const tool = await toolRegistry.load("agent-session")
    host = document.createElement("div")
    host.id = "agent-probe-host"
    host.style.cssText =
      "position:fixed;right:0;top:0;width:440px;height:90vh;z-index:999999;background:var(--editor-fill,white);border-left:1px solid #ccc"
    document.body.append(host)
    cleanup = tool.module(session, host)
    const store = handleStore(session, automerge.splice)

    const textarea = host.querySelector("textarea")
    const sendButton = host.querySelector(".agent-composer button[data-variant='primary']")
    step("mounted", {
      runnerMode: host.querySelector(".patchwork-agent")?.dataset.runner,
      hasTextarea: !!textarea,
      hasSend: !!sendButton,
      sendDisabled: sendButton?.disabled,
    })
    if (!textarea || !sendButton) throw new Error("The tool did not render a composer")
    if (sendButton.disabled) throw new Error("Send is disabled — the API key did not reach localStorage")

    // ---- 5. Ask for a change -------------------------------------------
    const statusTrail = []
    const runnersSeen = new Set()
    const recordStatus = () => {
      const d = session.doc()
      const s = d?.status
      // Which runner claimed it? "worker-…" means the SharedWorker took the
      // session; "tab-…" means the in-tab runner did (host-tier work, or no
      // worker available).
      if (d?.lease?.runner) runnersSeen.add(String(d.lease.runner).split("-")[0])
      if (statusTrail.at(-1)?.status !== s) statusTrail.push({ t: at(), status: s })
    }
    const statusTimer = setInterval(recordStatus, 100)
    recordStatus()

    textarea.value = opts.prompt
    sendButton.click()
    step("sent", { prompt: opts.prompt })

    // ---- 6. It should stop and ask before editing ----------------------
    //
    // "idle" is also the starting state, so waiting for it matches immediately
    // and tests nothing. A turn is settled when it needs a human, when it
    // failed, or when the agent has actually had the last word.
    const settled = () => {
      const d = session.doc()
      if (["awaiting-approval", "awaiting-answer", "error", "parked"].includes(d.status)) return true
      const last = d.turns[d.turns.length - 1]
      return d.status === "idle" && d.turns.length > 1 && last?.role === "assistant"
    }
    const patience = opts.waitMs ?? 90000
    // --- optionally throw the view away mid-run -----------------------
    //
    // This is what navigating to another document does: Patchwork unmounts the
    // tool. The runner must not care. Everything after this point watches the
    // session DOCUMENT, with no view attached to anything.
    if (opts.unmountAfterMs) {
      await sleep(opts.unmountAfterMs)
      const before = { turns: session.doc().turns.length, status: session.doc().status }
      try {
        cleanup?.()
      } catch (err) {
        step("cleanup threw on unmount", { error: String(err?.message ?? err) })
      }
      host.remove()
      host = null
      cleanup = null
      step("unmounted the view", before)
      out.atUnmount = before

      // Approvals now have to come from outside the view, since there is none.
      const approveFromOutside = setInterval(() => {
        for (const call of callsAwaitingApproval(session.doc())) {
          decide(store, call.id, "session", subject.url)
        }
      }, 300)

      try {
        await waitFor("the agent to finish with no view attached", settled, patience)
      } finally {
        clearInterval(approveFromOutside)
      }

      out.afterUnmount = {
        turns: session.doc().turns.length,
        status: session.doc().status,
        keptGoing: session.doc().turns.length > before.turns,
      }
      clearInterval(statusTimer)
      recordStatus()

      const doc = session.doc()
      const blocks = doc.turns.flatMap((t) => (t.blocks ?? []).map((b) => ({ role: t.role, ...b })))
      return {
        ok: true,
        elapsedMs: at(),
        steps,
        statusTrail,
        runnersSeen: [...runnersSeen],
        atUnmount: out.atUnmount,
        afterUnmount: out.afterUnmount,
        finalStatus: doc.status,
        approved: 1,
        subject: { url: subject.url, doc: JSON.parse(JSON.stringify(subject.doc())) },
        session: {
          url: session.url,
          turns: doc.turns.length,
          calls: blocks.filter((b) => b.type === "call").map((b) => ({ tool: b.tool, status: b.status, input: b.input })),
          results: blocks.filter((b) => b.type === "result").map((b) => ({ isError: b.isError, output: String(b.output ?? "").slice(0, 200) })),
          text: blocks.filter((b) => b.type === "text" && b.role === "assistant").map((b) => b.text).join("\n"),
        },
        transcriptRows: [],
        sessionUrl: session.url,
        subjectUrl: subject.url,
      }
    }

    await waitFor("the agent to act", settled, patience)

    // Answer questions and approve calls until the agent stops needing us. A
    // grant covers one tool, so a turn using two risky tools legitimately asks
    // twice, and a question can follow an approval or vice versa.
    let approved = 0
    let answered = 0
    const grantsChosen = []
    const answersGiven = []

    const answerAny = async () => {
      while (session.doc().status === "awaiting-answer" && answered < (opts.maxAnswers ?? 4)) {
        const card = host.querySelector(".agent-question")
        if (!card) throw new Error("The session is waiting on an answer but no question card rendered")
        const options = [...card.querySelectorAll(".agent-question-options button")]
        step("question asked", {
          question: card.querySelector(".agent-question-title")?.textContent?.trim().slice(0, 120),
          options: options.map((b) => b.textContent),
        })

        // Prefer a named option; otherwise type, which is the path that has to
        // work when the agent's guesses at the answers are all wrong.
        if (options.length) {
          answersGiven.push(options[0].textContent)
          options[0].click()
        } else {
          const field = card.querySelector(".agent-question-other input")
          field.value = opts.answer ?? "yes, go ahead"
          answersGiven.push(field.value)
          card.querySelector(".agent-question-other button").click()
        }
        answered++
        await waitFor("the answer to be picked up", () => session.doc().status !== "awaiting-answer", 60000)
        await waitFor("the agent to finish", settled, patience)
      }
    }

    // Tools to refuse rather than grant. Denial is a path with its own failure
    // mode — an agent that keeps reporting the same refusal instead of getting
    // on with the rest of the work — and it needs driving to test.
    const denyTools = String(opts.denyTools ?? "").split(",").map((t) => t.trim()).filter(Boolean)
    let denied = 0
    const deniedTools = []

    const approveOrDeny = async () => {
      while (session.doc().status === "awaiting-approval" && approved + denied < (opts.maxApprovals ?? 6)) {
        const card = host.querySelector(".agent-approval")
        const scopes = [...(card?.querySelectorAll(".agent-approval-scopes button") ?? [])]
      // Which standing grant to take. "narrow" is the tightest offer — a single
      // page or document; "site" is the one that makes an agentic loop bearable,
      // because the next fetch from the same host does not stop and ask.
        const pendingTool = session
          .doc()
          .turns.flatMap((t) => t.blocks)
          .find((b) => b.type === "call" && b.status === "pending")?.tool
        const refuse = denyTools.includes(pendingTool)

        const chosen = refuse
          ? [...card.querySelectorAll("button")].find((b) => b.textContent === "Deny")
          : opts.grantScope === "site" && scopes.length > 1
            ? scopes[scopes.length - 2]
            : scopes[0]

        step("approval requested", {
          tool: pendingTool,
          scopes: scopes.map((b) => b.textContent),
          choosing: chosen?.textContent,
        })
        if (!chosen) throw new Error("An approval was requested but no buttons rendered")

        if (refuse) {
          deniedTools.push(pendingTool)
          denied++
        } else {
          grantsChosen.push(chosen.textContent)
          approved++
        }
        chosen.click()

        // The decision does not change the status synchronously — the runner
        // picks it up on its next tick. Waiting for `settled` here would match
        // the still-current "awaiting-approval" and prove nothing.
        await waitFor("the decision to be picked up", () => session.doc().status !== "awaiting-approval", 60000)
        await waitFor("the agent to finish", settled, patience)
        await answerAny()
      }
    }

    await answerAny()
    await approveOrDeny()

    // Follow-up messages, so a probe can see how the agent behaves over several
    // turns rather than only on the first one.
    for (const followUp of opts.followUps ?? []) {
      textarea.value = followUp
      sendButton.click()
      step("followed up", { prompt: followUp })
      await waitFor("the agent to act on the follow-up", settled, patience)
      await answerAny()
      await approveOrDeny()
    }

    clearInterval(statusTimer)
    recordStatus()

    // ---- 7. What actually happened? ------------------------------------
    const doc = session.doc()
    const blocks = doc.turns.flatMap((t) => (t.blocks ?? []).map((b) => ({ role: t.role, ...b })))
    const calls = blocks
      .filter((b) => b.type === "call")
      .map((b) => ({ tool: b.tool, status: b.status, input: b.input }))
    const results = blocks
      .filter((b) => b.type === "result")
      .map((b) => ({ isError: b.isError, output: String(b.output ?? "").slice(0, 300) }))
    const text = blocks
      .filter((b) => b.type === "text" && b.role === "assistant")
      .map((b) => b.text)
      .join("\n")

    // One entry per assistant turn, so a probe can ask how the agent behaved
    // ACROSS turns — whether it keeps raising something, for instance.
    const assistantTurns = doc.turns
      .filter((t) => t.role === "assistant")
      .map((t) => (t.blocks ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim())
      .filter(Boolean)

    const transcriptRows = [...host.querySelectorAll(".agent-call summary")].map((s) => s.textContent.trim())

    // What the log actually rendered, rather than what it holds. Markdown and
    // pictures are only useful if they reach the DOM.
    const rendered = {
      markdownBlocks: host.querySelectorAll(".agent-text .agent-md > *").length,
      headings: [...host.querySelectorAll(".agent-text h1, .agent-text h2, .agent-text h3")].map((h) => h.textContent),
      listItems: host.querySelectorAll(".agent-text li").length,
      codeBlocks: host.querySelectorAll(".agent-text pre code").length,
      links: [...host.querySelectorAll(".agent-text a[href]")].map((a) => a.getAttribute("href")).slice(0, 8),
      images: [...host.querySelectorAll(".agent-shot img")].map((i) => ({
        bytes: i.getAttribute("src")?.length ?? 0,
        kind: i.getAttribute("src")?.slice(0, 20),
      })),
      docChips: [...host.querySelectorAll(".agent-doc-chip")].map((c) => c.textContent),
      // The guarantee that matters: model output never becomes markup.
      scriptTags: host.querySelectorAll(".agent-text script").length,
    }

    return {
      ok: true,
      elapsedMs: at(),
      steps,
      statusTrail,
      runnersSeen: [...runnersSeen],
      runnerMode: host.querySelector(".patchwork-agent")?.dataset.runner ?? null,
      approved,
      denied,
      deniedTools,
      answered,
      answersGiven,
      assistantTurns,
      // So the driver can size a full-page capture to what was actually rendered.
      shotHeight: host?.scrollHeight ?? null,
      grantsChosen,
      grants: JSON.parse(JSON.stringify(doc.grants ?? {})),
      rendered,
      savedDocs: blocks.filter((b) => b.type === "result" && b.doc).map((b) => b.doc),
      finalStatus: doc.status,
      subject: { url: subject.url, doc: JSON.parse(JSON.stringify(subject.doc())) },
      session: { url: session.url, turns: doc.turns.length, calls, results, text },
      transcriptRows,
      sessionUrl: session.url,
      subjectUrl: subject.url,
    }
  } catch (err) {
    return {
      ok: false,
      elapsedMs: at(),
      steps,
      error: String(err?.stack ?? err?.message ?? err),
    }
  } finally {
    // Leave the DOM in place when asked, so a headed run can be looked at.
    // A capture happens after this function returns, so the DOM has to survive
    // it; --shot sets keepDom.
    if (!opts.keepOpen && !opts.keepDom) {
      try {
        cleanup?.()
      } catch {
        /* nothing useful to do */
      }
      host?.remove()
    }
  }
}
