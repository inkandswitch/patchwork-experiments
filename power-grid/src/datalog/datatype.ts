import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import { DEFAULT_FACTS_TEXT, DEFAULT_RULES_TEXT } from './defaults';

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
  factsText: string;
  rulesText: string;
  mapStyle: MapStyle;
};

export const DatalogDatatype: DatatypeImplementation<DatalogDoc> = {
  init(doc: DatalogDoc) {
    doc.factsText = DEFAULT_FACTS_TEXT;
    doc.rulesText = DEFAULT_RULES_TEXT;
    doc.mapStyle = { lines: {}, properties: {} };
  },
  getTitle(_doc: DatalogDoc) {
    return 'Datalog Database';
  },
};
