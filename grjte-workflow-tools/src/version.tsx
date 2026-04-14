import "./version.css";

export const WORKFLOW_TOOLS_VERSION = "0.2.0";

export function VersionBadge() {
  return <span class="grjte-version">v{WORKFLOW_TOOLS_VERSION}</span>;
}
