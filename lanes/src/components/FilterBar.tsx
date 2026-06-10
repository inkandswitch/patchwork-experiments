import React from "react";
import { Icon } from "../ui";

interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterValues: string[];
  selectedValue: string | null;
  onFilterValueChange: (value: string | null) => void;
  placeholder?: string;
  filterLabel?: string;
}

const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  onSearchChange,
  filterValues,
  selectedValue,
  onFilterValueChange,
  placeholder = "Search...",
  filterLabel = "Filter by",
}) => {
  return (
    <>
      <div className="flex-shrink-0 border-b border-base-300 bg-base-100 px-4 py-3">
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Icon type="Search" size={16} className="text-base-content/50" />
          </div>
          <input
            type="text"
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="input input-bordered w-full pl-10"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-base-content/50 hover:text-base-content/70"
            >
              <Icon type="X" size={14} />
            </button>
          )}
        </div>
      </div>

      {filterValues.length > 0 && (
        <div className="flex-shrink-0 border-b border-base-300 bg-base-200 px-4 py-2">
          <div className="mb-2 flex items-center">
            <span className="text-xs font-medium uppercase tracking-wider text-base-content/60">
              {filterLabel}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => onFilterValueChange(null)}
              className={`rounded-md px-2 py-1 text-xs ${
                selectedValue === null
                  ? "bg-primary font-medium text-primary-content shadow-sm"
                  : "border border-base-300 bg-base-100 text-base-content hover:bg-base-200"
              }`}
            >
              All
            </button>
            {filterValues.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onFilterValueChange(value)}
                className={`rounded-md px-2 py-1 text-xs ${
                  selectedValue === value
                    ? "bg-primary font-medium text-primary-content shadow-sm"
                    : "border border-base-300 bg-base-100 text-base-content hover:bg-base-200"
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export default FilterBar;
