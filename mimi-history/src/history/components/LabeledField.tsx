import type { JSXElement } from "solid-js";

export interface LabeledFieldProps {
  label: string;
  children: JSXElement;
}

/**
 * Renders a labeled field with a small uppercase label and content below.
 */
export function LabeledField(props: LabeledFieldProps) {
  return (
    <div>
      <div class="text-[11px] font-medium text-[var(--history-muted-fg)] uppercase tracking-wide mb-0.5">
        {props.label}
      </div>
      <div class="text-sm text-[var(--history-fg)]">{props.children}</div>
    </div>
  );
}
