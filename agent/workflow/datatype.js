import { PLAN, initPlan } from "./plan.js"

/**
 * The workflow datatype: a plan an orchestrating agent made and its steps'
 * sessions carry out. Usually made by `workflow_start`, not by hand.
 */
export const AgentWorkflowDatatype = {
  // A plan as workflow_start makes one (plan.js initPlan), with nothing in it
  // yet and so nothing to run: one shape, whoever made it.
  init(doc) {
    initPlan(doc, { title: null, goal: "" })
    doc.status = PLAN.done
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
