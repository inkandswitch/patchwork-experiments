import type { AutomergeUrl } from '@automerge/automerge-repo';

export type AccessLevel = 'read' | 'reviewed' | 'full';

export type WorkspaceDocEntry = {
  type: 'document';
  name: string;
  url: AutomergeUrl;
  accessLevel: AccessLevel;
};

export type WorkspaceToolEntry = {
  type: 'tool';
  name: string;
  url: AutomergeUrl;
  path: string;
  accessLevel: AccessLevel;
};

export type WorkspaceEntry = WorkspaceDocEntry | WorkspaceToolEntry;

export type WorkspaceDoc = {
  title: string;
  entries: WorkspaceEntry[];
  restrictToEntries: boolean;
  mappings?: WorkspaceChange[];
};

export type WorkspaceChange = {
  originalUrl: AutomergeUrl;
  cloneUrl: AutomergeUrl;
  changeType: 'modified' | 'added';
};

export type WorkspaceChanges = {
  getChanges(): WorkspaceChange[];
  mergeAll(): Promise<void>;
  mergeSingle(originalUrl: AutomergeUrl): Promise<void>;
  revertSingle(originalUrl: AutomergeUrl): void;
};
