import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import { createTLStore, defaultShapeUtils, type SerializedSchema, type SerializedStore, type TLPage, type TLPageId, type TLRecord, type TLShapeId } from "@tldraw/tldraw";

import { tldrawValueToAutomergeValue } from "./automerge/TLStoreToAutomerge.ts";
import { PatchworkTokenShapeUtil } from "./PatchworkTokenShape.tsx";

// SCHEMA
export type CreatureSketchDoc = {
  store: SerializedStore<TLRecord>;
  schema: SerializedSchema;
};

export type CreatureSketchDocAnchor = TLShapeId;

const pageKey = "page:page" as TLPageId;

export const getTitle = (doc: CreatureSketchDoc) => {
  const page = doc.store[pageKey] as TLPage;
  return page.name.toString() || "Canvas";
};

export const setTitle = (doc: CreatureSketchDoc, title: string) => {
  const page = doc.store[pageKey] as TLPage;
  page.name = title;
};

export const init = (doc: CreatureSketchDoc) => {
  Object.assign(
    doc,
    tldrawValueToAutomergeValue(
      createTLStore({
        shapeUtils: [...defaultShapeUtils, PatchworkTokenShapeUtil],
      }).getStoreSnapshot()
    )
  );
  doc.store[pageKey] = {
    meta: {},
    id: "page:page" as TLPageId,
    index: "a1" as TLPage["index"],
    name: "New Creature Sketch",
    typeName: "page",
  };
};

export const datatype: DatatypeImplementation<CreatureSketchDoc> = {
  init,
  getTitle,
  setTitle,
};
