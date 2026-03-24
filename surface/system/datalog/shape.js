import { createMemo } from 'https://esm.sh/solid-js@1.9';
import { from, For, createSignal, render, html } from '../solid.js';
import {
  factKey,
  ruleKey,
  parseProgram,
  evaluateWithProvenance,
  checkConstraints,
  serializeFact,
  serializeRule,
  serializeConstraint,
  serializeFacts,
  serializeRules,
  serializeConstraints,
} from './datalog.js';
import { schema } from './schema.js';

export { schema };

// ─── Styles (injected once, ref-counted across instances) ─────────────────────

let styleRefCount = 0;
let styleElement = null;

const STYLES = `
.dl-root {
  display: flex;
  height: 100%;
  overflow: hidden;
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
  font-size: 12px;
}

.dl-editor-col {
  display: flex;
  flex-direction: column;
  width: 50%;
  min-width: 0;
  border-right: 1px solid #e2e8f0;
  overflow: hidden;
  padding: 8px;
  gap: 6px;
}

.dl-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.dl-btn {
  font-size: 11px;
  font-family: inherit;
  padding: 3px 10px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
  background: transparent;
  cursor: pointer;
  color: #334155;
  line-height: 1.5;
}

.dl-btn:hover { background: #f1f5f9; }

.dl-btn-primary {
  background: #0f172a;
  color: #f8fafc;
  border-color: #0f172a;
}

.dl-btn-primary:hover {
  background: #1e293b;
  border-color: #1e293b;
}

.dl-dirty-badge {
  font-size: 11px;
  color: #b45309;
  margin-right: auto;
}

.dl-section-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
  margin: 0 0 6px 0;
}

.dl-editor-wrap {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
}

.dl-program-view {
  height: 100%;
  margin: 0;
  padding: 6px 8px;
  overflow: auto;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #334155;
  white-space: pre;
  box-sizing: border-box;
}

.dl-program-item {
  padding: 1px 4px;
  border-radius: 3px;
  border-left: 3px solid transparent;
}

.dl-program-separator { height: 10px; }

.dl-editor-textarea {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: none;
  outline: none;
  resize: none;
  font-family: ui-monospace, 'Cascadia Code', Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #334155;
  background: #fff;
}

.dl-errors {
  margin: 4px 0 0 0;
  padding: 0;
  list-style: none;
}

.dl-errors li {
  color: #dc2626;
  font-size: 11px;
  padding: 2px 0;
}

.dl-derived {
  display: flex;
  flex-direction: column;
  width: 50%;
  min-width: 0;
  padding: 8px;
  overflow: hidden;
}

.dl-derived-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.dl-empty {
  color: #94a3b8;
  margin: 16px 0;
}

.dl-pred-group { margin-bottom: 12px; }

.dl-pred-name {
  font-weight: 700;
  color: #334155;
  margin-bottom: 3px;
  padding-bottom: 2px;
  border-bottom: 1px solid #e2e8f0;
}

.dl-fact {
  padding: 2px 4px;
  border-radius: 3px;
  border-left: 3px solid transparent;
  line-height: 1.7;
}

.dl-fact-base { color: #475569; }

.dl-fact-derived {
  color: #0369a1;
  background: #f0f9ff;
}

.dl-violations {
  flex-shrink: 0;
  margin-bottom: 12px;
  border: 1px solid #fca5a5;
  border-radius: 4px;
  background: #fff1f2;
  padding: 8px;
}

.dl-violations-title { color: #b91c1c; }

.dl-violation { margin-bottom: 10px; }
.dl-violation:last-child { margin-bottom: 0; }

.dl-violation-constraint {
  font-weight: 600;
  color: #991b1b;
  margin-bottom: 4px;
}

.dl-witness {
  margin-bottom: 6px;
  padding-left: 8px;
  border-left: 2px solid #fca5a5;
}

.dl-witness-bindings {
  font-size: 11px;
  color: #7f1d1d;
  font-weight: 600;
  margin-bottom: 3px;
}

.dl-witness-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dl-trace-step {
  font-size: 11px;
  line-height: 1.6;
}

.dl-trace-fact-base { color: #374151; }
.dl-trace-fact-derived { color: #991b1b; }

.dl-trace-step-builtin {
  color: #6b7280;
  font-style: italic;
}

.dl-trace-tag {
  font-size: 10px;
  opacity: 0.65;
}

.dl-trace-derivation {
  margin-left: 14px;
  margin-top: 1px;
  padding-left: 8px;
  border-left: 1px solid #fca5a5;
}

.dl-trace-rule {
  font-size: 10px;
  color: #9f1239;
  font-style: italic;
  margin-bottom: 2px;
}

.dl-trace-premise-base {
  font-size: 11px;
  color: #374151;
  line-height: 1.6;
}

.dl-trace-premise-derived {
  font-size: 11px;
  color: #991b1b;
  line-height: 1.6;
}
`;

