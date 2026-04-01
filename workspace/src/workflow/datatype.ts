import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { Repo } from '@automerge/automerge-repo';
import type { WorkflowDoc } from './types';
import type { ElicitationDoc } from '../types';

export type { WorkflowDoc } from './types';

export const WorkflowDatatype: DatatypeImplementation<WorkflowDoc> = {
  init(doc: WorkflowDoc, repo: Repo) {
    const elicitationHandle = repo.create<ElicitationDoc>();
    elicitationHandle.change((d) => {
      d['@patchwork'] = { type: 'elicitation' };
      d.prompt = '';
      d.docs = {};
    });
    doc.specElicitationDocUrl = elicitationHandle.url;
  },
  getTitle() {
    return 'Workflow';
  },
  setTitle() {
    // Title is not editable for workflow
  },
};
