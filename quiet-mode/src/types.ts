import { AutomergeUrl } from "@automerge/automerge-repo";

/**
 * The account document for a Patchwork frame.
 *
 * Scalar configuration (frame/sidebar/toolbar tool ids) is populated eagerly
 * by AccountDatatype.init. Subdocument URLs (rootFolderUrl, moduleSettingsUrl,
 * contactUrl) are optional and are lazily populated by the frame on first
 * mount via createDocOfDatatype2 of their respective datatypes.
 */
export type AccountDoc = {
  frameToolId: string;
  accountSidebarToolId: string;
  contextSidebarToolId: string;
  contextToolIds: string[];
  documentToolbarToolIds: string[];

  rootFolderUrl?: AutomergeUrl;
  moduleSettingsUrl?: AutomergeUrl;
  contactUrl?: AutomergeUrl;
};

/** @deprecated use AccountDoc */
export type TinyPatchworkConfigDoc = AccountDoc;
