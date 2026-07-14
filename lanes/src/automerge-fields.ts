import { updateText } from "@automerge/automerge-repo";
import type { ProjectCardDoc } from "./datatype";

export function setAutomergeString(
  doc: Record<string, unknown>,
  path: (string | number)[],
  value: string,
): void {
  updateText(doc, path, value);
}

export function setProjectCardFieldValue(
  doc: ProjectCardDoc,
  fieldId: string,
  value: unknown,
): void {
  const existingValueIndex = [...doc.values].findIndex(
    (v) => v.fieldId === fieldId,
  );

  if (typeof value === "string") {
    if (existingValueIndex >= 0) {
      updateText(doc, ["values", existingValueIndex, "value"], value);
    } else {
      const index = doc.values.length;
      doc.values.push({ fieldId, value: "" });
      updateText(doc, ["values", index, "value"], value);
    }
    return;
  }

  if (existingValueIndex >= 0) {
    doc.values[existingValueIndex].value =
      value as ProjectCardDoc["values"][0]["value"];
  } else {
    doc.values.push({
      fieldId,
      value: value as ProjectCardDoc["values"][0]["value"],
    });
  }
}
