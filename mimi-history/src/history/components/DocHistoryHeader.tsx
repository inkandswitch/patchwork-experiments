import { Show } from "solid-js";

export interface DocHistoryHeaderProps {
  title?: string;
  onRecompute: () => void;
  isRecalculating?: boolean;
}

export function DocHistoryHeader(props: DocHistoryHeaderProps) {
  return (
    <div class="py-2 px-5 flex justify-between items-center gap-2">
      <div class="flex flex-col min-w-0">
        <div class="font-medium">Version History</div>
        <Show when={props.title !== undefined}>
          <div class="text-[10px] text-gray-400 truncate mt-0.5">{props.title}</div>
        </Show>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <button
          class="btn btn-sm btn-ghost btn-square"
          disabled={props.isRecalculating}
          title={props.isRecalculating ? "Recalculating history..." : "Recompute"}
          onClick={(e) => { e.stopPropagation(); props.onRecompute(); }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class={props.isRecalculating ? "animate-spin [animation-direction:reverse]" : ""}
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
