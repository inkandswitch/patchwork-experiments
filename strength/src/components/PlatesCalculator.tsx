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
    <div className="st-bar-scroll">
      <div className="st-bar">
        {/* bar shaft (toward center of barbell) */}
        <div className="st-bar__shaft" />

        {/* plates, loaded largest-first toward center */}
        <div className="st-bar__plates">
          {plates.map((plate, i) => {
            const vis = PLATE_VISUAL[unit][plate] ?? DEFAULT_PLATE_VISUAL;
            return (
              <div
                key={`${plate}-${i}`}
                className="st-plate"
                style={{
                  height: vis.height,
                  backgroundColor: vis.color,
                }}
              >
                <span
                  className="st-plate__label"
                  data-light={vis.labelLight || undefined}
                >
                  {formatPlate(plate)}
                </span>
              </div>
            );
          })}
        </div>

        {/* collar clamp on the outer end */}
        <div className="st-bar__collar" />
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
    <div className="st-plates">
      <div className="st-plates__row">
        <span className="st-plates__label">Bar</span>
        <div className="st-plates__options">
          {BAR_OPTIONS[unit].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setBarWeight(option)}
              className="st-plates__option"
              data-active={barWeight === option || undefined}
            >
              {option}
            </button>
          ))}
          <input
            type="number"
            inputMode="decimal"
            value={barWeight}
            onChange={(e) => setBarWeight(Number(e.target.value) || 0)}
            className="st-plates__input"
          />
          <span className="st-plates__unit">{unit}</span>
        </div>
      </div>

      <div className="st-plates__result">
        {targetWeight <= 0 ? (
          <span className="st-plates__hint">Enter a weight to see plates.</span>
        ) : targetWeight < barWeight ? (
          <span className="st-plates__warn">
            Target is below the bar weight.
          </span>
        ) : showSchematic ? (
          <div>
            <span className="st-plates__label">Per side</span>
            <BarEndSchematic plates={platesOnSide} unit={unit} />
            {breakdown.length === 0 ? (
              <span className="st-plates__hint">Empty bar.</span>
            ) : null}
          </div>
        ) : null}
        {remainder > 0.01 && targetWeight >= barWeight ? (
          <div className="st-plates__warn">
            Closest load: {Math.round(loadedWeight * 100) / 100} {unit} (
            {Math.round(remainder * 2 * 100) / 100} {unit} short)
          </div>
        ) : null}
      </div>
    </div>
  );
}
