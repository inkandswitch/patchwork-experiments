/** Violet "SS A" chip marking an exercise as part of a superset group. */
export function SupersetBadge({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
      SS {label}
    </span>
  );
}
