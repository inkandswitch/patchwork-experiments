// What people call activities (STAGE.md, "Activities"), for whatever shows
// them: the activity switcher and the inspector's "Starts in". Pure.

/** The activities we know of; any other id is shown as words. */
export const ACTIVITY_LABELS = Object.freeze({
  edit: "Edit",
  play: "Play",
});

/** An activity's label: from the table, else its id as words ("free-roam" → "Free roam"). */
export function activityLabel(id) {
  const known = ACTIVITY_LABELS[id];
  if (known) return known;
  const words = String(id ?? "")
    .replace(/[-_.]+/g, " ")
    .trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "?";
}
