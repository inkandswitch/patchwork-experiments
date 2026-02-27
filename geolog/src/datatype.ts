import { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { GeologDoc } from './geolog-automerge';

export type { GeologDoc };

export const GeologDatatype: DatatypeImplementation<GeologDoc> = {
  init: (doc: GeologDoc) => {
    doc.theorySrc = '';
    doc.ops = {};
  },
  getTitle(doc: GeologDoc) {
    if (!doc.theory) return 'Untitled Theory';
    try {
      const exported = JSON.parse(doc.theory.toString());
      return (exported.name as string) || 'Untitled Theory';
    } catch {
      return 'Untitled Theory';
    }
  },
  setTitle(_doc: GeologDoc, _title: string) {
    // Theory name is defined within the DSL source; not independently mutable.
  },
};
