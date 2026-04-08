import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { Repo } from '@automerge/automerge-repo';
import type { WorkflowDoc } from '../../workflow/types';

export type { WorkflowDoc } from '../../workflow/types';

// TEMP: for now, we're using default hard-coded data to focus on the tool viewers
import { createDefaultElicitation } from '../default-data/default-elicitation';
import { createDefaultSpec } from '../default-data/default-spec';
import { createDefaultPlan } from '../default-data/default-plan';
import { createDefaultExecution } from '../default-data/default-execution';
import { createDefaultValidation } from '../default-data/default-validation';

export const grjteWorkflowTemplateDatatype: DatatypeImplementation<WorkflowDoc> = {
  init(doc: WorkflowDoc, repo: Repo) {
    const { elicitationDocUrl } = createDefaultElicitation(repo);
    doc.specElicitationDocUrl = elicitationDocUrl;
    doc.toolIds = {
      spec: 'grjte-spec-viewer',
      plan: 'grjte-plan-viewer',
      execution: 'grjte-execution-viewer',
      validation: 'grjte-validation-viewer',
    };

    // TEMP: populate with default data
    const { specDocUrl, subSpecUrls, verificationDatalogUrls } = createDefaultSpec(repo);
    doc.specDocUrl = specDocUrl;

    const { planDocUrl, taskUrls } = createDefaultPlan(repo, specDocUrl, subSpecUrls);
    doc.planDocUrl = planDocUrl;

    const { executionDocUrl, artifactDocUrls } = createDefaultExecution(
      repo,
      specDocUrl,
      planDocUrl,
      taskUrls,
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
