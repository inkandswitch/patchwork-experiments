import { render } from "solid-js/web";
import { findContextStore, type ContextViewMount } from "@embark/context";
import { EmbedToken, useHighlight } from "@embark/selection/tokens";
import type { Suggestion } from "./suggestion";

// The `suggestion` context view: a command suggestion drawn as a labeled token
// over its prototype card document, wired to the shared hover->Highlight
// interaction (store resolved from the mounted element, like the doc-url view).
export const suggestionView: ContextViewMount = (element, value) => {
  const suggestion = value as Suggestion;
  const store = findContextStore(element);
  return render(() => {
    const highlight = useHighlight(store);
    return (
      <EmbedToken
        url={suggestion.url}
        label={suggestion.label}
        highlight={highlight}
      />
    );
  }, element);
};
