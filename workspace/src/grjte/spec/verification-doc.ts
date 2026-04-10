import type { HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';
import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { Verification as WorkflowVerification } from '../../workflow/types';

export type VerificationDoc = HasPatchworkMetadata &
  WorkflowVerification & {
    title?: string;
    description?: string;
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
