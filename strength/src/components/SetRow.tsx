import { useState } from "react";
import type { FieldPatch } from "../automerge-fields";
import { formatTargetReps } from "../calculations";
import type { LoggedSet, SetKind, TemplateSet, WeightUnit } from "../types";
import { PlatesCalculator } from "./PlatesCalculator";

const inputClass =
  "w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-emerald-400";

function roundValue(value: number): number {
  return Math.round(value * 100) / 100;
}

function nextSetKind(kind: SetKind | undefined): SetKind | null {
  if (kind == null) return "warmup";
  if (kind === "warmup") return "failure";
  return null;
}

const setKindStyles: Record<SetKind | "normal", string> = {
  normal: "text-slate-400",
  warmup: "bg-amber-100 font-semibold text-amber-700",
  failure: "bg-red-100 font-semibold text-red-700",
};

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
  const sizeClass = size === "lg" ? "h-9 w-9 text-sm" : "h-6 w-6 text-xs";
  const style = setKindStyles[kind ?? "normal"];

  if (!onCycle) {
    return (
      <span
        className={`flex ${sizeClass} items-center justify-center rounded-full ${style}`}
      >
        {setKindLabel(kind, index)}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onCycle(nextSetKind(kind))}
      title={setKindTitle(kind)}
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full ${style} ${
        kind == null ? "border border-dashed border-slate-200 hover:border-slate-400" : ""
      }`}
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
    <div className="flex min-w-0 flex-1 items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white sm:max-w-44">
      <button
        type="button"
        onClick={() => apply((value ?? 0) - step)}
        className="h-11 w-7 shrink-0 text-lg font-medium text-slate-500 active:bg-slate-100 sm:w-10"
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center border-x border-slate-100">
        <input
          type="number"
          inputMode="decimal"
          placeholder="—"
          value={value ?? ""}
          onChange={(e) =>
            onChange(e.target.value ? Number(e.target.value) : undefined)
          }
          className="w-full min-w-0 bg-transparent text-center text-sm font-semibold text-slate-900 outline-none"
        />
        <span className="pb-0.5 text-[10px] leading-none text-slate-400">
          {label}
        </span>
      </div>
      <button
        type="button"
        onClick={() => apply((value ?? 0) + step)}
        className="h-11 w-7 shrink-0 text-lg font-medium text-slate-500 active:bg-slate-100 sm:w-10"
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
    <div className="grid grid-cols-[2rem_1fr_1fr_1fr_1fr_auto] items-center gap-2 text-sm">
      <div className="flex justify-center">
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
        <div className="flex w-6 justify-center">
          <SetKindBadge kind={set.kind} index={index} />
        </div>
      </div>
    );
  }

  const weightStep = unit === "kg" ? 2.5 : 5;

  return (
    <div
      id={rowId}
      className={`rounded-lg px-1.5 py-2 sm:px-2 ${
        isCurrent
          ? "bg-emerald-50 ring-2 ring-emerald-400 ring-offset-1"
          : set.completed
            ? "bg-emerald-50/60"
            : ""
      }`}
    >
      {/* Main row is sized to fit a ~300px pane (iPhone) without wrapping:
          fixed badge + check, two flexing steppers in between. RPE, set
          kind, and the plates calculator live in the details disclosure. */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={() => setShowDetails((cur) => !cur)}
          title="Set details (RPE, set type, plates)"
          className={`flex h-11 w-8 shrink-0 flex-col items-center justify-center rounded-lg sm:w-9 ${
            setKindStyles[set.kind ?? "normal"]
          } ${set.kind == null ? "border border-dashed border-slate-200" : ""} ${
            showDetails ? "ring-1 ring-slate-300" : ""
          }`}
        >
          <span className="text-sm">{setKindLabel(set.kind, index)}</span>
          <span
            className={`text-[8px] leading-none text-slate-400 transition-transform ${
              showDetails ? "rotate-180" : ""
            }`}
          >
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
          className={`ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-lg ${
            set.completed
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-300 text-transparent hover:border-emerald-400"
          }`}
          title={set.completed ? "Mark incomplete" : "Complete set"}
        >
          ✓
        </button>
      </div>
      {showDetails ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-slate-200 text-xs">
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
                  className={`px-2.5 py-1.5 ${
                    (set.kind ?? "normal") === value
                      ? "bg-emerald-600 font-medium text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex w-36">
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
