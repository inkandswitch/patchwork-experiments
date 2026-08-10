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
    <div className="lanes card-tool">
      <div className="card-tool__stack">
        <div>
          <input
            ref={firstFieldRef}
            type="text"
            value={doc.title || ""}
            onChange={(e) =>
              changeDoc((d) => updateText(d, ["title"], e.target.value))
            }
            className="card-tool__title"
            placeholder="Title"
          />
        </div>

        <div className="card-fields">
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
                  className="card-fields__tag"
                  style={{ lineHeight: 1, minHeight: "1.5em" }}
                  title="Change field configuration"
                >
                  {fieldConfigDoc.title}
                </span>
              ) : null
            }
          />
          <div className="card-fields__grid">
            {fields.map((field) => (
              <React.Fragment key={field.id}>
                <label className="card-fields__label">
                  {field.name}
                </label>
                {field.type === "text" && (
                  <input
                    type="text"
                    value={(getFieldValue(field.id) as string) || ""}
                    onChange={(e) => updateFieldValue(field.id, e.target.value)}
                    className="input input--sm"
                  />
                )}
                {field.type === "number" && (
                  <input
                    type="number"
                    value={(getFieldValue(field.id) as number) || ""}
                    onChange={(e) =>
                      updateFieldValue(field.id, Number(e.target.value))
                    }
                    className="input input--sm"
                  />
                )}
                {field.type === "date" && (
                  <input
                    type="date"
                    value={(getFieldValue(field.id) as string) || ""}
                    onChange={(e) => updateFieldValue(field.id, e.target.value)}
                    className="input input--sm"
                  />
                )}
                {field.type === "checkbox" && (
                  <span className="card-fields__checkbox">
                    <input
                      type="checkbox"
                      checked={(getFieldValue(field.id) as boolean) || false}
                      onChange={(e) =>
                        updateFieldValue(field.id, e.target.checked)
                      }
                      className="checkbox"
                    />
                    <span className="card-fields__hint">Enable</span>
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
                    className="card-fields__select"
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="card-body">
          <div className="card-body__bar">
            <div className="menu-anchor" ref={createMenuRef}>
              <button
                type="button"
                onClick={() => setIsCreateMenuOpen(!isCreateMenuOpen)}
                className="btn btn--ghost btn--sm"
              >
                <Icon type="Plus" />
                {doc.bodyDocUrl ? "Change Document" : "Add Document"}
              </button>
              {isCreateMenuOpen && (
                <div className="menu">
                  <div className="menu__inner">
                    <input
                      type="text"
                      placeholder="Paste document URL"
                      value={newBodyUrl || ""}
                      onChange={(e) => setNewBodyUrl(e.target.value)}
                      className="input menu__input"
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
                      className="btn btn--primary btn--block"
                    >
                      Apply Document
                    </button>
                    <div className="menu__label">
                      Or create new:
                    </div>
                    <div className="menu__items">
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
                            className="menu__item"
                          >
                            <Icon type={dataType.icon || "File"} />
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
            <div className="card-body__doc">
              <patchwork-view
                doc-url={doc.bodyDocUrl}
                className="card-body__view"
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
    <div className="lanes compact-card">
      <h3 className="compact-card__title">{doc.title}</h3>
      <div className="compact-card__chips">
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
              className="chip"
            >
              {field.name}: {displayValue}
            </span>
          );
        })}
      </div>
    </div>
  );
}
