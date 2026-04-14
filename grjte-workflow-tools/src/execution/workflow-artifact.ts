import { DatatypeImplementation } from "@inkandswitch/patchwork-plugins/dist/datatypes";
import { WorkflowArtifactDoc } from "../workflow-types";

export const WorkflowArtifactDatatype: DatatypeImplementation<WorkflowArtifactDoc> = {
  init(doc) {
    doc.name = "";
    doc.artifactType = "datalog";
  },
  getTitle(doc: WorkflowArtifactDoc) {
    return doc.name || "Workflow Artifact";
  },
  setTitle(doc: WorkflowArtifactDoc, title: string) {
    doc.name = title;
  },
};
