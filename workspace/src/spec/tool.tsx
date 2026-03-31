import { render } from 'solid-js/web';
import { For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import type { SpecCollectionDoc, SpecDoc, Verification } from '../types';
import './spec.css';

export const SpecTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <SpecCollectionView url={(handle as DocHandle<SpecCollectionDoc>).url} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function SpecCollectionView(props: { url: AutomergeUrl }) {
  const [doc] = useDocument<SpecCollectionDoc>(() => props.url);

  return (
    <div class="spec-root">
      <Show when={doc()} fallback={<div class="spec-loading">Loading specs…</div>}>
        {(currentDoc) => {
          const specs = () => currentDoc().specs ?? [];

          return (
            <Show
              when={specs().length > 0}
              fallback={<div class="spec-empty">No specs in this collection.</div>}
            >
              <div class="spec-collection">
                <For each={specs()}>
                  {(spec) => <SpecCard spec={spec} />}
                </For>
              </div>
            </Show>
          );
        }}
      </Show>
    </div>
  );
}

function SpecCard(props: { spec: SpecDoc }) {
  const docEntries = () => Object.entries(props.spec.docs ?? {}) as [string, AutomergeUrl][];
  const requiredDocs = () => props.spec.requiredDocs ?? [];
  const verifications = () => props.spec.verifications ?? [];

  return (
    <div class="spec-card">
      <div class="spec-card-goal">{props.spec.goal || 'Untitled spec'}</div>

      <Show when={docEntries().length > 0}>
        <div class="spec-section">
          <div class="spec-section-label">Documents</div>
          <div class="spec-doc-list">
            <For each={docEntries()}>
              {([name, url]) => <DocCard name={name} url={url} />}
            </For>
          </div>
        </div>
      </Show>

      <Show when={requiredDocs().length > 0}>
        <div class="spec-section">
          <div class="spec-section-label">Required Documents</div>
          <div class="spec-required-docs">
            <For each={requiredDocs()}>
              {(name) => <div class="spec-required-doc">{name}</div>}
            </For>
          </div>
        </div>
      </Show>

      <Show when={verifications().length > 0}>
        <div class="spec-section">
          <div class="spec-section-label">Verifications</div>
          <div class="spec-verification-list">
            <For each={verifications()}>
              {(v) => <VerificationCard verification={v} />}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}

function DocCard(props: { name: string; url: AutomergeUrl }) {
  return (
    <div class="spec-doc-card">
      <div class="spec-doc-card-label">{props.name}</div>
      <div class="spec-doc-card-view">
        <patchwork-view
          attr:doc-url={props.url}
          style="display:block;width:100%;height:100%;"
        />
      </div>
    </div>
  );
}

function VerificationCard(props: { verification: Verification }) {
  return (
    <details class="spec-verification-card">
      <summary class="spec-verification-summary">
        <div class="spec-verification-icon" />
        <span class="spec-verification-name">{props.verification.name}</span>
      </summary>
      <pre class="spec-verification-script">{props.verification.script.trim()}</pre>
    </details>
  );
}
