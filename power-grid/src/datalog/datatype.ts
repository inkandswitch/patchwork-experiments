import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { StoredFact, StoredRule, StoredConstraint } from './datalog';
import { DEFAULT_FACTS, DEFAULT_RULES, DEFAULT_CONSTRAINTS, DEFAULT_PROGRAM_TEXT } from './defaults';

export type PredicateStyle = {
  color: string | null;
  showLabel: boolean;
};

export type MapStyle = {
  lines: Record<string, PredicateStyle>;
  properties: Record<string, PredicateStyle>;
};

export type DatalogDoc = {
  '@patchwork': { type: 'datalog' };
  facts: StoredFact[];
  rules: StoredRule[];
  constraints: StoredConstraint[];
  draftText: string;
  mapStyle: MapStyle;
};

export const DatalogDatatype: DatatypeImplementation<DatalogDoc> = {
  init(doc: DatalogDoc) {
    doc.facts = DEFAULT_FACTS;
    doc.rules = DEFAULT_RULES;
    doc.constraints = DEFAULT_CONSTRAINTS;
    doc.draftText = DEFAULT_PROGRAM_TEXT;
    doc.mapStyle = { lines: {}, properties: {} };
  },
  getTitle(_doc: DatalogDoc) {
    return 'Datalog Database';
  },
};
