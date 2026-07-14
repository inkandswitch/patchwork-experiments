import type { JSX } from "solid-js";

// A small inline-SVG icon registry keyed by the name a card stores on its
// document. Kept local (rather than pulling in a full icon dependency) so a
// card's corner pips render on both faces without loading its behavior module,
// and so every glyph shares one 24x24 stroke style and reads as a matched set.
export function CardIcon(props: { name: string }): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {glyph(props.name)}
    </svg>
  );
}

function glyph(name: string): JSX.Element {
  switch (name) {
    case "pin":
      return (
        <>
          <path d="M20 10c0 4.4-8 12-8 12s-8-7.6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </>
      );
    case "ruler":
      return (
        <>
          <path d="M3 8h18v8H3z" transform="rotate(45 12 12)" />
          <path d="M9 7v2M12 6v3M15 7v2" transform="rotate(45 12 12)" />
        </>
      );
    case "clock":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      );
    case "sun":
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </>
      );
    case "route":
      return (
        <>
          <circle cx="6" cy="19" r="2.5" />
          <circle cx="18" cy="5" r="2.5" />
          <path d="M8.5 19H14a3.5 3.5 0 0 0 0-7H10a3.5 3.5 0 0 1 0-7h5.5" />
        </>
      );
    case "at":
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
        </>
      );
    case "bird":
      return (
        <>
          <path d="M16 7h.01" />
          <path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L3.4 18Z" />
          <path d="m20 7 2 .5-2 .5" />
          <path d="M10 18v3" />
          <path d="M14 17.75V21" />
          <path d="M7 18a6 6 0 0 0 3.84-10.61" />
        </>
      );
    case "dollar":
      return (
        <>
          <path d="M12 2v20" />
          <path d="M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5 9.2 9.5 12 10s5 1.5 5 3.5-2.2 3-5 3-5-1.1-5-3" />
        </>
      );
    case "slash":
      return <path d="M17 5 7 19" />;
    case "pointer":
      return <path d="M4 3l7.5 18 2.6-7.9L22 10.5z" />;
    case "selection":
      return (
        <>
          <path d="M4 8V5a1 1 0 0 1 1-1h3" />
          <path d="M16 4h3a1 1 0 0 1 1 1v3" />
          <path d="M20 16v3a1 1 0 0 1-1 1h-3" />
          <path d="M8 20H5a1 1 0 0 1-1-1v-3" />
        </>
      );
    case "file":
      return (
        <>
          <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
          <path d="M14 2v5h5" />
        </>
      );
    case "braces":
      return (
        <>
          <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />
          <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />
        </>
      );
    case "shapes":
      return (
        <>
          <path d="M8.3 10 12.6 3l4.3 7Z" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <circle cx="17.5" cy="17.5" r="3.5" />
        </>
      );
    case "zoom":
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
          <path d="M11 8v6M8 11h6" />
        </>
      );
    case "sparkles":
      return (
        <>
          <path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z" />
          <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </>
      );
    case "cloud":
      return <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />;
    case "wand":
      return (
        <>
          <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" />
        </>
      );
    default:
      return <rect x="4" y="4" width="16" height="16" rx="3" />;
  }
}
