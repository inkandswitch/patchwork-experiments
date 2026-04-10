import { createSignal, Show, For, type JSX } from 'solid-js';
import type { TokenState, TokenInstance, NetDef, NetState } from './lib';
import { resolveTokenColor } from './renderer';

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function getTokensByType(
  tokens: NetState,
  typeId: string,
): Array<{ token: TokenInstance; placeId: string }> {
  const result: Array<{ token: TokenInstance; placeId: string }> = [];
  for (const [placeId, placeTokens] of Object.entries(tokens ?? {})) {
    for (const t of placeTokens) {
      if ((t as TokenInstance).state.type === typeId) {
        result.push({ token: t as TokenInstance, placeId });
      }
    }
  }
  return result;
}

export function getInitialTokensByType(
  initialTokens: Array<{ placeId: string; state: TokenState }>,
  typeId: string,
): Array<{ token: { id: string; state: TokenState }; placeId: string }> {
  const result: Array<{ token: { id: string; state: TokenState }; placeId: string }> = [];
  initialTokens.forEach((t, i) => {
    if (t.state.type === typeId) {
      result.push({ token: { id: `init-${i}`, state: t.state }, placeId: t.placeId });
    }
  });
  return result;
}

export function CollapsibleSection(props: {
  title: string;
  color?: string;
  count?: number;
  defaultOpen?: boolean;
  children: JSX.Element;
}) {
  const [isOpen, setIsOpen] = createSignal(props.defaultOpen ?? true);

  return (
    <div class={`p3n-collapsible${isOpen() ? '' : ' p3n-collapsible-closed'}`}>
      <button class="p3n-collapsible-header" onClick={() => setIsOpen(!isOpen())}>
        <span class="p3n-collapsible-toggle">{isOpen() ? '▼' : '▶'}</span>
        <Show when={props.color}>
          <span class="p3n-collapsible-dot" style={{ background: props.color }} />
        </Show>
        <span class="p3n-collapsible-title">{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="p3n-collapsible-count">{props.count}</span>
        </Show>
      </button>
      <Show when={isOpen()}>
        <div class="p3n-collapsible-body">{props.children}</div>
      </Show>
    </div>
  );
}

export function TokenCard(props: {
  token: { id: string; state: TokenState };
  placeId: string;
  def: NetDef;
  isSelected?: boolean;
  onSelect?: () => void;
  onDelete?: () => void;
  onPromptChange?: (newPrompt: string) => void;
  showHeader?: boolean;
}) {
  const color = () => resolveTokenColor(props.token.state, props.def);
  const specUrl = () => (props.token.state as Record<string, unknown>).specUrl as string | undefined;
  const prompt = () => (props.token.state as Record<string, unknown>).prompt as string | undefined;

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  return (
    <div
      class={`p3n-token-card${props.isSelected ? ' p3n-token-card-selected' : ''}`}
      onClick={props.onSelect}
    >
      <Show when={props.showHeader !== false}>
        <div class="p3n-token-card-header">
          <span class="p3n-token-card-dot" style={{ background: color() }} />
          <span class="p3n-token-card-place">{props.placeId}</span>
          <Show when={props.onDelete}>
            <button
              class="p3n-token-card-delete"
              onClick={(e) => {
                e.stopPropagation();
                props.onDelete?.();
              }}
            >
              ×
            </button>
          </Show>
        </div>
      </Show>
      <Show when={prompt() !== undefined}>
        <div class="p3n-token-card-prompt">
          <textarea
            class="p3n-token-card-prompt-textarea"
            value={prompt() ?? ''}
            onClick={(e) => e.stopPropagation()}
            onInput={(e) => autoResize(e.currentTarget)}
            onBlur={(e) => props.onPromptChange?.(e.currentTarget.value)}
            ref={(el) => setTimeout(() => autoResize(el), 0)}
            placeholder="Enter prompt..."
          />
        </div>
      </Show>
      <Show when={specUrl()}>
        {(url) => (
          <div class="p3n-token-card-spec">
            <patchwork-view attr:doc-url={url()} class="p3n-token-card-patchwork" />
          </div>
        )}
      </Show>
    </div>
  );
}

export function TokenTypeSection(props: {
  tokenType: { id: string; label: string; color: string };
  tokens: Array<{ token: { id: string; state: TokenState }; placeId: string }>;
  def: NetDef;
  selectedTokenId?: string | null;
  onSelectToken?: (id: string) => void;
  onDeleteToken?: (id: string) => void;
  onPromptChange?: (tokenId: string, newPrompt: string) => void;
}) {
  return (
    <CollapsibleSection
      title={props.tokenType.label}
      color={props.tokenType.color}
      count={props.tokens.length}
      defaultOpen={props.tokens.length > 0}
    >
      <div class="p3n-token-type-content">
        <Show
          when={props.tokens.length > 0}
          fallback={<div class="p3n-token-empty-hint">No {props.tokenType.label.toLowerCase()} tokens</div>}
        >
          <For each={props.tokens}>
            {({ token, placeId }) => (
              <TokenCard
                token={token}
                placeId={placeId}
                def={props.def}
                isSelected={props.selectedTokenId === token.id}
                onSelect={() => props.onSelectToken?.(token.id)}
                onDelete={props.onDeleteToken ? () => props.onDeleteToken!(token.id) : undefined}
                onPromptChange={
                  props.onPromptChange ? (newPrompt) => props.onPromptChange!(token.id, newPrompt) : undefined
                }
              />
            )}
          </For>
        </Show>
      </div>
    </CollapsibleSection>
  );
}
