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
    <div className="lanes field-config">
      <div className="field-config__body">
        <div>
          <h2 className="field-config__title">Fields</h2>
          <div className="field-config__list">
            {doc.fields.map((field) => (
              <div key={field.id} className="field-item">
                <div className="field-item__head">
                  <div className="field-item__name">
                    <div className="field-item__label">{field.name}:</div>
                    <div className="field-item__type">{field.type}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveField(field.id)}
                    className="icon-button"
                  >
                    <Icon type="Trash" />
                  </button>
                </div>

                {(field.type === "select" || field.type === "multiselect") && (
                  <div className="field-options">
                    <div className="field-options__label">
                      Options (in display order):
                    </div>

                    <div className="field-options__chips">
                      {field.options?.map((option, index) => (
                        <div
                          key={`${field.id}-${option}`}
                          className="option-chip"
                        >
                          <div className="option-chip__moves">
                            <button
                              type="button"
                              onClick={() =>
                                handleMoveFieldOptionUp(field.id, index)
                              }
                              disabled={index === 0}
                              className="icon-button"
                            >
                              <Icon type="ChevronUp" className="icon--sm" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleMoveFieldOptionDown(field.id, index)
                              }
                              disabled={
                                index === (field.options?.length || 0) - 1
                              }
                              className="icon-button"
                            >
                              <Icon type="ChevronDown" className="icon--sm" />
                            </button>
                          </div>
                          <span>{option}</span>
                          <button
                            type="button"
                            onClick={() =>
                              handleRemoveFieldOption(field.id, option)
                            }
                            className="icon-button"
                          >
                            <Icon type="X" className="icon--sm" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="field-options__add">
                      <input
                        type="text"
                        placeholder="Add new option"
                        value={fieldOptionInputs[field.id] || ""}
                        onChange={(e) =>
                          handleAddFieldOptionInput(field.id, e.target.value)
                        }
                        className="input input--xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newOption = fieldOptionInputs[field.id];
                          if (newOption && newOption.trim()) {
                            handleAddFieldOption(field.id, newOption);
                          }
                        }}
                        className="btn btn--primary btn--xs"
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

      <div className="field-config__footer">
        <h2 className="field-config__title">Add Field</h2>
        <div className="field-config__form">
          <div>
            <label className="field-config__formlabel">Field Name</label>
            <input
              type="text"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
              className="input"
              placeholder="Enter field name"
            />
          </div>

          <div>
            <label className="field-config__formlabel">Field Type</label>
            <select
              value={newFieldType || ""}
              onChange={(e) => setNewFieldType(e.target.value)}
              className="select"
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
            className="btn btn--primary btn--block"
          >
            Add a Field
          </button>
        </div>
      </div>
    </div>
  );
}
