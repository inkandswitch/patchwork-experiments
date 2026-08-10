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
    <div className="st-unit-toggle">
      {(["kg", "lb"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => onChange(u)}
          className="st-unit-toggle__option"
          data-active={value === u || undefined}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
