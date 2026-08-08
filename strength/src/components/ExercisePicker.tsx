import { useMemo, useState } from "react";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import { muscleGroupLabel, equipmentLabel } from "../constants";
import type { ExerciseDoc } from "../types";

export type LoadedExercise = {
  url: AutomergeUrl;
  doc: ExerciseDoc;
};

export function ExercisePicker({
  exercises,
  onSelect,
  onClose,
}: {
  exercises: LoadedExercise[];
  onSelect: (exercise: LoadedExercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return exercises;
    return exercises.filter(({ doc }) => {
      const haystack = [
        doc.name,
        ...(doc.aliases ?? []),
        ...(doc.muscleGroups ?? []),
        ...(doc.equipment ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [exercises, query]);

  return (
    <div className="st-modal">
      <div className="st-modal__panel">
        <div className="st-panel__head">
          <h3 className="st-panel__title">Add exercise</h3>
          <button
            type="button"
            onClick={onClose}
            className="st-close"
          >
            ✕
          </button>
        </div>

        <div className="st-picker__search">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises..."
            className="st-field"
          />
        </div>

        <div className="st-picker__list">
          {filtered.length === 0 ? (
            <p className="st-picker__empty">
              No exercises found.
            </p>
          ) : (
            <ul>
              {filtered.map((entry) => (
                <li key={entry.url}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry)}
                    className="st-picker__item"
                  >
                    <span className="st-picker__name">
                      {entry.doc.name}
                    </span>
                    <span className="st-picker__meta">
                      {(entry.doc.muscleGroups ?? [])
                        .map(muscleGroupLabel)
                        .join(", ")}
                      {(entry.doc.equipment ?? []).length
                        ? ` · ${entry.doc.equipment.map(equipmentLabel).join(", ")}`
                        : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
