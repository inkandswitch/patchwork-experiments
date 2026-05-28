import { render } from 'solid-js/web';
import { createSignal, For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import type { MapDeleteBugDoc } from './types';

/**
 * Minimal repro: deleting a key from a Record<string, …> map property triggers
 *   RangeError: index is not a number for patch
 * inside `automerge-repo-solid-primitives` (via the upstream
 * `@automerge/automerge` `applyPatches`) because its `applyDelPatch` only
 * handles list/text deletions and assumes the prop is numeric.
 */
export const MapDeleteBugTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <MapDeleteBugView url={(handle as DocHandle<MapDeleteBugDoc>).url} />
      </RepoContext.Provider>
    ),
    element,
  );
  return () => dispose();
};

function MapDeleteBugView(props: { url: AutomergeUrl }) {
  const [doc, handle] = useDocument<MapDeleteBugDoc>(() => props.url);
  const [newLabel, setNewLabel] = createSignal('');

  const addItem = () => {
    const label = newLabel().trim() || `Item ${Object.keys(doc()?.items ?? {}).length + 1}`;
    const id = crypto.randomUUID();
    handle()?.change((d) => {
      d.items[id] = { id, label };
    });
    setNewLabel('');
  };

  const deleteItem = (id: string) => {
    handle()?.change((d) => {
      delete d.items[id];
    });
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h2 style={titleStyle}>Solid map-delete bug repro</h2>
        <p style={blurbStyle}>
          Click <strong>Delete</strong> on any row. The automerge `del` patch has a string
          prop (the item id), which crashes the upstream Solid primitives applyPatches with
          <code style={codeStyle}> RangeError: index is not a number for patch</code>.
          Open the devtools console to see the full stack trace.
        </p>

        <div style={addRowStyle}>
          <input
            type="text"
            value={newLabel()}
            placeholder="New item label"
            onInput={(e) => setNewLabel(e.currentTarget.value)}
            style={inputStyle}
          />
          <button onClick={addItem} style={primaryButtonStyle}>
            Add item
          </button>
        </div>

        <Show
          when={doc()}
          fallback={<div style={emptyStyle}>Loading document…</div>}
        >
          {(currentDoc) => {
            const entries = () => Object.entries(currentDoc().items ?? {});
            return (
              <Show
                when={entries().length > 0}
                fallback={<div style={emptyStyle}>No items.</div>}
              >
                <ul style={listStyle}>
                  <For each={entries()}>
                    {([id, item]) => (
                      <li style={rowStyle}>
                        <span style={idStyle}>{id}</span>
                        <span style={labelStyle}>{item.label}</span>
                        <button onClick={() => deleteItem(id)} style={dangerButtonStyle}>
                          Delete
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            );
          }}
        </Show>
      </div>
    </div>
  );
}

const containerStyle =
  'padding:24px;height:100%;overflow:auto;font-family:system-ui,-apple-system,sans-serif;box-sizing:border-box;background:#f8fafc;';

const cardStyle =
  'max-width:640px;margin:0 auto;background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:16px;';

const titleStyle = 'font-size:20px;font-weight:600;margin:0;color:#0f172a;';

const blurbStyle = 'font-size:13px;color:#475569;margin:0;line-height:1.5;';

const codeStyle =
  'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f5f9;padding:1px 4px;border-radius:4px;font-size:12px;';

const addRowStyle = 'display:flex;gap:8px;';

const inputStyle =
  'flex:1;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px;';

const primaryButtonStyle =
  'padding:8px 16px;background:#2563eb;color:white;border:none;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;';

const dangerButtonStyle =
  'padding:6px 12px;background:#dc2626;color:white;border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer;';

const listStyle = 'list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;';

const rowStyle =
  'display:flex;align-items:center;gap:12px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;';

const idStyle =
  'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#64748b;flex:0 0 auto;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

const labelStyle = 'flex:1;color:#0f172a;font-size:14px;';

const emptyStyle = 'color:#94a3b8;font-size:13px;text-align:center;padding:16px;';
