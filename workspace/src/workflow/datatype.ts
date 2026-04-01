import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { WorkflowDoc } from './types';
import type { ElicitationDoc } from '../types';

export type { WorkflowDoc } from './types';

type FolderDoc = {
  '@patchwork'?: { type: string };
  title: string;
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

export const WorkflowDatatype: DatatypeImplementation<WorkflowDoc> = {
  init(doc: WorkflowDoc, repo: Repo) {
    const folderHandle = repo.create<FolderDoc>();
    folderHandle.change((d) => {
      d['@patchwork'] = { type: 'folder' };
      d.title = 'Reference Docs';
      d.docs = [];
    });

    const elicitationHandle = repo.create<ElicitationDoc>();
    elicitationHandle.change((d) => {
      d['@patchwork'] = { type: 'elicitation' };
      d.prompt = '';
      d.referenceDocsFolderUrl = folderHandle.url;
    });

    doc.specElicitationDocUrl = elicitationHandle.url;
  },
  getTitle() {
    return 'Workflow';
  },
  setTitle() {},
};
