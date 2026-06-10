import {
  useDocument,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AnyDocumentId, AutomergeUrl } from "@automerge/automerge-repo";
import { updateText } from "@automerge/automerge-repo";
import React, { useEffect, useRef, useState } from "react";
import {
  setProjectCardFieldValue,
} from "../automerge-fields";
import { createDocOfType } from "../create-doc";
import type {
  FieldConfigurationDoc,
  ProjectCardDoc,
} from "../datatype";
import { useDatatypePlugins } from "../hooks";
import { Icon } from "../ui";
import { ConfigMenu } from "./ConfigMenu";
import { NotionSelect } from "./NotionSelect";

const useProjectCard = (docUrl: AnyDocumentId) => {
  const [doc, changeDoc] = useDocument<ProjectCardDoc>(docUrl, {
    suspense: true,
  });
  const [fieldConfigDoc, setFieldConfigDoc] =
    useState<FieldConfigurationDoc | null>(null);
  const [isConfigMenuOpen, setIsConfigMenuOpen] = useState(false);

  const [configDoc] = useDocument<FieldConfigurationDoc>(
    (doc?.fieldConfigUrl as AnyDocumentId) || undefined,
  );

  useEffect(() => {
    if (configDoc) {
      setFieldConfigDoc(configDoc);
    } else {
      setFieldConfigDoc(null);
    }
  }, [configDoc]);

  const updateFieldValue = (fieldId: string, value: unknown) => {
    changeDoc((d) => {
      setProjectCardFieldValue(d, fieldId, value);
    });
  };

  const getFieldValue = (fieldId: string) => {
    const value = doc?.values.find((v) => v.fieldId === fieldId);
    return value?.value;
  };

  const setBodyDocUrl = (url: string | null) => {
    changeDoc((d) => {
      d.bodyDocUrl = url as AutomergeUrl | null;
    });
  };

  const setFieldConfigUrl = (url: string | null) => {
    changeDoc((d) => {
      d.fieldConfigUrl = url as AutomergeUrl | null;
    });
  };

  return {
    doc,
    changeDoc,
    updateFieldValue,
    getFieldValue,
    setBodyDocUrl,
    setFieldConfigUrl,
    fieldConfigDoc,
    isConfigMenuOpen,
    setIsConfigMenuOpen,
  };
};

