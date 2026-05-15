import nSyncPng from "./nsync.png";

interface SyncIconProps {
  size?: number;
  class?: string;
  state?: "synced" | "syncing" | "error" | "unknown";
}

export function SyncIcon(props: SyncIconProps) {
  const unsynced = () => (props.state ?? "synced") !== "synced";

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 26 26"
      fill="none"
      class={props.class ?? ""}
    >
      <image href={nSyncPng} x="0" y="0" width="26" height="26" />
      {unsynced() && (
        <>
          <line x1="0" y1="0" x2="26" y2="26" stroke="red" stroke-width="3" stroke-linecap="round" />
          <line x1="26" y1="0" x2="0" y2="26" stroke="red" stroke-width="3" stroke-linecap="round" />
        </>
      )}
    </svg>
  );
}
