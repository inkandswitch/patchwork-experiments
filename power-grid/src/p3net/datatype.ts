import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { P3NetDoc, SourceDoc } from './doc';
import { makeDefaultSource } from './defaults';
import type { HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';

const MARKDOWN_IMPORT_URL = 'automerge:dhkuYMpSttbRJPBJ7J5XST28bu7';

function makeMarkdownDoc(repo: Parameters<DatatypeImplementation<P3NetDoc>['init']>[1], content: string) {
  const h = repo.create<any>();
  h.change((d: any) => {
    d['@patchwork'] = { type: 'markdown', suggestedImportUrl: MARKDOWN_IMPORT_URL };
    d.content = content;
  });
  return h;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

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

    const prompt1 = makeMarkdownDoc(repo,
      '# Sandra\n\nYou are a character named Sandra who hates ice cream. Add a line of dialog that matches your character.',
    );
    const prompt2 = makeMarkdownDoc(repo,
      '# Bob\n\nYou are a character named Bob who loves ice cream. Add a line of dialog that matches your character.',
    );
    const solution = makeMarkdownDoc(repo, '# Untitled');

    doc.sourceUrl = sourceHandle.url;
    doc.tokens = {
      prompts: [
        { id: makeId(), state: { type: 'prompt', prompt: prompt1.url } },
        { id: makeId(), state: { type: 'prompt', prompt: prompt2.url } },
      ],
      solutions: [
        { id: makeId(), state: { type: 'solution', document: solution.url } },
      ],
    };
  },

  getTitle(_doc) {
    return 'P3 Net';
  },
};
