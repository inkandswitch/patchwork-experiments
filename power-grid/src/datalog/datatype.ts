import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import { DEFAULT_FACTS, DEFAULT_RULES } from './defaults';
import { serializeFacts, serializeRules } from './datalog';

export type DatalogDoc = {
  '@patchwork': { type: 'datalog' };
  factsText: string;
  rulesText: string;
};

export const DatalogDatatype: DatatypeImplementation<DatalogDoc> = {
  init(doc: DatalogDoc) {
    doc.factsText = serializeFacts(DEFAULT_FACTS);
    doc.rulesText = serializeRules(DEFAULT_RULES);
  },
  getTitle(_doc: DatalogDoc) {
    return 'Datalog Database';
  },
};
