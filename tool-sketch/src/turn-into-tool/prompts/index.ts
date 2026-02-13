import type { TurnIntoToolCapture } from "../TurnIntoToolButton";
import { BASE_PROMPT } from "./base-prompt";
import { CODEMIRROR_PLUGIN_PROMPT } from "./codemirror-plugin-prompt";

export interface PromptConfig {
  systemPrompt: string;
  /** Whether to load the generated module globally (moduleWatcher) in extend mode */
  loadGlobally: boolean;
}

/** Internal config entry for each datatype-specific prompt. */
interface DatatypePromptEntry {
  prompt: string;
  loadGlobally: boolean;
}

/**
 * Map from datatype id → specialised prompt config.
 *
 * When a capture contains embeds whose dataType matches one of these keys the
 * corresponding prompt config is used *instead of* the base prompt.
 */
const DATATYPE_PROMPTS: Record<string, DatatypePromptEntry> = {
  markdown: { prompt: CODEMIRROR_PLUGIN_PROMPT, loadGlobally: false },
  essay: { prompt: CODEMIRROR_PLUGIN_PROMPT, loadGlobally: false },
};

/** Base config used when no datatype-specific prompt matches. */
const BASE_CONFIG: PromptConfig = {
  systemPrompt: BASE_PROMPT,
  loadGlobally: true,
};

/**
 * Select the best prompt config for a given capture.
 *
 * - Collect the unique datatype-specific prompt entries from the embeds.
 * - If **all** embeds map to the **same** prompt entry (or there are no
 *   embeds), return that config (or the base config as fallback).
 * - If embeds map to **different** prompt entries, return `null`.
 *   The caller should log a warning and bail out.
 */
export function getPromptConfig(
  capture: TurnIntoToolCapture
): PromptConfig | null {
  const datatypes = new Set(
    capture.embeds.map((e) => e.dataType).filter(Boolean)
  );

  // Collect unique entries (by prompt string reference) that match
  const seen = new Set<string>();
  const matched: DatatypePromptEntry[] = [];

  for (const dt of datatypes) {
    const entry = DATATYPE_PROMPTS[dt];
    if (entry && !seen.has(entry.prompt)) {
      seen.add(entry.prompt);
      matched.push(entry);
    }
  }

  // No embeds or none matched a specialised prompt → base config
  if (matched.length === 0) {
    return BASE_CONFIG;
  }

  // All embeds matched the same prompt config
  if (matched.length === 1) {
    return {
      systemPrompt: matched[0].prompt,
      loadGlobally: matched[0].loadGlobally,
    };
  }

  // Multiple distinct prompt configs — unsupported
  console.warn(
    "[getPromptConfig] Selection contains embeds matching different prompt types. This is not yet supported."
  );
  return null;
}
