import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { ProjectionDoc } from '../artifact-projection';

export const ArtifactProjectionDatatype: DatatypeImplementation<ProjectionDoc> = {
  init() {},
  getTitle(doc: ProjectionDoc) {
    return doc.title || 'Artifact Projection';
  },
  setTitle(doc: ProjectionDoc, title: string) {
    doc.title = title;
  },
};
