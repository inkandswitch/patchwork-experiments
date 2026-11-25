import { PLAN, DEFAULT_LIMITS, DEFAULT_TIER_MODELS } from "./plan.js"

/**
 * The workflow datatype: a plan an orchestrating agent made and its steps'
 * sessions carry out. Usually made by `workflow_start`, not by hand.
 */
export const AgentWorkflowDatatype = {
  init(doc) {
    doc["@patchwork"] = { type: "agent-workflow" }
    doc.title = null
    doc.goal = ""
    doc.status = PLAN.done
    doc.tiers = { ...DEFAULT_TIER_MODELS }
    doc.limits = { ...DEFAULT_LIMITS }
    doc.usage = { in: 0, out: 0 }
    doc.steps = []
    // The research steps' ledger, opened by the driver when one is needed,
    // and where it is filed for people (WORKFLOW.md).
    doc.ledgerUrl = null
    doc.sourcesFolderUrl = null
    doc.sourcesFiled = {}
  },
  getTitle(doc) {
    return doc.title || "Workflow"
  },
  setTitle(doc, title) {
    doc.title = title
  },
  markCopy(doc) {
    doc.title = `Copy of ${this.getTitle(doc)}`
    // A copy must not inherit the lease, nor look like it is running: its
    // steps' sessions belong to the original.
    doc.lease = null
    if (doc.status === PLAN.running) doc.status = PLAN.stopped
  },
}

export default AgentWorkflowDatatype
