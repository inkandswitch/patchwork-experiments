import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { ProjectionSpecDoc } from './artifact-projection';

export const ArtifactProjectionDatatype: DatatypeImplementation<ProjectionSpecDoc> = {
  init(doc) {
    doc.schemaVersion = 3;
    doc.sourceType = 'datalog';
    doc.viewKind = 'table';
    doc.view = {};
    doc.rows = {
      entityPredicate: '',
      keyArg: 0,
      entityIdPrefix: 'row',
      order: 'entity-fact-order',
      create: { insertEntityFact: true },
      delete: { mode: 'managed-predicates-only' },
    };
    doc.columns = [];
    doc.verification = {};
  },
  getTitle(doc: ProjectionSpecDoc) {
    return doc.title || 'Artifact Projection';
  },
  setTitle(doc: ProjectionSpecDoc, title: string) {
    doc.title = title;
  },
};
