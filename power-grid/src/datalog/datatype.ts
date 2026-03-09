import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import { DEFAULT_FACTS_TEXT, DEFAULT_RULES_TEXT } from './defaults';

export type DatalogDoc = {
  '@patchwork': { type: 'datalog' };
  factsText: string;
  rulesText: string;
};

export const DatalogDatatype: DatatypeImplementation<DatalogDoc> = {
  init(doc: DatalogDoc) {
    doc.factsText = DEFAULT_FACTS_TEXT;
    doc.rulesText = DEFAULT_RULES_TEXT;
  },
  getTitle(_doc: DatalogDoc) {
    return 'Datalog Database';
  },
};
