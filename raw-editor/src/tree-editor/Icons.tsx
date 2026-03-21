import type { JSX } from "solid-js"

const S = 15
const W = 2

function Svg(props: { children: JSX.Element; class?: string; size?: number }) {
  return (
    <svg
      width={props.size ?? S}
      height={props.size ?? S}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={W}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
    >
      {props.children}
    </svg>
  )
}

export function EditIcon() {
  return (
    <Svg>
      <path d="M12 20h9" />
      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z" />
      <path d="m15 5 3 3" />
    </Svg>
  )
}

export function DeleteIcon() {
  return (
    <Svg>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </Svg>
  )
}

export function AddIcon() {
  return (
    <Svg>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Svg>
  )
}

export function CopyIcon() {
  return (
    <Svg>
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </Svg>
  )
}

export function OkIcon() {
  return (
    <Svg>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  )
}

export function CancelIcon() {
  return (
    <Svg>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  )
}

export function ChevronIcon(props: { collapsed: boolean }) {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={2.5}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.collapsed ? "te-chevron-rotated" : undefined}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function UndoIcon() {
  return (
    <Svg size={12}>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </Svg>
  )
}

export function RedoIcon() {
  return (
    <Svg size={12}>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
    </Svg>
  )
}

export function DownloadIcon() {
  return (
    <Svg size={12}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </Svg>
  )
}
