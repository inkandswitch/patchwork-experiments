import { type Plugin } from "@inkandswitch/patchwork-plugins";
import { createDocumentAction } from "./createDocument";
import { deleteAction } from "./delete";
import { insertAction } from "./insert";
import { updateAction } from "./update";
import { markdownActions } from "./markdown";
import { viewAction } from "./view";
import { fileActions } from "./file";

export const plugins: Plugin<any>[] = [
  createDocumentAction,
  updateAction,
  markdownActions,
  deleteAction,
  insertAction,
  viewAction,
  ...fileActions,
];
