import type { InstrumentDoc } from '../types.ts';

export const InstrumentDatatype = {
  init(doc: InstrumentDoc) {
    doc['@patchwork'] = { type: 'spatial-instrument' };
    doc.title = 'QR Instrument';
    doc.savedLoops = [];
    doc.tempo = 96;
  },
  getTitle(doc: InstrumentDoc) {
    return doc.title || 'QR Instrument';
  },
  setTitle(doc: InstrumentDoc, title: string) {
    doc.title = title;
  },
};
