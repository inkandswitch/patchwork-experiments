import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { SpaceTimeDoc } from './types';

export const SpaceTimeDatatype: DatatypeImplementation<SpaceTimeDoc> = {
  init(doc: SpaceTimeDoc) {
    doc['@patchwork'] = { type: 'space-time' };
    doc.title = 'Untitled Space-time';
    doc.sources = {};
    doc.clips = [];
    doc.playheads = [];
    doc.scribbles = [];
    doc.postIts = [];
    doc.embeds = [];
  },
  getTitle(doc: SpaceTimeDoc) {
    return doc.title;
  },
  setTitle(doc: SpaceTimeDoc, title: string) {
    doc.title = title.trim();
  },
};
