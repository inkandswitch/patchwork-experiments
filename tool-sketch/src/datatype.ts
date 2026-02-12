import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { type SerializedSchema, type SerializedStore, type TLPage, type TLPageId, type TLRecord, type TLShapeId } from "tldraw";
import { createDefaultStoreSnapshot } from "./automerge-tldraw/default_store.ts";
import { tldrawValueToAutomergeValue } from "./automerge-tldraw/TLStoreToAutomerge.ts";

// SCHEMA
export type TLDrawDoc = {
  store: SerializedStore<TLRecord>;
  schema: SerializedSchema;
};

export type TLDrawDocAnchor = TLShapeId;

const pageKey = "page:page" as TLPageId;

export const getTitle = (doc: TLDrawDoc) => {
  const page = doc.store[pageKey] as TLPage;
  return page.name.toString() || "Tool sketch";
};

export const setTitle = (doc: TLDrawDoc, title: string) => {
  const page = doc.store[pageKey] as TLPage;
  page.name = title;
};

export const init = (doc: TLDrawDoc) => {
  const snapshot = createDefaultStoreSnapshot();
  Object.assign(doc, tldrawValueToAutomergeValue(snapshot));
};

export const datatype: DatatypeImplementation<TLDrawDoc> = {
  init,
  getTitle,
  setTitle,
};
