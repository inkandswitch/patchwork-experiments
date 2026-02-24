import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { createTLStore, defaultShapeUtils, type SerializedSchema, type SerializedStore, type TLPage, type TLPageId, type TLRecord } from "@tldraw/tldraw";

import { tldrawValueToAutomergeValue } from "./automerge/TLStoreToAutomerge.ts";
import { PatchworkTokenShapeUtil } from "./PatchworkTokenShape.tsx";
import { PatchworkViewShapeUtil } from "./PatchworkViewShape.tsx";

// SCHEMA
export type TilesDoc = {
  store: SerializedStore<TLRecord>;
  schema: SerializedSchema;
};

const pageKey = "page:page" as TLPageId;

export const getTitle = (doc: TilesDoc) => {
  const page = doc.store[pageKey] as TLPage;
  return page.name.toString() || "Canvas";
};

export const setTitle = (doc: TilesDoc, title: string) => {
  const page = doc.store[pageKey] as TLPage;
  page.name = title;
};

export const init = (doc: TilesDoc) => {
  Object.assign(
    doc,
    tldrawValueToAutomergeValue(
      createTLStore({
        shapeUtils: [...defaultShapeUtils, PatchworkTokenShapeUtil, PatchworkViewShapeUtil],
      }).getStoreSnapshot()
    )
  );
  doc.store[pageKey] = {
    meta: {},
    id: "page:page" as TLPageId,
    index: "a1" as TLPage["index"],
    name: "New Tiles Canvas",
    typeName: "page",
  };
};

export const datatype: DatatypeImplementation<TilesDoc> = {
  init,
  getTitle,
  setTitle,
};
