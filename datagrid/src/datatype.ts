import type { Repo } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";

export type DataGridDoc = {
  "@patchwork"?: { type: "datagrid" };
  title: string;

  // NOTE: modeling the data this way does not result in reasonable merges.
  // The correct technique is like this, but we need cursors for
  // arbitrary lists to do that in Automerge:
  // https://mattweidner.com/2022/02/10/collaborative-data-design.html#case-study-a-collaborative-spreadsheet
  data: any[][];
};

export const DatagridDatatype: DatatypeImplementation<DataGridDoc> = {
  init(doc: DataGridDoc, _repo: Repo) {
    const rows = 100;
    const cols = 26;
    doc.title = "Untitled Spreadsheet";
    doc.data = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => "")
    );
  },

  getTitle(doc: DataGridDoc) {
    return doc.title || "Untitled Spreadsheet";
  },

  setTitle(doc: DataGridDoc, title: string) {
    doc.title = title;
  },
};
