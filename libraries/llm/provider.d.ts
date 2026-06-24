export function definePatchworkLLMConfigProvider(): void;
export class PatchworkLLMConfigProvider extends HTMLElement {
    static get observedAttributes(): string[];
    _config: any;
    _subs: Set<any>;
    _onSubscribe(e: any): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    attributeChangedCallback(): void;
    _fromAttrs(base: any): {
        provider: any;
        temperature: any;
        topP: any;
        topK: any;
        minP: any;
        repetitionPenalty: any;
        frequencyPenalty: any;
        presencePenalty: any;
        seed: any;
        maxTokens: any;
        outputAttentions: any;
        local: any;
        openrouter: any;
        ollama: any;
        webllm: any;
        builtin: any;
        tools: any;
        toolSandbox: boolean;
        prompts: any;
        systemUrl: any;
        preUrl: any;
        recentModels: any;
    };
    _emit(): void;
    set config(c: any);
    get config(): any;
    /** Open the picker scoped to this provider (writes back here). */
    configure(): any;
}
