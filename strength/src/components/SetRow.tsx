import { useState } from "react";
import { formatTargetReps } from "../calculations";
import type { LoggedSet, TemplateSet, WeightUnit } from "../types";
import { PlatesCalculator } from "./PlatesCalculator";

const inputClass =
  "w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-emerald-400";

function roundValue(value: number): number {
  return Math.round(value * 100) / 100;
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
    <div className="flex items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => apply((value ?? 0) - step)}
        className="h-11 w-10 shrink-0 text-lg font-medium text-slate-500 active:bg-slate-100"
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <div className="flex w-14 flex-col items-center justify-center border-x border-slate-100">
        <input
          type="number"
          inputMode="decimal"
          placeholder="—"
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : undefined)
          }
          className="w-full bg-transparent text-center text-sm font-semibold text-slate-900 outline-none"
        />
        <span className="pb-0.5 text-[10px] leading-none text-slate-400">
          {label}
        </span>
      </div>
      <button
        type="button"
        onClick={() => apply((value ?? 0) + step)}
        className="h-11 w-10 shrink-0 text-lg font-medium text-slate-500 active:bg-slate-100"
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
  onChange: (patch: Partial<TemplateSet>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_auto] items-center gap-2 text-sm">
      <span className="text-center text-xs text-slate-400">{index + 1}</span>
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
        className="rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
        title="Remove set"
      >
        ✕
      </button>
    </div>
  );
}

export function PlannedSetDisplay({ set, unit }: { set: TemplateSet; unit: string }) {
  return (
    <span className="text-xs text-slate-600">
      {formatTargetReps(set)} reps
      {set.targetWeight != null ? ` @ ${set.targetWeight} ${unit}` : ""}
      {set.targetRpe != null ? ` RPE ${set.targetRpe}` : ""}
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
  onChange: (patch: Partial<LoggedSet>) => void;
  onToggleComplete: () => void;
}) {
  const [showPlates, setShowPlates] = useState(false);

  if (!executing) {
    return (
      <div
        id={rowId}
        className={`grid grid-cols-[2rem_1fr_1fr_1fr_auto] items-center gap-2 rounded px-1 py-1 text-sm ${
          set.completed ? "bg-emerald-50/60" : ""
        }`}
      >
        <button
          type="button"
          onClick={onToggleComplete}
          className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
            set.completed
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-300 text-transparent"
          }`}
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
        <span className="w-6 text-center text-xs text-slate-400">
          {index + 1}
        </span>
      </div>
    );
  }

  const weightStep = unit === "kg" ? 2.5 : 5;

  return (
    <div
      id={rowId}
      className={`rounded-lg px-2 py-2 ${
        isCurrent
          ? "bg-emerald-50 ring-2 ring-emerald-400 ring-offset-1"
          : set.completed
            ? "bg-emerald-50/60"
            : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggleComplete}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-lg ${
            set.completed
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-300 text-transparent hover:border-emerald-400"
          }`}
          title={set.completed ? "Mark incomplete" : "Complete set"}
        >
          ✓
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
        <Stepper
          label="RPE"
          value={set.rpe}
          step={0.5}
          max={10}
          onChange={(rpe) => onChange({ rpe })}
        />
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPlates((cur) => !cur)}
            className={`rounded-md border px-2 py-1.5 text-xs ${
              showPlates
                ? "border-emerald-400 bg-emerald-50 text-emerald-800"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            }`}
          >
            Plates
          </button>
          <span className="text-xs text-slate-400">#{index + 1}</span>
        </div>
      </div>
      {showPlates ? (
        <div className="mt-2">
          <PlatesCalculator targetWeight={set.weight ?? 0} unit={unit} />
        </div>
      ) : null}
    </div>
  );
}
