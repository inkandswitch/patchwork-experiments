import type { AutomergeUrl } from "@automerge/automerge-repo/slim";

export interface DocLink {
  name: string;
  type: string;
  url: AutomergeUrl;
}

export interface FolderDoc {
  "@patchwork"?: { type: string };
  title: string;
  docs: DocLink[];
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "patchwork-view": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "doc-url"?: AutomergeUrl | string | null;
          "tool-id"?: string;
        },
        HTMLElement
      >;
    }
  }
}
