// The LLM generation/evaluation loop: streams chat completions, parses and
// evaluates <script> blocks against the live canvas, and writes the effect into
// the card's folder. See llm-loop.ts for the entry point.
export { runLlmLoop } from "./llm-loop";
