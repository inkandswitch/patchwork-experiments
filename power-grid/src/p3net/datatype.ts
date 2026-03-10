import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { P3NetDoc, SourceDoc } from './doc';
import { makeDefaultSource } from './defaults';
import type { HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';

export const P3NetDatatype: DatatypeImplementation<P3NetDoc> = {
  init(doc, repo) {
    const sourceHandle = repo.create<SourceDoc & HasPatchworkMetadata>();
    sourceHandle.change((d) => {
      d['@patchwork'] = { type: 'file' };
      d.name = 'net.js';
      d.extension = 'js';
      d.mimeType = 'application/javascript';
      d.content = makeDefaultSource();
    });

    doc.sourceUrl = sourceHandle.url;
    doc.tokens = {};
  },

  getTitle(_doc) {
    return 'P3 Net';
  },
};
