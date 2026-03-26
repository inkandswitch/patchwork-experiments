import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import { For } from 'solid-js';
import type { PanelEntry, PanelPosition, PaperDoc } from './types.js';
import './panel-layout.css';

// ─── Layout bucket mapping ────────────────────────────────────────────────────
//
// Left column  — start: top-left / left-top
//              — center: left-center
//              — end:   bottom-left / left-bottom
//
// Right column — start: top-right / right-top
//              — center: right-center
//              — end:   bottom-right / right-bottom
//
// Top bar      — center only: top-center
// Bottom bar   — center only: bottom-center

function panelsAt(panels: PanelEntry[], ...positions: PanelPosition[]) {
  return panels.filter((p) => (positions as string[]).includes(p.position));
}

// ─── Panel Layout ─────────────────────────────────────────────────────────────

export function PanelLayout(props: { handle: DocHandle<PaperDoc> }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);
  const panels = () => doc.panels ?? [];

  return (
    <div class="paper-panel-overlay">
      {/* Left column */}
      <div class="paper-panel-col paper-panel-col--left">
        <div class="paper-panel-group paper-panel-group--start">
          <For each={panelsAt(panels(), 'top-left', 'left-top')}>
            {(entry) => <PanelSlot entry={entry} handle={props.handle} />}
          </For>
        </div>
        <div class="paper-panel-group paper-panel-group--center">
          <For each={panelsAt(panels(), 'left-center')}>
            {(entry) => <PanelSlot entry={entry} handle={props.handle} />}
          </For>
        </div>
        <div class="paper-panel-group paper-panel-group--end">
          <For each={panelsAt(panels(), 'bottom-left', 'left-bottom')}>
            {(entry) => <PanelSlot entry={entry} handle={props.handle} />}
          </For>
        </div>
      </div>

      {/* Middle column: top bar + canvas slot + bottom bar */}
      <div class="paper-panel-middle">
        <div class="paper-panel-bar paper-panel-bar--top">
          <For each={panelsAt(panels(), 'top-center')}>
            {(entry) => <PanelSlot entry={entry} handle={props.handle} />}
          </For>
        </div>

        {/* Canvas fills the remaining space — no panels here */}
        <div class="paper-panel-canvas-slot" />

        <div class="paper-panel-bar paper-panel-bar--bottom">
          <For each={panelsAt(panels(), 'bottom-center')}>
            {(entry) => <PanelSlot entry={entry} handle={props.handle} />}
          </For>
        </div>
      </div>

      {/* Right column */}
      <div class="paper-panel-col paper-panel-col--right">
        <div class="paper-panel-group paper-panel-group--start">
          <For each={panelsAt(panels(), 'top-right', 'right-top')}>
            {(entry) => <PanelSlot entry={entry} handle={props.handle} />}
          </For>
        </div>
        <div class="paper-panel-group paper-panel-group--center">
          <For each={panelsAt(panels(), 'right-center')}>
            {(entry) => <PanelSlot entry={entry} handle={props.handle} />}
          </For>
        </div>
        <div class="paper-panel-group paper-panel-group--end">
          <For each={panelsAt(panels(), 'bottom-right', 'right-bottom')}>
            {(entry) => <PanelSlot entry={entry} handle={props.handle} />}
          </For>
        </div>
      </div>
    </div>
  );
}

// ─── Panel Slot ───────────────────────────────────────────────────────────────

function PanelSlot(props: { entry: PanelEntry; handle: DocHandle<PaperDoc> }) {
  return (
    <div class="paper-panel-slot">
      <patchwork-view attr:doc-url={props.handle.url} attr:tool-id={props.entry.toolId} />
    </div>
  );
}
