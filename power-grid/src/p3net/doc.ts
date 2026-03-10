import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { NetState } from './lib';

export type { NetState };

export type P3NetDoc = {
  '@patchwork': {
    type: 'p3net';
    suggestedImportUrl?: string;
  };
  sourceUrl: AutomergeUrl;
  tokens: NetState;
};

export type SourceDoc = {
  name: string;
  extension: string;
  mimeType: string;
  content: string;
};
