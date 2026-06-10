import { useMemo } from "react";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import type { FolderDoc } from "../types";

export const getDocumentUrlsByType = (
  folderDocsMap: Map<AutomergeUrl, FolderDoc> | undefined,
  folderUrls: AutomergeUrl[],
  docType: string,
): AutomergeUrl[] => {
  if (!folderDocsMap) return [];

  const docUrls: AutomergeUrl[] = [];

  folderUrls.forEach((folderUrl) => {
    const folderDoc = folderDocsMap.get(folderUrl);
    if (!folderDoc) return;

    folderDoc.docs.forEach((docLink) => {
      if (docLink.type === docType) {
        docUrls.push(docLink.url as AutomergeUrl);
      }
    });
  });

  return docUrls;
};

export const getUniqueFieldValues = <T extends Record<string, unknown>>(
  documents: { url: AutomergeUrl; doc: T }[],
  fieldName: keyof T,
): string[] => {
  if (!documents.length) return [];

  const valueSet = new Set<string>();

  documents.forEach(({ doc }) => {
    const value = doc[fieldName];
    if (value && typeof value === "string") {
      valueSet.add(value);
    }
  });

  return Array.from(valueSet).sort();
};

export const filterDocumentsByField = <T extends Record<string, unknown>>(
  documents: { url: AutomergeUrl; doc: T }[],
  fieldName: keyof T,
  fieldValue: string | null,
  searchQuery: string,
  searchFields: (keyof T)[],
): { url: AutomergeUrl; doc: T }[] => {
  let filtered = documents;

  if (fieldValue) {
    filtered = filtered.filter(({ doc }) => doc[fieldName] === fieldValue);
  }

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(({ doc }) =>
      searchFields.some((field) => {
        const value = doc[field];
        return (
          value &&
          typeof value === "string" &&
          value.toLowerCase().includes(query)
        );
      }),
    );
  }

  return filtered;
};

export const getDocumentTitle = <T extends Record<string, unknown>>(
  doc: T,
  dataType: string,
): string => {
  if (doc.name && typeof doc.name === "string") return doc.name;
  if (doc.title && typeof doc.title === "string") return doc.title;

  const docType = getRegistry("patchwork:datatype")
    .all()
    .find((dt) => dt.id === dataType);
  const typeName = docType?.name || "Document";
  return `Unnamed ${typeName}`;
};
