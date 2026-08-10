import { useState } from "react";
import type { FieldPatch } from "../automerge-fields";
import { formatTargetReps } from "../calculations";
import type { LoggedSet, SetKind, TemplateSet, WeightUnit } from "../types";
import { PlatesCalculator } from "./PlatesCalculator";

const inputClass = "st-input";

function roundValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function nextSetKind(kind: SetKind | undefined): SetKind | null {
  if (kind == null) return "warmup";
  if (kind === "warmup") return "failure";
  return null;
}



function setKindLabel(kind: SetKind | undefined, index: number): string {
  if (kind === "warmup") return "W";
  if (kind === "failure") return "F";
  return `${index + 1}`;
}

function setKindTitle(kind: SetKind | undefined): string {
  if (kind === "warmup") return "Warmup set — tap for to-failure";
  if (kind === "failure") return "To-failure set — tap for normal";
  return "Working set — tap for warmup";
}

/** Set-number badge that cycles normal → warmup (W) → to-failure (F). */
export function SetKindBadge({
  kind,
  index,
  onCycle,
  size = "sm",
}: {
  kind: SetKind | undefined;
  index: number;
  onCycle?: (next: SetKind | null) => void;
  size?: "sm" | "lg";
}) {
  const kindName = kind ?? "normal";

  if (!onCycle) {
    return (
      <span className="st-kind" data-size={size} data-kind={kindName}>
        {setKindLabel(kind, index)}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onCycle(nextSetKind(kind))}
      title={setKindTitle(kind)}
      className="st-kind"
      data-size={size}
      data-kind={kindName}
    >
      {setKindLabel(kind, index)}
    </button>
  );
}

export function Stepper({
  label,
  value,
  step,
  max,
  onChange,
}: {
  label: string;
  value: number | undefined;
  step: number;
  max?: number;
  onChange: (value: number | undefined) => void;
}) {
  const apply = (next: number) => {
    const rounded = roundValue(next);
    if (rounded <= 0) {
      onChange(undefined);
      return;
    }
    onChange(max != null && rounded > max ? max : rounded);
  };

  return (
    <div className="st-stepper">
      <button
        type="button"
        onClick={() => apply((value ?? 0) - step)}
        className="st-stepper__button"
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <div className="st-stepper__field">
        <input
          type="number"
          inputMode="decimal"
          placeholder="—"
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : undefined)
          }
          className="st-stepper__input"
        />
        <span className="st-stepper__label">
          {label}
        </span>
      </div>
      <button
        type="button"
        onClick={() => apply((value ?? 0) + step)}
        className="st-stepper__button"
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}

