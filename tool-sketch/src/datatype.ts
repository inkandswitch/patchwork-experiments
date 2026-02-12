import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { type SerializedSchema, type SerializedStore, type TLPage, type TLPageId, type TLRecord, type TLShapeId } from "tldraw";
import { createDefaultStoreSnapshot } from "./automerge-tldraw/default_store.ts";
import { tldrawValueToAutomergeValue } from "./automerge-tldraw/TLStoreToAutomerge.ts";

// SCHEMA
export type ToolSketchDoc = {
  store: SerializedStore<TLRecord>;
  schema: SerializedSchema;
  moduleFolders?: AutomergeUrl[];
};

export type TLDrawDocAnchor = TLShapeId;

const pageKey = "page:page" as TLPageId;

export const getTitle = (doc: ToolSketchDoc) => {
  const page = doc.store[pageKey] as TLPage;
  return page.name.toString() || "Tool sketch";
};

export const setTitle = (doc: ToolSketchDoc, title: string) => {
  const page = doc.store[pageKey] as TLPage;
  page.name = title;
};

export const init = (doc: ToolSketchDoc) => {
  const snapshot = createDefaultStoreSnapshot();
  Object.assign(doc, tldrawValueToAutomergeValue(snapshot));

  setTitle(doc, "Tool sketch");
  doc.moduleFolders = [];
};

export const datatype: DatatypeImplementation<ToolSketchDoc> = {
  init,
  getTitle,
  setTitle,
};
