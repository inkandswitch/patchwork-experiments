import { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LLMProcessDoc, WorkspaceDoc } from './types';
import { FolderDoc, HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';

export const LLMProcessDatatype: DatatypeImplementation<LLMProcessDoc> = {
  init: (doc: LLMProcessDoc, repo) => {
    doc.title = 'LLM Process';
    doc.config = {
      apiUrl: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-opus-4.6',
    };

    const folderHandle = repo.create<FolderDoc & HasPatchworkMetadata>();
    folderHandle.change((d) => {
      d.title = 'Root';
      d['@patchwork'] = { type: 'folder' };
      d.docs = [];
    });

    const wsHandle = repo.create<WorkspaceDoc & HasPatchworkMetadata>();
    wsHandle.change((ws) => {
      ws['@patchwork'] = { type: 'workspace' };

      ws.rootFolderUrl = folderHandle.url;
      ws.mappings = {};
      ws.linkedUrls = [];
    });
    doc.workspaceUrl = wsHandle.url;

    doc.runs = [];
  },
  getTitle(doc: LLMProcessDoc) {
    return doc.title || 'LLM Process';
  },
};
