// The shortcuts sheet: every key and modified click the frame answers to,
// grouped, spelled for this platform (see `shortcuts.ts`). ? or the top
// bar's keyboard button opens it; Escape, ? again, the × or a click
// elsewhere closes it.

import { useEffect, useRef } from "react";
import { isMac } from "./quickOpenItems";
import { SHORTCUT_GROUPS, spell } from "./shortcuts";

export const ShortcutsSheet = ({ onClose }: { onClose: () => void }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const mac = isMac();

  useEffect(() => {
    rootRef.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  return (
    <div
      className="tile-shortcuts"
      ref={rootRef}
      role="dialog"
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "?") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="tile-shortcuts__header">
        <h2>Keyboard shortcuts</h2>
        <button type="button" className="tile-shortcuts__close" aria-label="Close" onClick={onClose}>
          <svg width="10" height="10" viewBox="0 0 8 8" aria-hidden>
            <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </header>
      <div className="tile-shortcuts__groups">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="tile-shortcuts__group">
            <h3>{group.title}</h3>
            <dl>
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.id} className="tile-shortcuts__row" data-shortcut={shortcut.id}>
                  <dt>{shortcut.label}</dt>
                  <dd>
                    <kbd>{spell(mac ? shortcut.mac : shortcut.other, mac)}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="tile-shortcuts__note">
        Keys pressed in a tool that runs in its own frame don't reach these. A tool that uses
        one of these keys itself keeps it.
      </p>
    </div>
  );
};
