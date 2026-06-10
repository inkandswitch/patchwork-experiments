import React, { useState } from "react";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Icon } from "../ui";
import type { Field, FieldConfigurationDoc, FieldType } from "../datatype";

export function FieldConfigurationEditor({
  docUrl,
}: {
  docUrl: AutomergeUrl;
}) {
  const [doc, changeDoc] = useDocument<FieldConfigurationDoc>(docUrl);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<string | null>(null);
  const [fieldOptionInputs, setFieldOptionInputs] = useState<
    Record<string, string>
  >({});

  const handleAddField = () => {
    if (!newFieldName.trim()) return;

    const newField: Field = {
      id: crypto.randomUUID(),
      name: newFieldName,
      type: newFieldType as FieldType,
      options: null,
      multiple: newFieldType === "multiselect",
    };

    changeDoc((d) => {
      d.fields.push(newField);
    });

    setNewFieldName("");
    setNewFieldType(null);
  };

  const handleAddFieldOptionInput = (fieldId: string, value: string) => {
    setFieldOptionInputs((prev) => ({
      ...prev,
      [fieldId]: value,
    }));
  };

  const handleAddFieldOption = (fieldId: string, option: string) => {
    if (!option.trim()) return;

    changeDoc((d) => {
      const fieldIndex = d.fields.findIndex((f) => f.id === fieldId);
      if (fieldIndex === -1) return;

      if (!d.fields[fieldIndex].options) {
        d.fields[fieldIndex].options = [];
      }

      d.fields[fieldIndex].options!.push(option);
    });

    setFieldOptionInputs((prev) => ({
      ...prev,
      [fieldId]: "",
    }));
  };

  const handleRemoveFieldOption = (fieldId: string, option: string) => {
    changeDoc((d) => {
      const fieldIndex = d.fields.findIndex((f) => f.id === fieldId);
      if (fieldIndex === -1 || !d.fields[fieldIndex].options) return;

      const optionIndex = d.fields[fieldIndex].options!.indexOf(option);
      if (optionIndex !== -1) {
        d.fields[fieldIndex].options!.splice(optionIndex, 1);
      }
    });
  };

  const handleRemoveField = (fieldId: string) => {
    changeDoc((d) => {
      const index = d.fields.findIndex((f) => f.id === fieldId);
      if (index !== -1) {
        d.fields.splice(index, 1);
      }
    });
  };

  const handleMoveFieldOptionUp = (fieldId: string, optionIndex: number) => {
    if (optionIndex <= 0) return;

    changeDoc((d) => {
      const fieldIndex = d.fields.findIndex((f) => f.id === fieldId);
      if (fieldIndex === -1 || !d.fields[fieldIndex].options) return;

      const options = d.fields[fieldIndex].options!;
      const temp = options[optionIndex];
      options[optionIndex] = options[optionIndex - 1];
      options[optionIndex - 1] = temp;
    });
  };

  const handleMoveFieldOptionDown = (fieldId: string, optionIndex: number) => {
    changeDoc((d) => {
      const fieldIndex = d.fields.findIndex((f) => f.id === fieldId);
      if (fieldIndex === -1 || !d.fields[fieldIndex].options) return;

      const options = d.fields[fieldIndex].options!;
      if (optionIndex >= options.length - 1) return;

      const temp = options[optionIndex];
      options[optionIndex] = options[optionIndex + 1];
      options[optionIndex + 1] = temp;
    });
  };

  if (!doc) return null;

  return (
    <div className="lanes flex h-full flex-col text-base-content">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Fields</h2>
          <div className="space-y-2">
            {doc.fields.map((field) => (
              <div key={field.id} className="rounded bg-base-200 p-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="font-medium">{field.name}:</div>
                    <div className="text-sm text-base-content/60">{field.type}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveField(field.id)}
                    className="text-base-content/60 hover:text-base-content"
                  >
                    <Icon type="Trash" className="h-4 w-4" />
                  </button>
                </div>

                {(field.type === "select" || field.type === "multiselect") && (
                  <div className="mt-2">
                    <div className="mb-1 text-xs font-medium text-base-content/60">
                      Options (in display order):
                    </div>

                    <div className="mb-2 flex flex-wrap gap-1">
                      {field.options?.map((option, index) => (
                        <div
                          key={`${field.id}-${option}`}
                          className="flex items-center gap-1 rounded bg-base-300 px-2 py-1 text-xs"
                        >
                          <div className="flex items-center">
                            <button
                              type="button"
                              onClick={() =>
                                handleMoveFieldOptionUp(field.id, index)
                              }
                              disabled={index === 0}
                              className="text-base-content/60 hover:text-base-content disabled:opacity-30"
                            >
                              <Icon type="ChevronUp" className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleMoveFieldOptionDown(field.id, index)
                              }
                              disabled={
                                index === (field.options?.length || 0) - 1
                              }
                              className="text-base-content/60 hover:text-base-content disabled:opacity-30"
                            >
                              <Icon type="ChevronDown" className="h-3 w-3" />
                            </button>
                          </div>
                          <span>{option}</span>
                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveFieldOption(field.id, option)
                            }
                            className="text-base-content/60 hover:text-base-content"
                          >
                            <Icon type="X" className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-1">
                      <input
                        type="text"
                        placeholder="Add new option"
                        value={fieldOptionInputs[field.id] || ""}
                        onChange={(e) =>
                          handleAddFieldOptionInput(field.id, e.target.value)
                        }
                        className="input input-bordered input-xs flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newOption = fieldOptionInputs[field.id];
                          if (newOption && newOption.trim()) {
                            handleAddFieldOption(field.id, newOption);
                          }
                        }}
                        className="btn btn-primary btn-xs"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex-none border-t border-base-300 p-4 pt-4">
        <h2 className="mb-2 text-lg font-semibold">Add Field</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Field Name</label>
            <input
              type="text"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              className="input input-bordered w-full"
              placeholder="Enter field name"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Field Type</label>
            <select
              value={newFieldType || ""}
              onChange={(e) => setNewFieldType(e.target.value)}
              className="select select-bordered w-full"
            >
              <option value="">Select a type</option>
              <option value="text">Text</option>
              <option value="date">Date</option>
              <option value="select">Select (Single Choice)</option>
              <option value="multiselect">Select (Multiple Choice)</option>
            </select>
          </div>

          <button
            type="button"
            onClick={handleAddField}
            disabled={!newFieldName || !newFieldType}
            className="btn btn-primary w-full"
          >
            Add a Field
          </button>
        </div>
      </div>
    </div>
  );
}
