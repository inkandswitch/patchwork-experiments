import type { AutomergeUrl } from "@automerge/automerge-repo";

export interface DocLink {
  name: string;
  type: string;
  url: AutomergeUrl;
}

export interface AccountDoc {
  rootFolderUrl: AutomergeUrl;
  accountHistoryUrl?: AutomergeUrl;
  moduleSettingsUrl?: AutomergeUrl;
}

export type CommandCategory = "account" | "document" | "create";

export interface Command {
  name: string;
  description: string;
  category: CommandCategory;
  action: () => void;
}

export const CATEGORY_ORDER: CommandCategory[] = [
  "create",
  "document",
  "account",
];

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  create: "New Document",
  document: "Current Document",
  account: "Account",
};

export type PanelMode =
  | "commands"
  | "search"
  | "new"
  | "tool"
  | "rename"
  | "copy-url"
  | "copy-url-tool";

export interface CopyOption {
  label: string;
  url: string;
}
