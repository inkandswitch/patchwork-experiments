import "./version.css";

export const WORKFLOW_TOOLS_VERSION = "0.5.5";

export function VersionBadge() {
  return <span class="grjte-version">v{WORKFLOW_TOOLS_VERSION}</span>;
}
