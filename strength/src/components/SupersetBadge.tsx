/** Violet "SS A" chip marking an exercise as part of a superset group. */
export function SupersetBadge({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span className="st-superset-badge">
      SS {label}
    </span>
  );
}
