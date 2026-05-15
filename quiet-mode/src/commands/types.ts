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

export type CommandCategory = "account" | "document" | "create" | "view";

export interface Command {
  name: string;
  description: string;
  category: CommandCategory;
  action: () => void;
}

export const CATEGORY_ORDER: CommandCategory[] = [
  "create",
  "document",
  "view",
  "account",
];

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  create: "New Document",
  document: "Current Document",
  view: "View",
  account: "Account",
};

export interface SidebarControls {
  setIsSidebarCollapsed: (value: boolean) => void;
  setIsRightSidebarCollapsed: (value: boolean) => void;
  isSidebarCollapsed: () => boolean;
  isRightSidebarCollapsed: () => boolean;
}

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
