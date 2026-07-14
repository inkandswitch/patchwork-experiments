import { useState } from "react";
import {
  CATEGORIES,
  EQUIPMENT_OPTIONS,
  MUSCLE_GROUPS,
  equipmentLabel,
  muscleGroupLabel,
} from "../constants";
import type { Equipment, ExerciseDoc, MuscleGroup, WeightUnit } from "../types";

const inputClass =
  "w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-400";
const labelClass = "text-xs font-medium text-slate-500";

function TagPicker<T extends string>({
  options,
  selected,
  onChange,
  label,
}: {
  options: T[];
  selected: T[];
  onChange: (tags: T[]) => void;
  label: string;
}) {
  const toggle = (tag: T) => {
    if (selected.includes(tag)) {
      onChange(selected.filter((t) => t !== tag));
    } else {
      onChange([...selected, tag]);
    }
  };

  return (
    <div className="space-y-1.5">
      <span className={labelClass}>{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                active
                  ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {option.includes(" ")
                ? option
                : option.charAt(0).toUpperCase() + option.slice(1)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ExerciseDetail({
  exercise,
  compact,
  onClose,
  onUpdate,
}: {
  exercise: ExerciseDoc;
  compact?: boolean;
  onClose?: () => void;
  onUpdate?: (patch: Partial<ExerciseDoc>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const editable = Boolean(onUpdate);

  const content = (
    <div className="space-y-4">
      {editable && editing ? (
        <>
          <div className="space-y-1">
            <label className={labelClass}>Name</label>
            <input
              value={exercise.name}
              onChange={(e) => onUpdate?.({ name: e.target.value })}
              className={inputClass}
            />
          </div>

          <TagPicker<MuscleGroup>
            label="Muscle groups"
            options={MUSCLE_GROUPS}
            selected={exercise.muscleGroups ?? []}
            onChange={(muscleGroups) => onUpdate?.({ muscleGroups })}
          />

          <TagPicker<Equipment>
            label="Equipment"
            options={EQUIPMENT_OPTIONS}
            selected={exercise.equipment ?? []}
            onChange={(equipment) => onUpdate?.({ equipment })}
          />

          <div className="space-y-1">
            <label className={labelClass}>Category</label>
            <select
              value={exercise.category}
              onChange={(e) =>
                onUpdate?.({
                  category: e.target.value as ExerciseDoc["category"],
                })
              }
              className={inputClass}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className={labelClass}>Default unit</label>
            <div className="flex gap-1.5">
              {(["kg", "lb"] as WeightUnit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => onUpdate?.({ defaultUnit: u })}
                  className={`rounded-md border px-3 py-1 text-sm ${
                    exercise.defaultUnit === u
                      ? "border-emerald-400 bg-emerald-50 font-medium text-emerald-800"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className={labelClass}>Instructions</label>
            <textarea
              value={exercise.instructions ?? ""}
              onChange={(e) => onUpdate?.({ instructions: e.target.value })}
              rows={4}
              className={inputClass}
            />
          </div>

          <div className="space-y-1">
            <label className={labelClass}>Notes</label>
            <textarea
              value={exercise.notes ?? ""}
              onChange={(e) => onUpdate?.({ notes: e.target.value })}
              rows={2}
              className={inputClass}
            />
          </div>

          <button
            type="button"
            onClick={() => setEditing(false)}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700"
          >
            Done editing
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(exercise.muscleGroups ?? []).map((group) => (
              <span
                key={group}
                className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs text-sky-800"
              >
                {muscleGroupLabel(group)}
              </span>
            ))}
            {(exercise.equipment ?? []).map((eq) => (
              <span
                key={eq}
                className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs text-violet-800"
              >
                {equipmentLabel(eq)}
              </span>
            ))}
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
              {exercise.category}
            </span>
            {exercise.defaultUnit ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                {exercise.defaultUnit}
              </span>
            ) : null}
          </div>

          {exercise.instructions ? (
            <div className="space-y-1">
              <span className={labelClass}>Instructions</span>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {exercise.instructions}
              </p>
            </div>
          ) : null}

          {exercise.notes ? (
            <div className="space-y-1">
              <span className={labelClass}>Notes</span>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">
                {exercise.notes}
              </p>
            </div>
          ) : null}

          {editable ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Edit exercise
            </button>
          ) : null}
        </>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="flex h-full flex-col rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-slate-900">{exercise.name}</h3>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto p-4">{content}</div>
      </div>
    );
  }

  return <div className="space-y-3">{content}</div>;
}