export function PlannedSetRow({
  set,
  index,
  unit,
  onChange,
  onRemove,
}: {
  set: TemplateSet;
  index: number;
  unit: string;
  onChange: (patch: FieldPatch<TemplateSet>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="st-planned-row">
      <div className="st-planned-row__badge">
        <SetKindBadge
          kind={set.kind}
          index={index}
          onCycle={(kind) => onChange({ kind })}
        />
      </div>
      <input
        type="number"
        inputMode="numeric"
        placeholder="Reps"
        value={set.targetReps ?? ""}
        onChange={(e) =>
          onChange({
            targetReps: e.target.value ? Number(e.target.value) : undefined,
            targetRepsMin: undefined,
            targetRepsMax: undefined,
          })
        }
        className={inputClass}
      />
      <input
        type="number"
        inputMode="decimal"
        placeholder={`Weight (${unit})`}
        value={set.targetWeight ?? ""}
        onChange={(e) =>
          onChange({
            targetWeight: e.target.value ? Number(e.target.value) : undefined,
          })
        }
        className={inputClass}
      />
      <input
        type="number"
        inputMode="decimal"
        placeholder="RPE"
        min={1}
        max={10}
        step={0.5}
        value={set.targetRpe ?? ""}
        onChange={(e) =>
          onChange({
            targetRpe: e.target.value ? Number(e.target.value) : undefined,
          })
        }
        className={inputClass}
      />
      <input
        type="number"
        inputMode="numeric"
        placeholder="Rest (s)"
        value={set.restSeconds ?? ""}
        onChange={(e) =>
          onChange({
            restSeconds: e.target.value ? Number(e.target.value) : undefined,
          })
        }
        className={inputClass}
      />
      <button
        type="button"
        onClick={onRemove}
        className="st-remove"
        title="Remove set"
      >
        ✕
      </button>
    </div>
  );
}

export function PlannedSetDisplay({ set, unit }: { set: TemplateSet; unit: string }) {
  return (
    <span className="st-planned-summary">
      {formatTargetReps(set)} reps
      {set.targetWeight != null ? ` @ ${set.targetWeight} ${unit}` : ""}
      {set.targetRpe != null ? ` RPE ${set.targetRpe}` : ""}
      {set.kind === "warmup" ? " · warmup" : ""}
      {set.kind === "failure" ? " · to failure" : ""}
    </span>
  );
}

export function LoggedSetRow({
  set,
  index,
  unit,
  executing,
  isCurrent,
  rowId,
  onChange,
  onToggleComplete,
}: {
  set: LoggedSet;
  index: number;
  unit: WeightUnit;
  executing?: boolean;
  isCurrent?: boolean;
  rowId?: string;
  onChange: (patch: FieldPatch<LoggedSet>) => void;
  onToggleComplete: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  if (!executing) {
    return (
      <div
        id={rowId}
        className="st-logged-row"
        data-completed={set.completed || undefined}
      >
        <button
          type="button"
          onClick={onToggleComplete}
          className="st-check st-check--sm"
          data-completed={set.completed || undefined}
          title={set.completed ? "Mark incomplete" : "Complete set"}
        >
          ✓
        </button>
        <input
          type="number"
          placeholder="Reps"
          value={set.reps ?? ""}
          disabled
          className={inputClass}
        />
        <input
          type="number"
          placeholder={`Weight (${unit})`}
          value={set.weight ?? ""}
          disabled
          className={inputClass}
        />
        <input
          type="number"
          placeholder="RPE"
          value={set.rpe ?? ""}
          disabled
          className={inputClass}
        />
        <div className="st-logged-row__badge">
          <SetKindBadge kind={set.kind} index={index} />
        </div>
      </div>
    );
  }

  const weightStep = unit === "kg" ? 2.5 : 5;

  return (
    <div
      id={rowId}
      className="st-active-row"
      data-current={isCurrent || undefined}
      data-completed={set.completed || undefined}
    >
      {/* Main row is sized to fit a ~300px pane (iPhone) without wrapping:
          fixed badge + check, two flexing steppers in between. RPE, set
          kind, and the plates calculator live in the details disclosure. */}
      <div className="st-active-row__main">
        <button
          type="button"
          onClick={() => setShowDetails((cur) => !cur)}
          title="Set details (RPE, set type, plates)"
          className="st-disclosure"
          data-kind={set.kind ?? "normal"}
          data-open={showDetails || undefined}
        >
          <span className="st-disclosure__label">{setKindLabel(set.kind, index)}</span>
          <span className="st-disclosure__caret">
            ▼
          </span>
        </button>
        <Stepper
          label="reps"
          value={set.reps}
          step={1}
          onChange={(reps) => onChange({ reps })}
        />
        <Stepper
          label={unit}
          value={set.weight}
          step={weightStep}
          onChange={(weight) => onChange({ weight })}
        />
        <button
          type="button"
          onClick={onToggleComplete}
          className="st-check"
          data-completed={set.completed || undefined}
          title={set.completed ? "Mark incomplete" : "Complete set"}
        >
          ✓
        </button>
      </div>
      {showDetails ? (
        <div className="st-details">
          <div className="st-details__row">
            <div className="st-segmented">
              {(
                [
                  ["normal", "Working"],
                  ["warmup", "Warmup"],
                  ["failure", "To failure"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() =>
                    onChange({ kind: value === "normal" ? null : value })
                  }
                  className="st-segmented__option"
                  data-active={(set.kind ?? "normal") === value || undefined}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="st-details__rpe">
              <Stepper
                label="RPE"
                value={set.rpe}
                step={0.5}
                max={10}
                onChange={(rpe) => onChange({ rpe })}
              />
            </div>
          </div>
          <PlatesCalculator targetWeight={set.weight ?? 0} unit={unit} />
        </div>
      ) : null}
    </div>
  );
}
