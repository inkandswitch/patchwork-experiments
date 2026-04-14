import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { Repo } from '@automerge/automerge-repo';
import type {
  PlanDoc,
  SpecDoc,
  SpecElicitationDoc,
  ExecutionDoc,
  ValidationDoc,
  WorkflowDoc,
  WorkflowArtifactDoc,
  VerificationDoc,
} from './types';

export type { WorkflowDoc } from './types';

type FolderDoc = { docs: { type: string; name: string; url: string }[] };

export const WorkflowDatatype: DatatypeImplementation<WorkflowDoc> = {
  init(doc: WorkflowDoc, repo: Repo) {
    const folderHandle = repo.create<FolderDoc>();
    folderHandle.change((d) => {
      d.docs = [];
    });

    const elicitHandle = repo.create<SpecElicitationDoc & { '@patchwork': { type: string } }>();
    elicitHandle.change((d) => {
      d['@patchwork'] = { type: 'elicitation' };
      d.prompt = '';
      d.referenceDocsFolderUrl = folderHandle.url as any;
    });

    doc.specElicitationDocUrl = elicitHandle.url;
  },
  getTitle() {
    return 'Workflow';
  },
  setTitle() {},
};

export const SpecDatatype: DatatypeImplementation<SpecDoc> = {
  init(doc: SpecDoc) {
    doc.spec = {
      goal: '',
      verificationUrls: [],
    };
  },
  getTitle(doc: SpecDoc) {
    return doc.spec?.goal || 'Spec';
  },
  setTitle(doc: SpecDoc, title: string) {
    if (doc.spec) {
      doc.spec.goal = title;
    }
  },
};

export const VerificationDatatype: DatatypeImplementation<VerificationDoc> = {
  init(doc) {
    doc.script = '';
  },
  getTitle(doc) {
    return doc.title || 'Verification';
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

export const PlanDatatype: DatatypeImplementation<PlanDoc> = {
  init() {},
  getTitle(doc: PlanDoc) {
    return doc.goal || 'Plan';
  },
  setTitle(doc: PlanDoc, title: string) {
    doc.goal = title;
  },
};

export const ExecutionDatatype: DatatypeImplementation<ExecutionDoc> = {
  init() {},
  getTitle() {
    return 'Execution';
  },
  setTitle() {},
};

export const WorkflowArtifactDatatype: DatatypeImplementation<WorkflowArtifactDoc> = {
  init(doc) {
    doc.name = '';
  },
  getTitle(doc: WorkflowArtifactDoc) {
    return doc.name || 'Workflow Artifact';
  },
  setTitle(doc: WorkflowArtifactDoc, title: string) {
    doc.name = title;
  },
};

export const ValidationDatatype: DatatypeImplementation<ValidationDoc> = {
  init() {},
  getTitle(doc: ValidationDoc) {
    return 'Validation for ' + doc.planDocUrl;
  },
  setTitle() {},
};
