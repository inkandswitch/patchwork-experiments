import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { Repo } from '@automerge/automerge-repo';

export type AccountDoc = {
  contactUrl?: AutomergeUrl;
};

export type ContactDoc =
  | { type: 'anonymous'; color?: string }
  | { type: 'registered'; name: string; color?: string; avatarUrl?: AutomergeUrl };

declare global {
  interface Window {
    accountDocHandle?: { url: AutomergeUrl; doc: () => AccountDoc | undefined };
    repo?: Repo;
  }
}
