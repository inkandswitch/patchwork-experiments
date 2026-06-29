// A generic card: free-form `props` plus a human-readable `content` string. The
// display name lives in `@patchwork.title` (read by token pills and the rest of
// the app). An optional top-level `viewUrl` names an inline render module: when
// set, an embed token for this card draws that custom face instead of a plain
// title pill. Contributors (e.g. the POI provider) mint cards to carry
// structured data — the schema-match provider then finds well-shaped subtrees
// inside `props`.
export type CardDoc = {
  "@patchwork": { type: "card"; title?: string };
  props: Record<string, unknown>;
  content: string;
  viewUrl?: string;
};
