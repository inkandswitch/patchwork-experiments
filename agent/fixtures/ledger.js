import { initLedger } from "../kernel/scope.js"

/** A ledger for `plan`, named by it, as the workflow driver opens one before its first research step. */
export function withLedger(repo, plan) {
  const ledger = repo.create({})
  ledger.change(initLedger)
  plan.change((d) => {
    d.ledgerUrl = ledger.url
  })
  return ledger
}
