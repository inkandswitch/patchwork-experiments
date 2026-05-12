import type { JSXElement } from "solid-js";

export interface TimelineCardProps {
  isSelected: boolean;
  onClick: () => void;
  children: JSXElement;
}

/**
 * Card wrapper providing timeline dot, connecting line,
 * selected/unselected styling, and accessibility attributes.
 */
export function TimelineCard(props: TimelineCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={props.isSelected}
      onClick={props.onClick}
      class={
        "relative text-xs py-1.5 px-3 pl-6 rounded border cursor-pointer " +
        (props.isSelected
          ? "bg-[var(--history-accent)] border-[var(--history-accent)] text-[var(--history-accent-fg)] [&_*]:text-[var(--history-accent-fg)]"
          : "bg-[var(--history-card-bg)] border-[var(--history-card-border)] hover:bg-[var(--history-card-hover-bg)]")
      }
    >
      {/* Timeline dot */}
      <div class={"absolute left-2 top-2.5 w-2 h-2 rounded-full " + (props.isSelected ? "bg-[var(--history-accent-fg)]" : "bg-[var(--history-accent)]")}></div>

      {/* Timeline line */}
      <div class="absolute left-[11px] top-[22px] bottom-0 w-0.5 bg-[var(--history-section-divider)] timeline-line"></div>

      {props.children}
    </div>
  );
}
