import React, { useEffect, useMemo, useState } from "react";
import {
  useDocument,
  useDocuments,
  useRepo,
} from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { createDocOfType } from "../create-doc";
import { setProjectCardFieldValue } from "../automerge-fields";
import type { FieldConfigurationDoc, ProjectCardDoc } from "../datatype";
import type { FolderDoc } from "../types";
import { Dialog, DialogContent, Icon } from "../ui";
import { ConfigMenu } from "./ConfigMenu";

interface CardDoc {
  title: string;
  url: AutomergeUrl;
  fieldConfigUrl?: AutomergeUrl;
  fields: ProjectCardDoc["fields"];
  values: ProjectCardDoc["values"];
}

export function LaneViewEditor({ docUrl }: { docUrl: AutomergeUrl }) {
  const [folderDoc, changeFolderDoc] = useDocument<FolderDoc>(docUrl, {
    suspense: true,
  });

  const [selectedCardUrl, setSelectedCardUrl] = useState<AutomergeUrl | null>(
    null,
  );
  const [fieldConfigDoc, setFieldConfigDoc] =
    useState<FieldConfigurationDoc | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [filterField, setFilterField] = useState<string | null>(null);
  const [filterValue, setFilterValue] = useState<string | null>(null);
  const [filterAvailableValues, setFilterAvailableValues] = useState<
    Set<string>
  >(new Set());
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const repo = useRepo();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedCardUrl(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const projectCardUrls = useMemo(() => {
    if (!folderDoc?.docs) return [];
    return folderDoc.docs
      .filter((doc) => doc.type === "project-card")
      .map((doc) => doc.url);
  }, [folderDoc?.docs]);

  const fieldConfigUrl = useMemo(() => {
    if (!folderDoc?.docs) return undefined;
    return folderDoc.docs.find((doc) => doc.type === "field-configuration")
      ?.url;
  }, [folderDoc?.docs]);

  const [configDoc] = useDocument<FieldConfigurationDoc>(
    fieldConfigUrl || undefined,
    { suspense: false },
  );

  useEffect(() => {
    const createFieldConfig = async () => {
      if (!fieldConfigUrl && folderDoc?.docs) {
        const newFieldConfig = await createDocOfType<FieldConfigurationDoc>(
          "field-configuration",
          repo,
          (doc) => {
            doc.title = "Default Field Configuration";
            doc.description = "Default field configuration for cards";
            doc.fields = [];
          },
        );

        changeFolderDoc((d) => {
          d.docs.push({
            name: "Field Configuration",
            type: "field-configuration",
            url: newFieldConfig.url,
          });
        });
      }
    };

    void createFieldConfig();
  }, [fieldConfigUrl, folderDoc?.docs, repo, changeFolderDoc]);

  useEffect(() => {
    if (configDoc) {
      setFieldConfigDoc(configDoc);
      if (configDoc.fields.length > 0) {
        setSelectedField(configDoc.fields[0].id);
      }
    } else {
      setFieldConfigDoc(null);
    }
  }, [configDoc]);

  const [cardDocs] = useDocuments<CardDoc>(projectCardUrls || [], {
    suspense: false,
  });

  useEffect(() => {
    if (!cardDocs) return;

    if (filterField) {
      const values = new Set<string>();
      cardDocs.forEach((card) => {
        const value = card.values.find((v) => v.fieldId === filterField)?.value;
        if (value) {
          if (Array.isArray(value)) {
            value.forEach((v) => values.add(String(v)));
          } else {
            values.add(String(value));
          }
        }
      });
      setFilterAvailableValues(values);
    }
  }, [cardDocs, filterField]);

  const fields = fieldConfigDoc?.fields || [];

  const groupedCards = useMemo(() => {
    const groups: Record<
      string,
      { card: CardDoc; url: AutomergeUrl }[]
    > = {};

    cardDocs.forEach((card, url) => {
      const value = card.values.find((v) => v.fieldId === selectedField)?.value;
      if (value) {
        if (Array.isArray(value)) {
          value.forEach((v) => {
            const key = String(v);
            if (!groups[key]) groups[key] = [];
            groups[key].push({ card, url });
          });
        } else {
          const key = String(value);
          if (!groups[key]) groups[key] = [];
          groups[key].push({ card, url });
        }
      } else {
        if (!groups[""]) groups[""] = [];
        groups[""].push({ card, url });
      }
    });

    if (!folderDoc) {
      return groups;
    }

    if (selectedField && fieldConfigDoc) {
      const field = fieldConfigDoc.fields.find((f) => f.id === selectedField);
      if (field?.options?.length) {
        const sortedEntries: [string, { card: CardDoc; url: AutomergeUrl }[]][] =
          [];

        field.options.forEach((option) => {
          if (groups[option]) {
            sortedEntries.push([option, groups[option]]);
            delete groups[option];
          }
        });

        const remainingEntries = Object.entries(groups).sort((a, b) =>
          a[0].localeCompare(b[0]),
        );

        return Object.fromEntries([...sortedEntries, ...remainingEntries]);
      }
    }

    return groups;
  }, [cardDocs, selectedField, folderDoc, fieldConfigDoc]);

  const handleCreateCard = async () => {
    try {
      const newCard = await createDocOfType<ProjectCardDoc>(
        "project-card",
        repo,
        (doc) => {
          doc.title = "Untitled Card";
          doc.values = [];
          doc.fields = [];
          if (fieldConfigUrl) {
            doc.fieldConfigUrl = fieldConfigUrl;
          }
        },
      );

      changeFolderDoc((d) => {
        d.docs.push({
          name: "Untitled Card",
          type: "project-card",
          url: newCard.url,
        });
      });

      setSelectedCardUrl(newCard.url);
    } catch (error) {
      console.error("Error creating card:", error);
    }
  };

  const handleArchiveColumn = async (value: string) => {
    if (!folderDoc) return;

    let archiveFolderUrl: AutomergeUrl | undefined;

    const archiveFolder = folderDoc.docs.find(
      (doc) => doc.type === "folder" && doc.name === "Archived",
    );

    if (archiveFolder) {
      archiveFolderUrl = archiveFolder.url;
    } else {
      const newFolder = await createDocOfType<FolderDoc>("folder", repo, (doc) => {
        doc.title = "Archived";
        doc.docs = [];
      });

      changeFolderDoc((d) => {
        d.docs.push({
          name: "Archived",
          type: "folder",
          url: newFolder.url,
        });
      });

      archiveFolderUrl = newFolder.url;
    }

    const archiveHandle = await repo.find<FolderDoc>(archiveFolderUrl);
    const cardsToMove = groupedCards[value] || [];

    archiveHandle.change((d) => {
      cardsToMove.forEach(({ card, url }) => {
        d.docs.push({
          name: card.title,
          type: "project-card",
          url,
        });
      });
    });

    changeFolderDoc((d) => {
      cardsToMove.forEach(({ url }) => {
        const index = d.docs.findIndex((doc) => doc.url === url);
        if (index !== -1) {
          d.docs.splice(index, 1);
        }
      });
    });
  };

  if (!folderDoc) {
    return <div className="lanes p-4 text-base-content">Loading folder...</div>;
  }

  return (
    <div className="lanes flex h-full flex-col text-base-content">
      <div className="flex items-center justify-between border-b border-base-300 p-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Group by:</label>
            <select
              value={selectedField || ""}
              onChange={(e) => setSelectedField(e.target.value)}
              className="select select-bordered select-sm"
            >
              <option value="">Select a field</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Filter by:</label>
            <select
              value={filterField || ""}
              onChange={(e) => {
                setFilterField(e.target.value || null);
                setFilterValue(null);
              }}
              className="select select-bordered select-sm"
            >
              <option value="">No filter</option>
              {fields.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>

            {filterField && (
              <select
                value={filterValue || ""}
                onChange={(e) => setFilterValue(e.target.value || null)}
                className="select select-bordered select-sm"
              >
                <option value="">All values</option>
                {Array.from(filterAvailableValues).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {fieldConfigDoc && (
            <ConfigMenu
              fieldConfigUrl={fieldConfigUrl}
              onConfigChange={(url) => {
                changeFolderDoc((d) => {
                  d.docs = d.docs.filter(
                    (doc) => doc.type !== "field-configuration",
                  );
                  d.docs.push({
                    name: "Field Configuration",
                    type: "field-configuration",
                    url,
                  });
                });
              }}
            />
          )}
          <button
            type="button"
            onClick={() => void handleCreateCard()}
            className="btn btn-primary btn-sm"
          >
            Create Card
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-4 overflow-x-auto p-4">
        {Object.entries(groupedCards).map(([value, cards]) => {
          const filteredCards =
            filterField && filterValue
              ? cards.filter(({ card }) => {
                  const cardValue = card.values.find(
                    (v) => v.fieldId === filterField,
                  )?.value;
                  return Array.isArray(cardValue)
                    ? cardValue.includes(filterValue)
                    : cardValue === filterValue;
                })
              : cards;

          return (
            <div
              key={value}
              className={`flex h-full w-[300px] flex-col rounded-lg p-4 ${
                dragOverColumn === value ? "bg-base-300" : "bg-base-200"
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverColumn(value);
              }}
              onDragLeave={() => {
                setDragOverColumn((current) =>
                  current === value ? null : current,
                );
              }}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOverColumn(null);

                const cardUrl = e.dataTransfer.getData(
                  "text/plain",
                ) as AutomergeUrl;
                if (!cardUrl || !selectedField) return;

                const cardDoc = folderDoc.docs.find((doc) => doc.url === cardUrl);
                if (!cardDoc) return;

                const cardHandle = await repo.find<ProjectCardDoc>(cardUrl);
                cardHandle.change((doc) => {
                  const laneValue = value === "No Value" ? null : value;
                  setProjectCardFieldValue(doc, selectedField, laneValue);
                });
              }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-medium">{value || "No Value"}</h3>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-base-content/60">
                    {filteredCards.length}{" "}
                    {filteredCards.length === 1 ? "card" : "cards"}
                  </span>
                  {filteredCards.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Are you sure you want to archive all ${filteredCards.length} cards in this column?`,
                          )
                        ) {
                          void handleArchiveColumn(value);
                        }
                      }}
                      className="text-base-content/50 hover:text-base-content/70"
                      title="Archive all cards in this column"
                    >
                      <Icon type="Archive" className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto">
                {filteredCards.map(({ url }) => (
                  <div
                    key={url}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", url);
                      e.currentTarget.classList.add("opacity-50");
                    }}
                    onDragEnd={(e) => {
                      e.currentTarget.classList.remove("opacity-50");
                    }}
                    onClick={() => setSelectedCardUrl(url)}
                    className="group relative cursor-pointer rounded bg-base-100 p-2 shadow-sm transition-shadow hover:shadow-md"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            "Are you sure you want to delete this card?",
                          )
                        ) {
                          changeFolderDoc((d) => {
                            const index = d.docs.findIndex(
                              (doc) => doc.url === url,
                            );
                            if (index !== -1) {
                              d.docs.splice(index, 1);
                            }
                          });
                        }
                      }}
                      className="absolute right-2 top-2 p-1 text-base-content/50 opacity-0 transition-opacity hover:text-error group-hover:opacity-100"
                    >
                      <Icon type="Trash" className="h-4 w-4" />
                    </button>
                    <patchwork-view
                      doc-url={url}
                      tool-id="project-card-compact"
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!selectedField) return;

                  const newCard = await createDocOfType<ProjectCardDoc>(
                    "project-card",
                    repo,
                    (doc) => {
                      doc.title = "Untitled Card";
                      doc.values = [];
                      doc.fields = [];
                      if (fieldConfigUrl) {
                        doc.fieldConfigUrl = fieldConfigUrl;
                      }
                      doc.values = [
                        {
                          fieldId: selectedField,
                          value: value === "No Value" ? null : value,
                        },
                      ];
                    },
                  );

                  changeFolderDoc((d) => {
                    d.docs.push({
                      name: "Untitled Card",
                      type: "project-card",
                      url: newCard.url,
                    });
                  });

                  setSelectedCardUrl(newCard.url);
                }}
                className="btn btn-ghost btn-sm mt-4 w-full gap-2"
              >
                <span className="text-base-content/60">+</span>
                <span>New Card</span>
              </button>
            </div>
          );
        })}
      </div>

      <Dialog
        open={!!selectedCardUrl}
        onOpenChange={(open) => !open && setSelectedCardUrl(null)}
      >
        <DialogContent className="h-[min(90vh,800px)]">
          <div className="h-full min-h-0">
            {selectedCardUrl && (
              <patchwork-view
                doc-url={selectedCardUrl}
                tool-id="project-card"
                className="block h-full"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
