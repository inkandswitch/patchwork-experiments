import { AutomergeUrl } from "@automerge/automerge-repo";

// copied from contact tool
export interface AnonymousContactDoc {
  type: "anonymous";
  color?: string; // HSL color string for user presence indicators
}

export interface RegisteredContactDoc {
  type: "registered";
  name: string;
  avatarUrl?: AutomergeUrl;
  color?: string; // HSL color string for user presence indicators
}

export type ContactDoc = AnonymousContactDoc | RegisteredContactDoc;
