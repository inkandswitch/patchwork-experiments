import { type Plugin } from "@inkandswitch/patchwork-plugins";
import { createDocumentAction } from "./createDocument";
import { deleteAction } from "./delete";
import { insertAction } from "./insert";
import { updateAction } from "./update";
import { viewAction } from "./view";

export const plugins: Plugin<any>[] = [
  createDocumentAction,
  updateAction,
  deleteAction,
  insertAction,
  viewAction,
];

console.log("actions", 1);
