import { useEffect, useState } from "react";
import type { WeightUnit } from "../types";

const PLATE_SETS: Record<WeightUnit, number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 15, 10, 5, 2.5],
};

const DEFAULT_BAR: Record<WeightUnit, number> = { kg: 20, lb: 45 };
const BAR_OPTIONS: Record<WeightUnit, number[]> = {
  kg: [20, 15, 10],
  lb: [45, 35, 15],
};

/** Height (px) and fill color for each plate weight — standard gym color coding. */
const PLATE_VISUAL: Record<
  WeightUnit,
  Record<number, { height: number; color: string; labelLight: boolean }>
> = {
  lb: {
    45: { height: 48, color: "#dc2626", labelLight: true },
    35: { height: 42, color: "#eab308", labelLight: false },
    25: { height: 36, color: "#16a34a", labelLight: true },
    15: { height: 30, color: "#facc15", labelLight: false },
    10: { height: 24, color: "#94a3b8", labelLight: true },
    5: { height: 18, color: "#f1f5f9", labelLight: false },
    2.5: { height: 14, color: "#cbd5e1", labelLight: false },
  },
  kg: {
    25: { height: 48, color: "#dc2626", labelLight: true },
    20: { height: 44, color: "#2563eb", labelLight: true },
    15: { height: 38, color: "#eab308", labelLight: false },
    10: { height: 32, color: "#16a34a", labelLight: true },
    5: { height: 24, color: "#f1f5f9", labelLight: false },
    2.5: { height: 20, color: "#cbd5e1", labelLight: false },
    1.25: { height: 16, color: "#94a3b8", labelLight: true },
  },
};

const DEFAULT_PLATE_VISUAL = {
  height: 20,
  color: "#94a3b8",
  labelLight: true,
};

function formatPlate(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : String(weight);
}

function flattenPlates(
  breakdown: { plate: number; count: number }[],
): number[] {
  return breakdown.flatMap(({ plate, count }) =>
    Array.from({ length: count }, () => plate),
  );
}

function BarEndSchematic({
  plates,
  unit,
}: {
  plates: number[];
  unit: WeightUnit;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="flex w-max items-center gap-0 py-1">
        {/* bar shaft (toward center of barbell) */}
        <div className="h-2 w-10 shrink-0 rounded-l-full bg-gradient-to-l from-slate-400 to-slate-300" />

        {/* plates, loaded largest-first toward center */}
        <div className="flex shrink-0 items-center">
          {plates.map((plate, i) => {
            const vis = PLATE_VISUAL[unit][plate] ?? DEFAULT_PLATE_VISUAL;
            return (
              <div
                key={`${plate}-${i}`}
                className="flex w-7 shrink-0 flex-col items-center justify-center rounded-[2px] border border-slate-600/25 shadow-sm"
                style={{
                  height: vis.height,
                  backgroundColor: vis.color,
                }}
              >
                <span
                  className={`text-[9px] font-bold leading-none ${
                    vis.labelLight ? "text-white" : "text-slate-800"
                  }`}
                >
                  {formatPlate(plate)}
                </span>
              </div>
            );
          })}
        </div>

        {/* collar clamp on the outer end */}
        <div className="ml-0.5 flex h-6 w-2.5 shrink-0 items-center rounded-sm bg-slate-500 shadow-sm" />
      </div>
    </div>
  );
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
    barWeight + 2 * breakdown.reduce((sum, b) => sum + b.plate * b.count, 0);
  const platesOnSide = flattenPlates(breakdown);

  const showSchematic =
    targetWeight > 0 && targetWeight >= barWeight;

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
        ) : showSchematic ? (
          <div>
            <span className="font-medium text-slate-500">Per side</span>
            <BarEndSchematic plates={platesOnSide} unit={unit} />
            {breakdown.length === 0 ? (
              <span className="text-slate-500">Empty bar.</span>
            ) : null}
          </div>
        ) : null}
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
