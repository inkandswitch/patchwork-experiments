import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { HasPatchworkMetadata } from '@inkandswitch/patchwork-filesystem';
import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';

export type VerificationContextDoc = HasPatchworkMetadata & {
  verificationUrl: AutomergeUrl;
  artifactUrls: AutomergeUrl[];
  scope?: 'system' | 'artifacts';
  requiredArtifactUrls?: AutomergeUrl[];
  title?: string;
  description?: string;
  viewMode?: 'spec' | 'validation';
};

export const VerificationContextDatatype: DatatypeImplementation<VerificationContextDoc> = {
  init() {},
  getTitle() {
    return 'Verification Context';
  },
  setTitle() {},
};
