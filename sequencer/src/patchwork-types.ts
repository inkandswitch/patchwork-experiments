import { type AutomergeUrl } from "@automerge/automerge-repo";

// Patchwork-next account/layout document
export type TinyPatchworkLayoutDoc = {
  contactUrl: AutomergeUrl;
  rootFolderUrl: AutomergeUrl;
  moduleSettingsUrl: AutomergeUrl;
  frameToolId: string;
  accountSidebarToolId: string;
  contextSidebarToolId: string;
  contextToolIds: string[];
  documentToolbarToolIds: string[];
};

// Contact document types from patchwork-next
export interface AnonymousContactDoc {
  type: "anonymous";
  color?: string;
}

export interface RegisteredContactDoc {
  type: "registered";
  name: string;
  avatarUrl?: AutomergeUrl;
  color?: string;
}

export type ContactDoc = AnonymousContactDoc | RegisteredContactDoc;

// Extend Window to include accountDocHandle
declare global {
  interface Window {
    accountDocHandle?: { url: AutomergeUrl };
  }
}