function injectStyles() {
  if (styleRefCount++ === 0) {
    styleElement = document.createElement('style');
    styleElement.textContent = STYLES;
    document.head.appendChild(styleElement);
  }
}

function removeStyles() {
  if (--styleRefCount === 0 && styleElement) {
    styleElement.remove();
    styleElement = null;
  }
}

// ─── Mount ────────────────────────────────────────────────────────────────────

export default function mount(element) {
  injectStyles();

  const ref = element.ref.as(schema);
  const data = from(ref);

  const [isEditing, setIsEditing] = createSignal(false);
  const [draftText, setDraftText] = createSignal('');

  const currentProgramText = () => {
    const d = data();
    if (!d) return '';
    const facts = serializeFacts(d.facts ?? []);
    const rules = serializeRules(d.rules ?? []);
    const constraints = serializeConstraints(d.constraints ?? []);
    return [facts, rules, constraints].filter(Boolean).join('\n\n');
  };

  const isDirty = () => isEditing() && draftText() !== currentProgramText();

  const parsed = createMemo(() => {
    if (!isEditing()) return { facts: [], rules: [], constraints: [], errors: [] };
    return parseProgram(draftText());
  });

  const evaluation = createMemo(() => {
    const d = data();
    const facts = isEditing() ? parsed().facts : (d?.facts ?? []);
    const rules = isEditing() ? parsed().rules : (d?.rules ?? []);
    const constraints = isEditing() ? parsed().constraints : (d?.constraints ?? []);
    const baseFactKeys = new Set(facts.map(factKey));
    let db = facts;
    let provenance = new Map();
    try {
      ({ db, provenance } = evaluateWithProvenance(facts, rules));
    } catch {
      db = facts;
    }
    return {
      derivedFacts: db,
      baseFacts: baseFactKeys,
      violations: checkConstraints(db, constraints, provenance, baseFactKeys),
    };
  });

  const grouped = createMemo(() => {
    const map = new Map();
    for (const f of evaluation().derivedFacts) {
      if (!map.has(f.pred)) map.set(f.pred, []);
      map.get(f.pred).push(f);
    }
    return Array.from(map.entries());
  });

  const parseErrors = createMemo(() => {
    if (!isEditing()) return [];
    return parsed().errors.map((e) => `Line ${e.line}: ${e.message}`);
  });

  function handleEdit() {
    setDraftText(currentProgramText());
    setIsEditing(true);
  }

  function handleSave() {
    const { facts, rules, constraints } = parseProgram(draftText());
    element.ref.change((d) => {
      d.facts = facts;
      d.rules = rules;
      d.constraints = constraints;
    });
    setIsEditing(false);
  }

  function handleCancel() {
    setIsEditing(false);
  }

  function onTextareaKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  }

  function formatAtom(atom) {
    if (atom.args.length === 0) return atom.pred;
    return `${atom.pred}(${atom.args.join(', ')})`;
  }

  const dispose = render(
    () =>
      html`<div
        class="dl-root"
        style=${{
          width: '100%',
          height: '100%',
        }}
        onPointerDown=${(e) => e.stopPropagation()}
      >
        <div class="dl-editor-col">
          <div class="dl-toolbar">
            ${() =>
              isEditing()
                ? html`<span>
                    ${() => (isDirty() ? html`<span class="dl-dirty-badge">● Unsaved</span>` : '')}
                    <button class="dl-btn dl-btn-primary" onClick=${handleSave}>Save</button>
                    <button class="dl-btn" onClick=${handleCancel}>Cancel</button>
                  </span>`
                : html`<button class="dl-btn" onClick=${handleEdit}>Edit</button>`}
          </div>

          <div class="dl-editor-wrap">
            ${() =>
              isEditing()
                ? html`<textarea
                    class="dl-editor-textarea"
                    value=${draftText()}
                    onInput=${(e) => setDraftText(e.target.value)}
                    onKeyDown=${onTextareaKeyDown}
                    spellcheck=${false}
                  />`
                : html`<div class="dl-program-view">
                    <${For} each=${() => data()?.facts ?? []}>${(f) =>
                      html`<div class="dl-program-item">${() => serializeFact(f)}</div>`
                    }</>
                    ${() =>
                      (data()?.facts?.length ?? 0) > 0 &&
                      ((data()?.rules?.length ?? 0) > 0 || (data()?.constraints?.length ?? 0) > 0)
                        ? html`<div class="dl-program-separator" />`
                        : ''}
                    <${For} each=${() => data()?.rules ?? []}>${(r) =>
                      html`<div class="dl-program-item">${() => serializeRule(r)}</div>`
                    }</>
                    ${() =>
                      (data()?.rules?.length ?? 0) > 0 && (data()?.constraints?.length ?? 0) > 0
                        ? html`<div class="dl-program-separator" />`
                        : ''}
                    <${For} each=${() => data()?.constraints ?? []}>${(c) =>
                      html`<div class="dl-program-item">${() => serializeConstraint(c)}</div>`
                    }</>
                  </div>`}
          </div>

          ${() =>
            parseErrors().length > 0
              ? html`<ul class="dl-errors">
                  <${For} each=${parseErrors}>${(msg) =>
                    html`<li>${msg}</li>`
                  }</>
                </ul>`
              : ''}
        </div>

        <div class="dl-derived">
          ${() =>
            evaluation().violations.length > 0
              ? html`<div class="dl-violations">
                  <h2 class="dl-section-title dl-violations-title">Constraint Violations</h2>
                  <${For} each=${() => evaluation().violations}>${(v) =>
                    html`<div class="dl-violation">
                      <div class="dl-violation-constraint">
                        ${() => ':- ' + v.constraint.body.map(formatAtom).join(', ') + '.'}
                      </div>
                      <${For} each=${() => v.witnesses}>${(w) =>
                        html`<div class="dl-witness">
                          ${() => {
                            const summary = Object.entries(w.bindings)
                              .map(([k, v]) => k + '=' + v)
                              .join(', ');
                            return summary
                              ? html`<div class="dl-witness-bindings">${summary}</div>`
                              : '';
                          }}
                          <div class="dl-witness-steps">
                            <${For} each=${() => w.steps}>${(step) =>
                              html`<div class="dl-trace-step ${() =>
                                step.kind === 'builtin' ? 'dl-trace-step-builtin' : ''}">
                                ${() =>
                                  step.kind === 'builtin'
                                    ? html`<span>
                                        ${step.atom.pred}(${step.resolvedArgs.join(', ')})
                                        <span class="dl-trace-tag"> [builtin]</span>
                                      </span>`
                                    : html`<div>
                                        <div class="${() =>
                                          step.isBase
                                            ? 'dl-trace-fact-base'
                                            : 'dl-trace-fact-derived'}">
                                          ${() => factKey(step.fact)}
                                          <span class="dl-trace-tag">
                                            ${() => ' [' + (step.isBase ? 'base' : 'derived') + ']'}
                                          </span>
                                        </div>
                                        ${() =>
                                          !step.isBase && step.derivedBy
                                            ? html`<div class="dl-trace-derivation">
                                                <div class="dl-trace-rule">
                                                  via ${() => ruleKey(step.derivedBy.rule)}
                                                </div>
                                                <${For} each=${() =>
                                                  step.derivedBy.groundBody}>${(pf) =>
                                                  html`<div class="${() =>
                                                    evaluation().baseFacts.has(factKey(pf))
                                                      ? 'dl-trace-premise-base'
                                                      : 'dl-trace-premise-derived'}">
                                                    ${() => factKey(pf)}
                                                    <span class="dl-trace-tag">
                                                      ${() =>
                                                        ' [' +
                                                        (evaluation().baseFacts.has(factKey(pf))
                                                          ? 'base'
                                                          : 'derived') +
                                                        ']'}
                                                    </span>
                                                  </div>`
                                                }</>
                                              </div>`
                                            : ''}
                                      </div>`}
                              </div>`
                            }</>
                          </div>
                        </div>`
                      }</>
                    </div>`
                  }</>
                </div>`
              : ''}

          <h2 class="dl-section-title">Derived Facts</h2>
          <div class="dl-derived-scroll">
            ${() =>
              grouped().length === 0
                ? html`<p class="dl-empty">No facts derived.</p>`
                : html`<${For} each=${grouped}>${(entry) => {
                    const pred = entry[0];
                    const facts = entry[1];
                    return html`<div class="dl-pred-group">
                      <div class="dl-pred-name">${pred}</div>
                      <${For} each=${() => facts}>${(f) => {
                        const key = factKey(f);
                        const isBase = evaluation().baseFacts.has(key);
                        return html`<div
                          class=${() =>
                            'dl-fact ' + (isBase ? 'dl-fact-base' : 'dl-fact-derived')}
                        >
                          ${key}
                        </div>`;
                      }}</>
                    </div>`;
                  }}</>`}
          </div>
        </div>
      </div>`,
    element,
  );

  return () => {
    removeStyles();
    dispose();
  };
}
