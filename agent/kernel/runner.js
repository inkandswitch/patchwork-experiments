/**
 * What turns a session document into work for a run (kernel/burst.js), and
 * what one run's tools get.
 *
 *   needsWork    is there anything a run can do in this session now?
 *   prepareRun   a run's toolset, the context its tools share, and what only
 *                some of them get, decided by the session's scope alone
 *                (kernel/scope.js): a research step gets its confined
 *                toolset and context, and every other session gets a repo
 *                that cannot rewrite or make sessions or plans, with the two
 *                legitimate writers handed explicit capabilities instead
 *   knownUrls    the document urls a session has seen, for mending one a
 *                model mistyped
 *
 * The same in a pool's run worker, a Node host's thread and a page running a
 * parked call (runners/page.js).
 */

import { stopOf } from "../session/status.js"
import { lastTurn } from "../session/blocks.js"
import { runnableCalls, callsAwaitingApproval, questionsAwaitingAnswer } from "../session/calls.js"
import { hasDebris } from "../session/recovery.js"
import { scopeOf, assertScopeAgrees, confine, scopedToolset } from "./scope.js"
import { kernelRepo } from "./kernel-repo.js"
import { urlsIn } from "../documents/doc-urls.js"
import { rememberOwn } from "./own-changes.js"
import { watchesWriter } from "./store.js"
import { fullTools, toolsetOf } from "./toolset.js"

/**
 * The document URLs this conversation has seen — its subject, what it made,
 * and every URL in its turns — for mending one a model mistyped. Read only
 * when a URL fails its checksum; kept until the conversation grows.
 */
const knownCache = new WeakMap()
export function knownUrls(store) {
  const doc = store?.doc?.()
  if (!doc) return []
  const turns = doc.turns?.length ?? 0
  const cached = knownCache.get(store)
  if (cached?.turns === turns) return cached.urls
  const text = JSON.stringify({ subject: doc.subject ?? null, made: doc.made ?? [], turns: (doc.turns ?? []).map((t) => (t.blocks ?? []).map((b) => (b.image ? { ...b, image: null } : b))) })
  // Newest first, so a suggestion favours what was mentioned last.
  const urls = urlsIn(text).reverse()
  knownCache.set(store, { turns, urls })
  return urls
}

/**
 * Is there anything for a run to do in this session now?
 *
 * Aware of what the asker can run on purpose. A run cannot run a call that
 * needs a page (`canRun`), so such a call is a page's work, not a run's
 * (runners/page.js): asking a run for it would park it again for ever.
 *
 * Deliberately conservative otherwise: a session with a pending approval is not
 * work, and neither is one whose last word was the agent's or the harness's.
 * That is what stops a run spinning on a failed session: the failure is said
 * in a notice (session/blocks.js), an assistant-role turn, so the next look
 * sees nothing to do until someone speaks.
 *
 * `holder` is the run marks are judged against (session/recovery.js
 * hasDebris): by default the one the session's `burst` names, so a mark that
 * does not name it, or any mark while `burst` is null, is debris, and debris
 * is work.
 */
export function needsWork(doc, canRun = () => true, holder = undefined) {
  if (!doc) return false
  // A stop in force, first: a person's, a workflow's, a failure, a budget.
  // Nothing the session holds is work until it is spoken to again — not a
  // call that finished after the stop, its result landing last, not a reply
  // or a call a run left marked, not a call cleared to run
  // (session/status.js stopOf). Whatever was cut off is settled by the run
  // that follows the word that ends the stop.
  if (stopOf(doc)) return false
  // A call or a reply whose run went away mid-flight has to be settled
  // before anything else can happen, whatever else the session waits on.
  if (hasDebris(doc, holder === undefined ? (doc.burst?.run ?? null) : holder)) return true
  if (callsAwaitingApproval(doc).length) return false
  // A question the agent asked is work for a person, not for a run.
  if (questionsAwaitingAnswer(doc).length) return false

  const runnable = runnableCalls(doc)
  if (runnable.length) return runnable.some((call) => canRun(call.where ?? "worker"))

  const last = lastTurn(doc)
  if (!last) return false

  // A trailing *tool* turn means results landed and nobody took them back to
  // the model. In a healthy run that never persists — the loop goes straight
  // round again — so seeing it means either an answered question, or a run
  // that went away between its results and its next turn. Both want the same
  // thing: prompt the model. Otherwise an answered question sits there, and a
  // half-finished turn is stranded looking idle.
  return last.role === "user" || last.role === "tool"
}

