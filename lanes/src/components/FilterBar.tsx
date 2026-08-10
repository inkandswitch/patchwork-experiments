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
      <div className="filterbar">
        <div className="filterbar__search">
          <div className="filterbar__icon">
            <Icon type="Search" size={16} />
          </div>
          <input
            type="text"
            placeholder={placeholder}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="input filterbar__input"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="filterbar__clear"
            >
              <Icon type="X" size={14} />
            </button>
          )}
        </div>
      </div>

      {filterValues.length > 0 && (
        <div className="filterbar filterbar--values">
          <div className="filterbar__labelrow">
            <span className="filterbar__label">
              {filterLabel}
            </span>
          </div>
          <div className="filterbar__chips">
            <button
              type="button"
              onClick={() => onFilterValueChange(null)}
              className="filter-chip"
              data-active={selectedValue === null || undefined}
            >
              All
            </button>
            {filterValues.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onFilterValueChange(value)}
                className="filter-chip"
                data-active={selectedValue === value || undefined}
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
