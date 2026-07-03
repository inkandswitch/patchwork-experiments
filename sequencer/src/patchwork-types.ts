import { type AutomergeUrl } from "@automerge/automerge-repo";

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
