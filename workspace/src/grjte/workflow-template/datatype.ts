import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, Repo } from '@automerge/automerge-repo';
import type { WorkflowDoc } from '../../workflow/types';
import type { ElicitationDoc } from '../../types';

export type { WorkflowDoc } from '../../workflow/types';

// TEMP: for now, we're using default hard-coded data to focus on the tool viewers
import { createDefaultSpec } from '../default-data/default-spec';
import { createDefaultPlan } from '../default-data/default-plan';
import { createDefaultExecution } from '../default-data/default-execution';
import { createDefaultValidation } from '../default-data/default-validation';

type FolderDoc = {
  '@patchwork'?: { type: string };
  title: string;
  docs: { type: string; name: string; url: AutomergeUrl }[];
};

export const grjteWorkflowTemplateDatatype: DatatypeImplementation<WorkflowDoc> = {
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
    doc.toolIds = {
      spec: 'grjte-spec-viewer',
      plan: 'grjte-plan-viewer',
      // execution: 'grjte-execution-viewer',
      validation: 'grjte-validation-viewer',
    };

    // TEMP: populate with default data
    const { specDocUrl, subSpecUrls, verificationDatalogUrls } = createDefaultSpec(repo);
    doc.specDocUrl = specDocUrl;

    const { planDocUrl } = createDefaultPlan(repo, specDocUrl, subSpecUrls);
    doc.planDocUrl = planDocUrl;

    const { executionDocUrl, artifactDocUrls } = createDefaultExecution(
      repo,
      specDocUrl,
      planDocUrl,
      verificationDatalogUrls,
    );
    doc.executionDocUrl = executionDocUrl;

    const { validationDocUrl } = createDefaultValidation(
      repo,
      planDocUrl,
      specDocUrl,
      artifactDocUrls,
      executionDocUrl,
    );
    doc.validationDocUrl = validationDocUrl;
  },
  getTitle() {
    return 'grjte Workflow Template';
  },
  setTitle() {},
};
