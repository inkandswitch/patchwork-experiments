import {
  Check,
  ChevronDown,
  Clipboard,
  PenLine,
  Plus,
  Trash2,
  X,
} from "lucide-react";

const ICON_SIZE = 15;
const ICON_STROKE = 2;

interface IconColors {
  edit: string;
  delete: string;
  add: string;
  copy: string;
  ok: string;
  cancel: string;
  collection: string;
}

export const darkIconColors: IconColors = {
  edit: "#ebcb8b",
  delete: "#bf616a",
  add: "#a3be8c",
  copy: "#88c0d0",
  ok: "#a3be8c",
  cancel: "#bf616a",
  collection: "#81a1c1",
};

export const lightIconColors: IconColors = {
  edit: "#f9a825",
  delete: "#c62828",
  add: "#2e7d32",
  copy: "#0277bd",
  ok: "#2e7d32",
  cancel: "#c62828",
  collection: "#4c566a",
};

export function makeIcons(c: IconColors) {
  return {
    add: <Plus size={ICON_SIZE} strokeWidth={ICON_STROKE} color={c.add} />,
    edit: <PenLine size={ICON_SIZE} strokeWidth={ICON_STROKE} color={c.edit} />,
    delete: (
      <Trash2 size={ICON_SIZE} strokeWidth={ICON_STROKE} color={c.delete} />
    ),
    copy: (
      <Clipboard size={ICON_SIZE} strokeWidth={ICON_STROKE} color={c.copy} />
    ),
    ok: <Check size={ICON_SIZE} strokeWidth={ICON_STROKE} color={c.ok} />,
    cancel: <X size={ICON_SIZE} strokeWidth={ICON_STROKE} color={c.cancel} />,
    chevron: <ChevronDown size={14} strokeWidth={2} color={c.collection} />,
  };
}

const darkPropertyStyle = (({ parentData }: any) =>
  Array.isArray(parentData)
    ? { color: "rgba(216, 222, 233, 0.3)" }
    : { color: "#88c0d0" }) as any;

const lightPropertyStyle = (({ parentData }: any) =>
  Array.isArray(parentData)
    ? { color: "rgba(0, 0, 0, 0.3)" }
    : { color: "#5e81ac" }) as any;

export const nordDarkTheme = {
  displayName: "Nord Dark",
  styles: {
    container: {
      backgroundColor: "transparent",
      fontFamily: "ui-monospace, monospace",
    },
    property: darkPropertyStyle,
    bracket: { color: "rgba(216, 222, 233, 0.35)" },
    itemCount: {
      color: "rgba(216, 222, 233, 0.4)",
      fontStyle: "italic" as const,
    },
    string: "#a3be8c",
    number: "#b48ead",
    boolean: "#81a1c1",
    null: {
      color: "#bf616a",
      fontVariant: "small-caps" as const,
      fontWeight: "bold" as const,
    },
    input: {
      color: "#d8dee9",
      backgroundColor: "#3b4252",
      fontSize: "100%",
      borderRadius: "3px",
    },
    inputHighlight: "#434c5e",
    error: {
      fontSize: "0.8em",
      color: "#bf616a",
      fontWeight: "bold" as const,
    },
    iconCollection: "#81a1c1",
    iconEdit: "#ebcb8b",
    iconDelete: "#bf616a",
    iconAdd: "#a3be8c",
    iconCopy: "#88c0d0",
    iconOk: "#a3be8c",
    iconCancel: "#bf616a",
  },
};

export const nordLightTheme = {
  displayName: "Nord Light",
  styles: {
    container: {
      backgroundColor: "transparent",
      fontFamily: "ui-monospace, monospace",
    },
    property: lightPropertyStyle,
    bracket: { color: "rgba(0, 0, 0, 0.3)" },
    itemCount: {
      color: "rgba(0, 0, 0, 0.35)",
      fontStyle: "italic" as const,
    },
    string: "#2e7d32",
    number: "#6a1b9a",
    boolean: "#0277bd",
    null: {
      color: "#c62828",
      fontVariant: "small-caps" as const,
      fontWeight: "bold" as const,
    },
    input: {
      color: "#2e3440",
      backgroundColor: "rgba(0,0,0,0.04)",
      fontSize: "100%",
      borderRadius: "3px",
    },
    inputHighlight: "#e3f2fd",
    error: {
      fontSize: "0.8em",
      color: "#c62828",
      fontWeight: "bold" as const,
    },
    iconCollection: "#4c566a",
    iconEdit: "#f9a825",
    iconDelete: "#c62828",
    iconAdd: "#2e7d32",
    iconCopy: "#0277bd",
    iconOk: "#2e7d32",
    iconCancel: "#c62828",
  },
};
