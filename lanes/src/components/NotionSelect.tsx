import React, { useState, useRef, useEffect } from "react";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { Command } from "cmdk";
import { Icon, cn } from "../ui";
import type { FieldConfigurationDoc } from "../datatype";
import { useDocument } from "@automerge/automerge-repo-react-hooks";

interface NotionSelectProps {
  value: string | string[];
  onChange: (value: string | string[]) => void;
  options: string[];
  placeholder?: string;
  multiple?: boolean;
  className?: string;
  fieldConfigDocUrl?: AutomergeUrl | null;
  fieldId?: string;
}

export const NotionSelect: React.FC<NotionSelectProps> = ({
  value,
  onChange,
  options,
  placeholder = "Select option...",
  multiple = false,
  className,
  fieldConfigDocUrl,
  fieldId,
}) => {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const commandRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [, changeConfigDoc] = useDocument<FieldConfigurationDoc>(
    fieldConfigDocUrl || undefined,
    { suspense: false },
  );

  const selectedValues = multiple
    ? Array.isArray(value)
      ? value
      : []
    : typeof value === "string"
      ? [value]
      : [];

  const displayValue = multiple
    ? selectedValues.length > 0
      ? selectedValues.join(", ")
      : placeholder
    : selectedValues[0] || placeholder;

  const filteredOptions = options.filter((option) =>
    option.toLowerCase().includes(searchValue.toLowerCase()),
  );

  const shouldShowCreate =
    searchValue.trim() && !options.includes(searchValue.trim());

  const handleSelect = (option: string) => {
    if (multiple) {
      const newValue = selectedValues.includes(option)
        ? selectedValues.filter((v) => v !== option)
        : [...selectedValues, option];
      onChange(newValue);
    } else {
      onChange(option);
      setOpen(false);
    }
  };

  const handleCreate = () => {
    if (searchValue.trim()) {
      const newValue = searchValue.trim();

      if (changeConfigDoc && fieldId) {
        changeConfigDoc((d) => {
          const fieldIndex = d.fields.findIndex((f) => f.id === fieldId);
          if (fieldIndex === -1) return;

          if (!d.fields[fieldIndex].options) {
            d.fields[fieldIndex].options = [];
          }

          if (!d.fields[fieldIndex].options!.includes(newValue)) {
            d.fields[fieldIndex].options!.push(newValue);
          }
        });
      }

      if (multiple) {
        onChange([...selectedValues, newValue]);
      } else {
        onChange(newValue);
      }
      setSearchValue("");
      setOpen(false);
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", down);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn("notion-select", className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="notion-select__trigger"
      >
        <span className="notion-select__value">{displayValue}</span>
        <Icon type="ChevronsUpDown" className="icon--dim" />
      </button>

      {open && (
        <div className="notion-select__panel">
          <Command
            ref={commandRef}
            className="notion-select__command"
          >
            <div className="notion-select__searchrow">
              <Command.Input
                placeholder="Search or create..."
                value={searchValue}
                onValueChange={setSearchValue}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shouldShowCreate) {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                className="notion-select__search"
              />
            </div>
            <Command.List className="notion-select__list">
              {!multiple && (
                <Command.Item
                  key="__none__"
                  value=""
                  onSelect={() => onChange("")}
                  className="notion-select__item"
                >
                  <Icon type="X" className="icon--lead" />
                  None
                </Command.Item>
              )}
              {filteredOptions.map((option) => (
                <Command.Item
                  key={option}
                  value={option}
                  onSelect={() => handleSelect(option)}
                  className="notion-select__item"
                >
                  <Icon
                    type="Check"
                    className={cn(
                      "icon--lead",
                      !selectedValues.includes(option) && "icon--hidden",
                    )}
                  />
                  {option}
                </Command.Item>
              ))}
              {shouldShowCreate && (
                <Command.Item
                  value={searchValue.trim()}
                  onSelect={handleCreate}
                  className="notion-select__item"
                >
                  <Icon type="Plus" className="icon--lead" />
                  Create "{searchValue.trim()}"
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </div>
      )}
    </div>
  );
};
