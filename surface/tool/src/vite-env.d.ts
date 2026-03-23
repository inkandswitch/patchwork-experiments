/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY?: string;
  readonly VITE_OPENAI_API_KEY?: string;
}

interface Window {
  __PAPER_LLM_API_KEY__?: string;
}