/**
 * What one run's tools get, decided by the session's scope and nothing else:
 * a toolset, the context they share, and what only some of them get beyond
 * it (`privileged`, which a research step's tools never have). A malformed
 * scope, or one that disagrees with the plan, throws, and the session does
 * not run. A burst (kernel/burst.js) and a page running a parked call
 * (runners/page.js) both build a run this way.
 *
 *   ctx           the context as the host built it, with the repo as it is
 *   store         the session's store
 *   fullCtx       a full-access session's context (fullContext of the two)
 *   builtins      the built-in tools
 *   plugins       () => this run's plugin tools
 *   buildToolset  (doc) => a full-access session's toolset
 *   privileged    () => the privileges of a full-access session's tools
 *   startSession  how this host asks for a workflow step's work, when
 *                 `privileged` is not given
 *   followSession how this host holds a follow on a step's session, likewise
 */
export async function prepareRun(doc, { ctx, store, fullCtx = null, builtins = [], plugins = async () => [], buildToolset = null, privileged = null, startSession = null, followSession = null }) {
  const scope = scopeOf(doc)
  await assertScopeAgrees(doc, scope, ctx.repo)
  if (scope) return { toolset: scopedToolset(doc, { builtins, plugins: await plugins() }), ctx: await confine(ctx, scope), privileged: () => null }
  const toolset = buildToolset ? await buildToolset(doc) : toolsetOf(fullTools(doc, { builtins, plugins: await plugins() }))
  return {
    toolset,
    ctx: fullCtx ?? fullContext(ctx, store),
    privileged: privileged ? privileged() : privileges(ctx, store, { builtins, plugins, startSession, followSession }),
  }
}

/**
 * A full-access session's tool context: the host's own, with two fields put
 * over it.
 *
 *   repo     kernelRepo: works as the repo does, except that nothing it hands
 *            out can change or make a document only the runtime writes
 *            (kernel-repo.js KERNEL_TYPES)
 *   session  this conversation's own document, to read, through the store
 *
 * It is a value: made once, frozen, and the same for every tool of the
 * session, plugins included, so nothing in it writes a session or a plan and
 * no tool can leave anything on it for another. What a host changes under a
 * run — where a page tool mounts, whether fetches go direct — it defines as a
 * getter, and each call reads it afresh (kernel/loop.js spreads the context
 * into the call's own).
 *
 * `record`, when given, is told the hashes of every write as well (a burst
 * reports them to whoever follows it: kernel/burst.js).
 */
export function fullContext(base, store, { record = null } = {}) {
  return Object.freeze(
    Object.defineProperties(
      {},
      {
        ...Object.getOwnPropertyDescriptors(base),
        ...Object.getOwnPropertyDescriptors({
          // Every write through it is noted as this session's (kernel/own-changes.js),
          // so a watch can tell the session's own edits from everyone else's.
          repo: kernelRepo(base.repo, {
            known: () => knownUrls(store),
            record: (hashes) => {
              rememberOwn(store?.url, hashes)
              record?.(hashes)
            },
          }),
          session: { url: store?.url ?? null, doc: () => store.doc() },
        }),
      }
    )
  )
}

/**
 * What only some of a full session's tools get beyond its context: each
 * thing a tool `needs` (session/capabilities.js) that stands for a value.
 *
 *   workflows      the real repo, how this host asks for a step's work
 *                  and holds a follow on its session (`startSession`,
 *                  `follow`, the host's: never in the context) and every
 *                  tool this run has, for the tools that write plans and
 *                  drive step sessions
 *   session.write  this conversation's own document, writable
 *   watches        only the `watches` map in it, writable
 *
 * Only to the run's built-ins, by identity: a plugin cannot take a
 * built-in's id, and a tool that is not one of them gets nothing whatever it
 * declares.
 */
export function privileges(base, store, { builtins = [], plugins = async () => [], startSession = null, followSession = null } = {}) {
  const own = new Set(builtins)
  const values = {
    workflows: {
      workflows: {
        repo: base.repo ?? null,
        startSession,
        follow: followSession,
        tools: async () => ({ builtins, plugins: await plugins() }),
      },
    },
    "session.write": { session: { url: store?.url ?? null, doc: () => store.doc(), change: (fn) => store.change(fn) } },
    watches: { watches: watchesWriter(store) },
  }
  return (tool) => {
    if (!own.has(tool)) return null
    const given = Object.assign({}, ...(tool.needs ?? []).map((need) => values[need] ?? null))
    return Object.keys(given).length ? given : null
  }
}
