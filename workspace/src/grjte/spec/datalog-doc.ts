/** Serializable datalog document shapes (shared by spec, validation, and artifacts). */

export type Constant = string | number;
export type Term = string;

export type StoredFact = { pred: string; args: Constant[]; comment?: string };
export type StoredAtom = { pred: string; args: Term[] };
export type StoredRule = { head: StoredAtom; body: StoredAtom[]; comment?: string };
export type StoredConstraint = { body: StoredAtom[]; comment?: string; name?: string };

export type DatalogDoc = {
  title?: string;
  facts: StoredFact[];
  rules: StoredRule[];
  constraints: StoredConstraint[];
  draftText?: string;
};
