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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-900">Add exercise</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-slate-100 px-4 py-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search exercises..."
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">
              No exercises found.
            </p>
          ) : (
            <ul>
              {filtered.map((entry) => (
                <li key={entry.url}>
                  <button
                    type="button"
                    onClick={() => onSelect(entry)}
                    className="flex w-full flex-col gap-0.5 border-b border-slate-50 px-4 py-3 text-left hover:bg-emerald-50"
                  >
                    <span className="font-medium text-slate-900">
                      {entry.doc.name}
                    </span>
                    <span className="text-xs text-slate-500">
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
