import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { ObjectTable, PyonpyonDoc } from './types';

export const PyonpyonDatatype: DatatypeImplementation<PyonpyonDoc> = {
  init(doc: PyonpyonDoc) {
    doc['@patchwork'] = { type: 'pyonpyon' };
    doc.title = 'Untitled';
    doc.objProtoId = 0;
    doc.wId = 1;
    doc.objectTable = {
      // obj proto
      0: {
        type: 'obj',
        id: 0,
        props: {
          toString: { type: 'ref', id: 2 },
        } as any,
      },
      // w
      1: { type: 'obj', id: 1, protoId: 0, props: {} },
      // obj proto's toString()
      2: { type: 'fun', id: 2, code: '() => "[obj]"' },
    } satisfies ObjectTable;
  },
  getTitle(doc: PyonpyonDoc) {
    return doc.title?.trim() || 'Pyonpyon';
  },
  setTitle(doc: PyonpyonDoc, title: string) {
    doc.title = title.trim();
  },
};
