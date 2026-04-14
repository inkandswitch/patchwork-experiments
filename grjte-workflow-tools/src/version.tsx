import "./version.css";

export const GRJTE_WORKFLOW_TOOLS_VERSION = "0.0.3";

export function GrjteVersionBadge() {
  return (
    <div class="grjte-version-badge">
      <span class="grjte-version-badge-label">grjte</span>
      <span>v{GRJTE_WORKFLOW_TOOLS_VERSION}</span>
    </div>
  );
}
