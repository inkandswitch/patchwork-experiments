import type { Repo } from "@automerge/automerge-repo";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DatatypeImplementation } from "@inkandswitch/patchwork-plugins";
import type { FolderDoc } from "./types";

export type LaneDoc = FolderDoc;

export const LanesDatatype: DatatypeImplementation<LaneDoc> = {
  init(doc: LaneDoc, _repo: Repo) {
    doc.title = "Lanes Project";
    doc.docs = [];
  },
  getTitle(doc) {
    return doc.title || "Lanes";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "checkbox"
  | "select"
  | "multiselect";

export interface Field {
  id: string;
  name: string;
  type: FieldType;
  options: string[] | null;
  multiple?: boolean;
}

export type FieldValue = {
  fieldId: string;
  value: string | number | boolean | Date | null;
};

export type ProjectCardDoc = {
  "@patchwork"?: { type: "project-card" };
  title: string;
  fields: Field[];
  values: FieldValue[];
  bodyDocUrl: AutomergeUrl | null;
  fieldConfigUrl: AutomergeUrl | null;
};

export interface FieldConfigurationDoc {
  "@patchwork"?: { type: "field-configuration" };
  title: string;
  description?: string;
  fields: Field[];
}

export const ProjectCardDatatype: DatatypeImplementation<ProjectCardDoc> = {
  init(doc: ProjectCardDoc, _repo: Repo) {
    doc.title = "Untitled Project Card";
    doc.fields = [];
    doc.values = [];
    doc.bodyDocUrl = null;
    doc.fieldConfigUrl = null;
  },
  getTitle(doc) {
    return doc.title || "Project Card";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};

export const FieldConfigurationDatatype: DatatypeImplementation<FieldConfigurationDoc> =
  {
    init(doc: FieldConfigurationDoc, _repo: Repo) {
      doc.title = "Untitled Field Configuration";
      doc.description = "";
      doc.fields = [];
    },
    getTitle(doc) {
      return doc.title || "Field Configuration";
    },
    setTitle(doc, title) {
      doc.title = title;
    },
  };

/** @deprecated use ProjectCardDoc */
export type Doc = ProjectCardDoc;
