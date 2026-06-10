import { formatTargetReps } from "../calculations";
import type { LoggedSet, TemplateSet } from "../types";

const inputClass =
  "w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-emerald-400";

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
  onChange,
  onToggleComplete,
}: {
  set: LoggedSet;
  index: number;
  unit: string;
  executing?: boolean;
  onChange: (patch: Partial<LoggedSet>) => void;
  onToggleComplete: () => void;
}) {
  return (
    <div
      className={`grid grid-cols-[2rem_1fr_1fr_1fr_auto] items-center gap-2 rounded px-1 py-1 text-sm ${
        set.completed ? "bg-emerald-50" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggleComplete}
        className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
          set.completed
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-slate-300 text-transparent hover:border-emerald-400"
        }`}
        title={set.completed ? "Mark incomplete" : "Complete set"}
      >
        ✓
      </button>
      <input
        type="number"
        placeholder="Reps"
        value={set.reps ?? ""}
        disabled={!executing}
        onChange={(e) =>
          onChange({ reps: e.target.value ? Number(e.target.value) : undefined })
        }
        className={inputClass}
      />
      <input
        type="number"
        placeholder={`Weight (${unit})`}
        value={set.weight ?? ""}
        disabled={!executing}
        onChange={(e) =>
          onChange({
            weight: e.target.value ? Number(e.target.value) : undefined,
          })
        }
        className={inputClass}
      />
      <input
        type="number"
        placeholder="RPE"
        min={1}
        max={10}
        step={0.5}
        value={set.rpe ?? ""}
        disabled={!executing}
        onChange={(e) =>
          onChange({ rpe: e.target.value ? Number(e.target.value) : undefined })
        }
        className={inputClass}
      />
      <span className="w-6 text-center text-xs text-slate-400">{index + 1}</span>
    </div>
  );
}
