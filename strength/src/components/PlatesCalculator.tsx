import { useEffect, useState } from "react";
import type { WeightUnit } from "../types";

const PLATE_SETS: Record<WeightUnit, number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

const DEFAULT_BAR: Record<WeightUnit, number> = { kg: 20, lb: 45 };
const BAR_OPTIONS: Record<WeightUnit, number[]> = {
  kg: [20, 15, 10],
  lb: [45, 35, 15],
};

function formatPlate(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : String(weight);
}

export function platesPerSide(
  targetWeight: number,
  barWeight: number,
  plates: number[],
): { breakdown: { plate: number; count: number }[]; remainder: number } {
  let perSide = (targetWeight - barWeight) / 2;
  const breakdown: { plate: number; count: number }[] = [];
  if (perSide <= 0) return { breakdown, remainder: perSide };
  for (const plate of plates) {
    const count = Math.floor((perSide + 1e-9) / plate);
    if (count > 0) {
      breakdown.push({ plate, count });
      perSide -= count * plate;
    }
  }
  return { breakdown, remainder: perSide };
}

export function PlatesCalculator({
  targetWeight,
  unit,
}: {
  targetWeight: number;
  unit: WeightUnit;
}) {
  const [barWeight, setBarWeight] = useState(DEFAULT_BAR[unit]);

  useEffect(() => {
    setBarWeight(DEFAULT_BAR[unit]);
  }, [unit]);

  const { breakdown, remainder } = platesPerSide(
    targetWeight,
    barWeight,
    PLATE_SETS[unit],
  );
  const loadedWeight =
    barWeight +
    2 * breakdown.reduce((sum, b) => sum + b.plate * b.count, 0);

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-500">Bar</span>
        <div className="flex gap-1">
          {BAR_OPTIONS[unit].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setBarWeight(option)}
              className={`rounded px-2 py-1 ${
                barWeight === option
                  ? "bg-emerald-600 text-white"
                  : "border border-slate-200 bg-white text-slate-600"
              }`}
            >
              {option}
            </button>
          ))}
          <input
            type="number"
            inputMode="decimal"
            value={barWeight}
            onChange={(e) => setBarWeight(Number(e.target.value) || 0)}
            className="w-14 rounded border border-slate-200 px-1.5 py-1 text-center outline-none focus:border-emerald-400"
          />
          <span className="self-center text-slate-400">{unit}</span>
        </div>
      </div>

      <div className="mt-2">
        {targetWeight <= 0 ? (
          <span className="text-slate-400">Enter a weight to see plates.</span>
        ) : targetWeight < barWeight ? (
          <span className="text-amber-700">
            Target is below the bar weight.
          </span>
        ) : breakdown.length === 0 ? (
          <span className="text-slate-600">Empty bar.</span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-slate-500">Per side:</span>
            {breakdown.map(({ plate, count }) => (
              <span
                key={plate}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800"
              >
                {formatPlate(plate)} × {count}
              </span>
            ))}
          </div>
        )}
        {remainder > 0.01 && targetWeight >= barWeight ? (
          <div className="mt-1 text-amber-700">
            Closest load: {Math.round(loadedWeight * 100) / 100} {unit} (
            {Math.round(remainder * 2 * 100) / 100} {unit} short)
          </div>
        ) : null}
      </div>
    </div>
  );
}
