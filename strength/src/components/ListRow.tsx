import type { ReactNode } from "react";

/**
 * Selectable row for master/detail list panes (sessions, templates,
 * progress exercises). Children render the meta line(s) under the title.
 */
export function ListRow({
  title,
  selected,
  onClick,
  children,
}: {
  title: string;
  selected: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="st-list-row"
      data-selected={selected || undefined}
    >
      <div className="st-list-row__title">{title}</div>
      {children}
    </button>
  );
}
