import type { WeightUnit } from "../types";

/** kg/lb segmented control. */
export function UnitToggle({
  value,
  onChange,
}: {
  value: WeightUnit;
  onChange: (unit: WeightUnit) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-slate-200 text-xs">
      {(["kg", "lb"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className={`px-2.5 py-1 ${
            value === u
              ? "bg-emerald-600 font-medium text-white"
              : "bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
