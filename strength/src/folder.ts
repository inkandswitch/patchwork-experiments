import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DocLink, FolderDoc } from "./types";

export const EXERCISE_TYPE = "strength-exercise";
export const TEMPLATE_TYPE = "strength-workout-template";
export const SESSION_TYPE = "strength-workout-session";

export const GYM_ROLE = "gym" as const;

export function isGymFolder(doc: FolderDoc): boolean {
  return doc.strengthRole === GYM_ROLE || Boolean(doc.exerciseLibraryUrl);
}

export function linksOfType(doc: FolderDoc, type: string): DocLink[] {
  return (doc.docs ?? []).filter((link) => link.type === type);
}

export function urlsOfType(doc: FolderDoc, type: string): AutomergeUrl[] {
  return linksOfType(doc, type).map((link) => link.url);
}

export function templateLinks(doc: FolderDoc): DocLink[] {
  return linksOfType(doc, TEMPLATE_TYPE);
}

export function sessionLinks(doc: FolderDoc): DocLink[] {
  return linksOfType(doc, SESSION_TYPE);
}

export function addDocLink(folder: FolderDoc, link: DocLink): void {
  if (!folder.docs) folder.docs = [];
  folder.docs.push(link);
}
