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
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-md border border-base-300 bg-base-100 px-3 py-2 text-sm text-base-content focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <span className="truncate">{displayValue}</span>
        <Icon type="ChevronsUpDown" className="h-4 w-4 opacity-50" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-base-300 bg-base-100 text-base-content shadow-md outline-none">
          <Command
            ref={commandRef}
            className="overflow-hidden rounded-t-none border border-base-300 bg-transparent"
          >
            <div className="flex items-center border-b border-base-300 px-3">
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
                className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-base-content/50"
              />
            </div>
            <Command.List className="max-h-[300px] overflow-y-auto overflow-x-hidden">
              {!multiple && (
                <Command.Item
                  key="__none__"
                  value=""
                  onSelect={() => onChange("")}
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-base-200"
                >
                  <Icon type="X" className="mr-2 h-4 w-4" />
                  None
                </Command.Item>
              )}
              {filteredOptions.map((option) => (
                <Command.Item
                  key={option}
                  value={option}
                  onSelect={() => handleSelect(option)}
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-base-200"
                >
                  <Icon
                    type="Check"
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedValues.includes(option)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                  {option}
                </Command.Item>
              ))}
              {shouldShowCreate && (
                <Command.Item
                  value={searchValue.trim()}
                  onSelect={handleCreate}
                  className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-base-200"
                >
                  <Icon type="Plus" className="mr-2 h-4 w-4" />
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