export function CardEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const repo = useRepo();
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [newBodyUrl, setNewBodyUrl] = useState<string | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const card = useProjectCard(docUrl);

  const { doc, changeDoc, getFieldValue, updateFieldValue, fieldConfigDoc } =
    card;
  const fields = fieldConfigDoc?.fields || [];
  const dataTypes = useDatatypePlugins();

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const handleCreateNewDocument = async (dataTypeId: string) => {
    const newDocHandle = await createDocOfType(dataTypeId, repo);
    changeDoc((d) => {
      d.bodyDocUrl = newDocHandle.url;
    });
    setIsCreateMenuOpen(false);
  };

  if (!card || !doc) return null;

  return (
    <div className="lanes flex h-full flex-col overflow-y-auto p-4 text-base-content">
      <div className="relative flex h-full flex-col space-y-4">
        <div>
          <input
            ref={firstFieldRef}
            type="text"
            value={doc.title || ""}
            onChange={(e) =>
              changeDoc((d) => updateText(d, ["title"], e.target.value))
            }
            className="mb-2 w-full border-b border-base-300 bg-transparent px-1 py-1 text-xl font-semibold focus:border-primary focus:outline-none"
            placeholder="Title"
          />
        </div>

        <div className="relative mt-2 rounded-md border border-base-300 bg-base-100 p-4">
          <ConfigMenu
            fieldConfigUrl={doc?.fieldConfigUrl || undefined}
            onConfigChange={(url) => {
              changeDoc((draft) => {
                draft.fieldConfigUrl = url;
              });
            }}
            dialogTrigger={
              fieldConfigDoc?.title ? (
                <span
                  className="absolute -top-3 left-3 z-10 -ml-1 -mr-1 cursor-pointer rounded border border-base-300 bg-base-100 px-1 py-0.5 text-[11px] font-medium text-base-content/70 shadow-sm hover:bg-base-200 focus:outline-none"
                  style={{ lineHeight: 1, minHeight: "1.5em" }}
                  title="Change field configuration"
                >
                  {fieldConfigDoc.title}
                </span>
              ) : null
            }
          />
          <div className="grid grid-cols-[max-content_1fr] items-center gap-x-2 gap-y-2">
            {fields.map((field) => (
              <React.Fragment key={field.id}>
                <label className="whitespace-nowrap pr-2 text-right text-xs font-medium text-base-content">
                  {field.name}
                </label>
                {field.type === "text" && (
                  <input
                    type="text"
                    value={(getFieldValue(field.id) as string) || ""}
                    onChange={(e) => updateFieldValue(field.id, e.target.value)}
                    className="input input-bordered input-sm w-full"
                  />
                )}
                {field.type === "number" && (
                  <input
                    type="number"
                    value={(getFieldValue(field.id) as number) || ""}
                    onChange={(e) =>
                      updateFieldValue(field.id, Number(e.target.value))
                    }
                    className="input input-bordered input-sm w-full"
                  />
                )}
                {field.type === "date" && (
                  <input
                    type="date"
                    value={(getFieldValue(field.id) as string) || ""}
                    onChange={(e) => updateFieldValue(field.id, e.target.value)}
                    className="input input-bordered input-sm w-full"
                  />
                )}
                {field.type === "checkbox" && (
                  <span className="flex items-center">
                    <input
                      type="checkbox"
                      checked={(getFieldValue(field.id) as boolean) || false}
                      onChange={(e) =>
                        updateFieldValue(field.id, e.target.checked)
                      }
                      className="checkbox checkbox-sm mr-1"
                    />
                    <span className="text-xs text-base-content/60">Enable</span>
                  </span>
                )}
                {(field.type === "select" || field.type === "multiselect") && (
                  <NotionSelect
                    value={
                      (getFieldValue(field.id) as string | string[]) || ""
                    }
                    onChange={(value) => updateFieldValue(field.id, value)}
                    options={field.options || []}
                    multiple={field.multiple}
                    fieldConfigDocUrl={doc.fieldConfigUrl}
                    fieldId={field.id}
                    className="w-full text-sm"
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="flex grow flex-col">
          <div className="mb-2 flex items-center justify-between">
            <div className="relative" ref={createMenuRef}>
              <button
                type="button"
                onClick={() => setIsCreateMenuOpen(!isCreateMenuOpen)}
                className="btn btn-ghost btn-sm gap-2"
              >
                <Icon type="Plus" className="h-4 w-4" />
                {doc.bodyDocUrl ? "Change Document" : "Add Document"}
              </button>
              {isCreateMenuOpen && (
                <div className="absolute left-0 z-10 mt-1 w-64 rounded-lg border border-base-300 bg-base-100 shadow-lg">
                  <div className="p-2">
                    <input
                      type="text"
                      placeholder="Paste document URL"
                      value={newBodyUrl || ""}
                      onChange={(e) => setNewBodyUrl(e.target.value)}
                      className="input input-bordered mb-2 w-full"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (newBodyUrl) {
                          changeDoc((d) => {
                            d.bodyDocUrl = newBodyUrl as AutomergeUrl;
                          });
                          setNewBodyUrl(null);
                          setIsCreateMenuOpen(false);
                        }
                      }}
                      className="btn btn-primary w-full"
                    >
                      Apply Document
                    </button>
                    <div className="mt-2 text-sm text-base-content/60">
                      Or create new:
                    </div>
                    <div className="mt-2 space-y-1">
                      {dataTypes
                        .filter(
                          (dt) =>
                            dt.id !== "project-card" &&
                            dt.id !== "field-configuration",
                        )
                        .map((dataType) => (
                          <button
                            key={dataType.id}
                            type="button"
                            onClick={() =>
                              handleCreateNewDocument(dataType.id)
                            }
                            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-base-200"
                          >
                            <Icon type={dataType.icon || "File"} className="h-4 w-4" />
                            {dataType.name}
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {doc.bodyDocUrl && (
            <div className="grow overflow-hidden rounded-lg border border-base-300">
              <patchwork-view
                doc-url={doc.bodyDocUrl}
                className="h-full"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CompactCardEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const cardData = useProjectCard(docUrl);

  if (!cardData || !cardData.doc) return null;

  const { doc, fieldConfigDoc } = cardData;
  const fields = fieldConfigDoc?.fields || [];

  return (
    <div className="lanes rounded bg-base-100 p-2 text-base-content shadow-sm transition-shadow hover:shadow-md">
      <h3 className="mb-1 truncate text-sm font-medium text-base-content">{doc.title}</h3>
      <div className="flex flex-wrap gap-1">
        {fields.map((field) => {
          const value = doc.values.find((v) => v.fieldId === field.id)?.value;
          if (!value) return null;

          const displayValue = Array.isArray(value)
            ? value.join(", ")
            : value instanceof Date
              ? value.toLocaleDateString()
              : String(value);

          return (
            <span
              key={field.id}
              className="rounded-full bg-base-200 px-1.5 py-0.5 text-xs text-base-content/70"
            >
              {field.name}: {displayValue}
            </span>
          );
        })}
      </div>
    </div>
  );
}
