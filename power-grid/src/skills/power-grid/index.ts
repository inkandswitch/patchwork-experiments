import type { DocHandle } from '@automerge/automerge-repo';
import {
  evaluate,
  evaluateWithProvenance,
  checkConstraints,
  parseProgram,
  factKey,
} from '../../datalog/datalog';
import type { DatalogDoc } from '../../datalog/datatype';
import type { StoredFact, ConstraintViolation } from '../../datalog/datalog';

function toSwPath(automergeUrl: string): string {
  return automergeUrl.replace('automerge:', '/automerge%3A');
}

export const skillUrl =
  `${toSwPath(__ROOT_DIR_URL__)}/dist/skills/power-grid/index.js`;

// ─── API factory ──────────────────────────────────────────────────────────────

export default function createApi(handle: DocHandle<DatalogDoc>) {
  function currentDoc(): DatalogDoc {
    const doc = handle.doc();
    if (!doc) throw new Error('Document not available');
    return doc;
  }

  function upsertFact(pred: string, matchArgs: (f: StoredFact) => boolean, newFact: StoredFact): void {
    handle.change((d) => {
      const idx = d.facts.findIndex(f => f.pred === pred && matchArgs(f));
      if (idx !== -1) {
        d.facts[idx] = newFact;
      } else {
        d.facts.push(newFact);
      }
    });
  }

  function retractFacts(pred: string, matchArgs: (f: StoredFact) => boolean): void {
    handle.change((d) => {
      const keep = d.facts.filter(f => !(f.pred === pred && matchArgs(f)));
      d.facts.splice(0, d.facts.length, ...keep);
    });
  }

  return {
    /** Assert that an entity supplies a given number of watts. Replaces any existing supply for that entity. */
    assertSupply(entity: string, watts: number): void {
      upsertFact('supply', f => f.args[0] === entity, { pred: 'supply', args: [entity, watts] });
    },

    /** Remove any supply fact for the given entity. */
    retractSupply(entity: string): void {
      retractFacts('supply', f => f.args[0] === entity);
    },

    /** Assert a directed power flow between two nodes. Replaces any existing flow on that edge. */
    assertFlow(from: string, to: string, watts: number): void {
      upsertFact('flow', f => f.args[0] === from && f.args[1] === to, { pred: 'flow', args: [from, to, watts] });
    },

    /** Remove any flow fact between the given nodes. */
    retractFlow(from: string, to: string): void {
      retractFacts('flow', f => f.args[0] === from && f.args[1] === to);
    },

    /**
     * Run a Datalog query against the current document facts and rules.
     *
     * Optionally pass an additional Datalog program string containing
     * extra rules (no new base facts). The extra rules are merged with
     * the doc's existing rules before evaluation.
     *
     * Returns the full set of derived facts as StoredFact[].
     *
     * Examples:
     *   api.query()
     *   api.query(`
     *     inflow(N, Total) :- sum(F, flow(_, N, F), Total).
     *     overloaded(X, Y) :- edge(X, Y, C), flow(X, Y, F), gt(F, C).
     *   `)
     */
    query(programText?: string): StoredFact[] {
      const doc = currentDoc();
      const extraRules = programText ? parseProgram(programText).rules : [];
      const allRules = [...doc.rules, ...extraRules];
      return evaluate(doc.facts, allRules);
    },

    /**
     * Check all constraints stored in the document against the current
     * derived database. Returns an array of ConstraintViolation objects,
     * each containing the violated constraint and witness traces.
     */
    conflicts(): ConstraintViolation[] {
      const doc = currentDoc();
      const { db, provenance } = evaluateWithProvenance(doc.facts, doc.rules);
      const baseFacts = new Set(doc.facts.map(factKey));
      return checkConstraints(db, doc.constraints, provenance, baseFacts);
    },
  };
}

// ─── System prompt description ────────────────────────────────────────────────

export const apiDescription = `\
  api.assertSupply(entity, watts)   — record that an entity supplies power (upserts)
  api.retractSupply(entity)         — remove supply for an entity
  api.assertFlow(from, to, watts)   — record a directed power flow (upserts)
  api.retractFlow(from, to)         — remove a flow between two nodes

  api.query(programText?)           — evaluate Datalog against current facts + rules.
                                      Optionally pass extra rules as a Datalog string.
                                      Returns StoredFact[] (full derived database).
                                      Example: api.query(\`inflow(N,T) :- sum(F,flow(_,N,F),T).\`)

  api.conflicts()                   — run the document's constraints and return
                                      ConstraintViolation[] with witness traces.

  console.log(...)  — output text (captured and shown to you)
  return value      — return a value from the script (shown to you as output)`;
