import { Show } from "solid-js";

export interface DocHistoryHeaderProps {
  title?: string;
  onRecompute: () => void;
}

export function DocHistoryHeader(props: DocHistoryHeaderProps) {
  return (
    <div class="p-2 flex justify-between items-center gap-2">
      <div class="flex flex-col min-w-0">
        <div class="font-medium">Version History</div>
        <Show when={props.title !== undefined}>
          <div class="text-[10px] text-gray-400 truncate mt-0.5">{props.title}</div>
        </Show>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <button class="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); props.onRecompute(); }}>
          Recompute
        </button>
      </div>
    </div>
  );
}
