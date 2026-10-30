import type { IconNode } from "lucide";
import { createElement, useEffect, useState } from "react";

/**
 * A Lucide icon by name, as plugins declare them (`icon: "GitBranch"`).
 *
 * The full icon set is ~2000 icons, so it's loaded lazily, once, as its own
 * chunk; until it arrives (or for an unknown name) we draw `fallback`, and a
 * blank box of the same size before that so the header doesn't shift.
 */
let iconsPromise: Promise<Record<string, IconNode>> | null = null;
let loadedIcons: Record<string, IconNode> | null = null;
const loadIcons = () =>
  (iconsPromise ??= import("lucide").then((module) => {
    loadedIcons = module.icons as Record<string, IconNode>;
    return loadedIcons;
  }));

// Plugins mostly use PascalCase ("GitBranch"), but accept kebab-case too.
const toPascal = (name: string) =>
  name.includes("-")
    ? name
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("")
    : name;

const pick = (
  icons: Record<string, IconNode>,
  name: string | undefined,
  fallback: string,
): IconNode | null => (name && icons[toPascal(name)]) || icons[fallback] || null;

export const DocIcon = ({
  name,
  fallback = "File",
  size = 14,
}: {
  name: string | undefined;
  fallback?: string;
  size?: number;
}) => {
  const [node, setNode] = useState<IconNode | null>(() =>
    loadedIcons ? pick(loadedIcons, name, fallback) : null,
  );

  useEffect(() => {
    let cancelled = false;
    void loadIcons().then((icons) => {
      if (!cancelled) setNode(pick(icons, name, fallback));
    });
    return () => {
      cancelled = true;
    };
  }, [name, fallback]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {node?.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
};
