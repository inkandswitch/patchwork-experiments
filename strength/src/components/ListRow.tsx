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
      className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-white ${
        selected ? "bg-emerald-50" : ""
      }`}
    >
      <div className="font-medium text-slate-900">{title}</div>
      {children}
    </button>
  );
}
