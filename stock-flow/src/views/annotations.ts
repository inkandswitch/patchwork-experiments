import { element } from "../charts/svg.ts";
import { notesByTarget } from "../engine/links.ts";
import type { Annotation } from "../types.ts";

/** Every annotation with its target, for the views of linked documents. */
export function annotationList(annotations: Annotation[] | undefined): HTMLElement {
  const list = element("ul", { class: "sf-notes" });
  for (const { target, text } of annotations ?? []) {
    const item = element("li");
    item.append(element("code", {}, target === "." ? "this document" : target), " ", text);
    list.append(item);
  }
  if (!list.children.length) list.append(element("li", { class: "sf-muted" }, "No annotations"));
  return list;
}

/** The note on one row of a `result` or `residuals` array, found by its year. */
export function rowNote(annotations: Annotation[] | undefined, field: string, year: unknown): string | undefined {
  return notesByTarget(annotations).get(`./${field}/${JSON.stringify({ year })}`);
}
