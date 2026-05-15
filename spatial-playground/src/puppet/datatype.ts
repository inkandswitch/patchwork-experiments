import type { PuppetDoc } from '../types.ts';

export const PuppetDatatype = {
  init(doc: PuppetDoc) {
    doc['@patchwork'] = { type: 'spatial-puppet' };
    doc.title = 'VRM Puppet';
    doc.avatarUrl = '';
    doc.recordedFrames = [];
  },
  getTitle(doc: PuppetDoc) {
    return doc.title || 'VRM Puppet';
  },
  setTitle(doc: PuppetDoc, title: string) {
    doc.title = title;
  },
};
