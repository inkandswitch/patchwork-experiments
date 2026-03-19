import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { FolderDoc, DocLink, HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';
import type { P3NetDoc, SourceDoc } from './doc';
import { makeDefaultSource } from './defaults';

const MARKDOWN_IMPORT_URL = 'automerge:dhkuYMpSttbRJPBJ7J5XST28bu7';

function makeMarkdownDoc(repo: Parameters<DatatypeImplementation<P3NetDoc>['init']>[1], content: string) {
  const h = repo.create<any>();
  h.change((d: any) => {
    d['@patchwork'] = { type: 'markdown', suggestedImportUrl: MARKDOWN_IMPORT_URL };
    d.content = content;
  });
  return h;
}

function makeSourceFolder(repo: Parameters<DatatypeImplementation<P3NetDoc>['init']>[1]) {
  const jsHandle = repo.create<SourceDoc & HasPatchworkMetadata>();
  jsHandle.change((d) => {
    d['@patchwork'] = { type: 'file' };
    d.name = 'net.js';
    d.extension = 'js';
    d.mimeType = 'application/javascript';
    d.content = makeDefaultSource();
  });

  const pkgHandle = repo.create<SourceDoc & HasPatchworkMetadata>();
  pkgHandle.change((d) => {
    d['@patchwork'] = { type: 'file' };
    d.name = 'package.json';
    d.extension = 'json';
    d.mimeType = 'application/json';
    d.content = JSON.stringify({ name: 'net', main: 'net.js' });
  });

  const folderHandle = repo.create<FolderDoc & HasPatchworkMetadata>();
  folderHandle.change((d) => {
    d['@patchwork'] = { type: 'folder' };
    d.title = 'net';
    d.docs = [
      { name: 'net.js', type: 'file', url: jsHandle.url } as DocLink,
      { name: 'package.json', type: 'file', url: pkgHandle.url } as DocLink,
    ];
  });

  return folderHandle;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const P3NetDatatype: DatatypeImplementation<P3NetDoc> = {
  init(doc, repo) {
    const folderHandle = makeSourceFolder(repo);

    const prompt1 = makeMarkdownDoc(repo,
      '# Sandra\n\nYou are a character named Sandra who hates ice cream. Add a line of dialog that matches your character.',
    );
    const prompt2 = makeMarkdownDoc(repo,
      '# Bob\n\nYou are a character named Bob who loves ice cream. Add a line of dialog that matches your character.',
    );
    const solution = makeMarkdownDoc(repo, '# Untitled');

    doc.sourceUrl = folderHandle.url;
    doc.tokens = {
      prompts: [
        { id: makeId(), state: { type: 'prompt', documentUrl: prompt1.url } },
        { id: makeId(), state: { type: 'prompt', documentUrl: prompt2.url } },
      ],
      solutions: [
        { id: makeId(), state: { type: 'solution', documentUrl: solution.url } },
      ],
    };
  },

  getTitle(_doc) {
    return 'P3 Net';
  },
};
