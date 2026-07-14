import type { ExerciseProgressPoint } from "../types";

export function ProgressChart({
  points,
  valueKey,
  unit,
  height = 120,
}: {
  points: ExerciseProgressPoint[];
  valueKey: keyof Pick<
    ExerciseProgressPoint,
    "estimated1Rm" | "volume" | "bestWeight"
  >;
  unit?: string;
  height?: number;
}) {
  if (points.length < 2) return null;

  const values = points.map((p) => p[valueKey]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 280;
  const padding = 8;

  const coords = points.map((point, index) => {
    const x =
      padding +
      (index / (points.length - 1)) * (width - padding * 2);
    const y =
      height -
      padding -
      ((point[valueKey] - min) / range) * (height - padding * 2);
    return { x, y, point };
  });

  const pathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`)
    .join(" ");

  const latest = points[points.length - 1];

  return (
    <div className="space-y-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full text-emerald-600"
        role="img"
        aria-label="Progress chart"
      >
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          stroke="currentColor"
          strokeOpacity={0.15}
        />
        <path
          d={pathD}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={3}
            fill="currentColor"
          />
        ))}
      </svg>
      <div className="flex justify-between text-xs text-slate-500">
        <span>
          {new Date(points[0].date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
        <span className="font-medium text-emerald-700">
          {Math.round(latest[valueKey])}
          {unit && valueKey !== "volume" ? ` ${unit}` : ""}
        </span>
        <span>
          {new Date(latest.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </div>
  );
}
