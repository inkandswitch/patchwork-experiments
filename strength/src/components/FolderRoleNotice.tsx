import type { ReactNode } from "react";

/**
 * Full-pane notice shown when a folder tool is opened on the wrong
 * strength subfolder (e.g. the Sessions tool on the Templates folder).
 */
export function FolderRoleNotice({ children }: { children: ReactNode }) {
  return (
    <div className="strength flex h-full items-center justify-center bg-slate-50 p-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}
