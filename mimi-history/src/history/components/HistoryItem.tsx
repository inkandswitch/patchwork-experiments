import { Show } from "solid-js";
import type { HistoryItem as HistoryItemType } from "../../types";
import { formatTime } from "../utils";
import { TimelineCard } from "./TimelineCard";
import { LabeledField } from "./LabeledField";

export interface HistoryItemProps {
  item: HistoryItemType;
  isSelected: boolean;
  onClick: () => void;
}

export function HistoryItem(props: HistoryItemProps) {
  const changeCount = () => props.item.count;
  const timeDisplay = () => formatTime(props.item.endTime);
  const additions = () => props.item.additions;
  const deletions = () => props.item.deletions;
  const hasDiff = () => additions() !== undefined || deletions() !== undefined;

  return (
    <TimelineCard isSelected={props.isSelected} onClick={props.onClick}>
      <div class="flex justify-between items-start">
        <LabeledField label="Changes">
          <div class="flex items-center gap-2">
            <Show when={hasDiff()} fallback={<span>{changeCount()}</span>}>
              <span class="text-green-500">+{additions() ?? 0}</span>
              <span class="text-red-500">-{deletions() ?? 0}</span>
            </Show>
          </div>
        </LabeledField>
        <div class="text-[var(--history-muted-fg)] text-xs">{timeDisplay()}</div>
      </div>
    </TimelineCard>
  );
}
