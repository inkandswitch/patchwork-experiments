/** Is the Prompt API present at all (i.e. show the option)? */
export function builtinSupported(): boolean;
/** "available" | "downloadable" | "downloading" | "unavailable" */
export function builtinAvailability(): Promise<any>;
/**
 * Generate via the Prompt API. `onToken(delta, full)` per chunk; returns full
 * text. Handles both the old (cumulative chunk) and new (delta chunk) shapes.
 */
export function builtinGenerate(input: any, opts?: {}): Promise<string>;
