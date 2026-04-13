/** Serializable datalog document shapes (shared by spec, validation, and artifacts). */

export type Constant = string | number;
export type Term = string;

export type StoredFact = { pred: string; args: Constant[]; comment?: string };
export type StoredAtom = { pred: string; args: Term[] };
export type StoredRule = {
  head: StoredAtom;
  body: StoredAtom[];
  comment?: string;
};
export type StoredConstraint = {
  body: StoredAtom[];
  comment?: string;
  name?: string;
};

export type DatalogDoc = {
  title?: string;
  facts: StoredFact[];
  rules: StoredRule[];
  constraints: StoredConstraint[];
  draftText?: string;
};

import type { HasPatchworkMetadata } from "@inkandswitch/patchwork-filesystem";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { Verification as WorkflowVerification } from "../workflow-types";

export type VerificationDoc = HasPatchworkMetadata &
  WorkflowVerification & {
    title?: string;
    description?: string;
  };

export const VerificationDatatype: DatatypeImplementation<VerificationDoc> = {
  init(doc) {
    doc.script = "";
  },
  getTitle(doc) {
    return doc.title || "Verification";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
