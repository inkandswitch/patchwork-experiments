import { useState } from "react";
import {
  CATEGORIES,
  EQUIPMENT_OPTIONS,
  MUSCLE_GROUPS,
  equipmentLabel,
  muscleGroupLabel,
} from "../constants";
import type { Equipment, ExerciseDoc, MuscleGroup, WeightUnit } from "../types";

const inputClass = "st-field";
const labelClass = "st-field-label";

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
    <div className="st-tagpicker">
      <span className={labelClass}>{label}</span>
      <div className="st-tagpicker__options">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className="st-tag"
              data-active={active || undefined}
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
    <div className="st-detail">
      {editable && editing ? (
        <>
          <div className="st-detail__field">
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

          <div className="st-detail__field">
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

          <div className="st-detail__field">
            <label className={labelClass}>Default unit</label>
            <div className="st-detail__units">
              {(["kg", "lb"] as WeightUnit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => onUpdate?.({ defaultUnit: u })}
                  className="st-unit-option"
                  data-active={exercise.defaultUnit === u || undefined}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div className="st-detail__field">
            <label className={labelClass}>Instructions</label>
            <textarea
              value={exercise.instructions ?? ""}
              onChange={(e) => onUpdate?.({ instructions: e.target.value })}
              rows={4}
              className={inputClass}
            />
          </div>

          <div className="st-detail__field">
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
            className="st-button st-button--primary"
          >
            Done editing
          </button>
        </>
      ) : (
        <>
          <div className="st-detail__tags">
            {(exercise.muscleGroups ?? []).map((group) => (
              <span
                key={group}
                className="st-tag" data-tone="muscle"
              >
                {muscleGroupLabel(group)}
              </span>
            ))}
            {(exercise.equipment ?? []).map((eq) => (
              <span
                key={eq}
                className="st-tag" data-tone="equipment"
              >
                {equipmentLabel(eq)}
              </span>
            ))}
            <span className="st-tag">
              {exercise.category}
            </span>
            {exercise.defaultUnit ? (
              <span className="st-tag" data-tone="level">
                {exercise.defaultUnit}
              </span>
            ) : null}
          </div>

          {exercise.instructions ? (
            <div className="st-detail__field">
              <span className={labelClass}>Instructions</span>
              <p className="st-prose">
                {exercise.instructions}
              </p>
            </div>
          ) : null}

          {exercise.notes ? (
            <div className="st-detail__field">
              <span className={labelClass}>Notes</span>
              <p className="st-prose st-prose--muted">
                {exercise.notes}
              </p>
            </div>
          ) : null}

          {editable ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="st-button"
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
      <div className="st-panel">
        <div className="st-panel__head">
          <h3 className="st-panel__title">{exercise.name}</h3>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="st-close"
            >
              ✕
            </button>
          ) : null}
        </div>
        <div className="st-panel__body">{content}</div>
      </div>
    );
  }

  return <div className="st-detail-plain">{content}</div>;
}
