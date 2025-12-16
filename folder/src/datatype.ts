import { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { UnixFileEntry } from '@inkandswitch/patchwork-filesystem';

export type FileDoc = UnixFileEntry;

export const FileDatatype: DatatypeImplementation<FileDoc> = {
  init: (doc: FileDoc) => {
    throw new Error("Can't create empty ");
  },
  getTitle(doc: FileDoc) {
    return doc.name || 'Untitled File';
  },
  setTitle(doc: FileDoc, title: string) {
    doc.name = title;
  },
};
