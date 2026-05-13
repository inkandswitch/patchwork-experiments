import type { JSXElement } from "solid-js";

export interface TimelineCardProps {
  isSelected: boolean;
  onClick: (e: MouseEvent) => void;
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
      onClick={(e) => { e.stopPropagation(); props.onClick(e); }}
      class={
        "relative text-xs py-1.5 px-3 rounded cursor-pointer " +
        (props.isSelected
          ? "bg-[var(--history-accent)] border-[var(--history-accent)] text-[var(--history-accent-fg)] [&_*]:text-[var(--history-accent-fg)]"
          : "bg-[var(--history-card-bg)] hover:bg-[var(--history-card-hover-bg)]")
      }
    >
      {props.children}
    </div>
  );
}
