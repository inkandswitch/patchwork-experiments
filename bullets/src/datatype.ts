import type { DataTypeImplementation } from "@inkandswitch/patchwork-plugins";
import { CURRENT_SCHEMA_VERSION } from "./schema.ts";

export type BulletNodeData = {
  content: string;
  title?: string;
  contentType?: string; // "image" for image bullets stored as AM docs
  collapsed?: boolean;
  embedExpanded?: boolean;
  starred: boolean;
  completed?: boolean;
  children: string[]; // ordered list of child IDs
  originParentId?: string;  // parent this node was last moved from
  originIndex?: number;     // index in that parent's children before move
};

export type ImageDoc = {
  data: Uint8Array;
  mimeType: string;
};

export type UndoOp =
  | { type: "splice-out"; parentId: string; childId: string; index: number }
  | { type: "splice-in"; parentId: string; childId: string; index: number }
  | { type: "set-content"; nodeId: string; oldContent: string }
  | { type: "set-title"; nodeId: string; oldTitle: string | undefined }
  | { type: "set-completed"; nodeId: string; oldCompleted: boolean }
  | { type: "create-node"; nodeId: string };

export type BulletsDoc = {
  schemaVersion?: number;
  title: string;
  nodes: Record<string, BulletNodeData>;
  rootId: string;
  starredIds?: string[];
  mirroredIds?: string[];  // node IDs intentionally mirrored by the user
};

export const datatype: DataTypeImplementation<BulletsDoc> = {
  init(doc) {
    doc.schemaVersion = CURRENT_SCHEMA_VERSION;
    doc.title = "Untitled Bullets";
    const rootId = crypto.randomUUID();
    const firstChildId = crypto.randomUUID();
    doc.nodes = {
      [rootId]: {
        content: "",
        starred: false,
        children: [firstChildId],
      },
      [firstChildId]: {
        content: "",
        starred: false,
        children: [],
      },
    };
    doc.rootId = rootId;
  },
  getTitle(doc) {
    return doc.title || "Untitled Bullets";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
