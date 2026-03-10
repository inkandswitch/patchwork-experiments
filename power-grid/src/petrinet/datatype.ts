import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { PetrinetDoc } from './net';
import { DEFAULT_PETRINET_TEXT } from './defaults';

export const PetrinetDatatype: DatatypeImplementation<PetrinetDoc> = {
  init(doc: PetrinetDoc) {
    doc.source = DEFAULT_PETRINET_TEXT;
  },

  getTitle(_doc: PetrinetDoc) {
    return 'Petri Net';
  },

  setTitle(_doc: PetrinetDoc, _title: string) {
    // no-op
  },
};
