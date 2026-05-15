import type { BattleDoc } from '../types.ts';

export const BattleDatatype = {
  init(doc: BattleDoc) {
    doc['@patchwork'] = { type: 'spatial-battle' };
    doc.title = 'QR Battle Table';
    doc.waveNumber = 1;
  },
  getTitle(doc: BattleDoc) {
    return doc.title || 'QR Battle Table';
  },
  setTitle(doc: BattleDoc, title: string) {
    doc.title = title;
  },
};
