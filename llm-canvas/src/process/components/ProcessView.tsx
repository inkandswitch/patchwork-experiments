import { useState } from 'react';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import type { AutomergeUrl } from '@automerge/automerge-repo';
import Markdown from 'react-markdown';
import type { ProcessDoc, OutputBlock } from '../types';

export function ProcessView({
  processUrl,
  isActive = false,
}: {
  processUrl: AutomergeUrl;
  isActive?: boolean;
}) {
  const [doc] = useDocument<ProcessDoc>(processUrl, { suspense: true });

  if (!doc) return null;

  const output = doc.output ?? [];

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          padding: '6px 10px',
          background: '#f0f0f0',
          borderRadius: 6,
          fontSize: 12,
          color: '#333',
          whiteSpace: 'pre-wrap',
        }}
      >
        {doc.prompt}
      </div>

      <div style={{ paddingLeft: 4, marginTop: 4 }}>
        {output.map((block, bIdx) => {
          if (block.type === 'text') {
            return (
              <div key={bIdx} style={{ fontSize: 12, color: '#444', lineHeight: 1.5 }}>
                <Markdown>{block.content}</Markdown>
              </div>
            );
          }
          if (block.type === 'script') {
            return <ScriptBlockView key={bIdx} block={block} />;
          }
          return null;
        })}

        {isActive && output.length === 0 && (
          <div style={{ fontSize: 11, color: '#aaa', padding: '4px 0' }}>Thinking...</div>
        )}
      </div>
    </div>
  );
}

function ScriptBlockView({ block }: { block: Extract<OutputBlock, { type: 'script' }> }) {
  const hasCompleted = block.output !== undefined;
  const hasError = !!block.error;
  const [collapsed, setCollapsed] = useState(hasCompleted);

  const label = block.description || 'Code';

  return (
    <div style={{ margin: '4px 0' }}>
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '2px 0',
          fontSize: 11,
          color: '#888',
        }}
        onClick={() => setCollapsed(!collapsed)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span style={{ fontSize: 9, transform: collapsed ? 'none' : 'rotate(90deg)', transition: 'transform 0.15s' }}>▶</span>
        {label}
        {hasCompleted && !hasError && <span style={{ fontSize: 9, color: '#4caf50' }}>✓</span>}
        {hasError && <span style={{ fontSize: 9, color: '#c33' }}>✗</span>}
        {!hasCompleted && <span style={{ fontSize: 9, color: '#aaa' }}>⋯</span>}
      </button>

      {!collapsed && (
        <div style={{ marginLeft: 14, borderLeft: '1px solid #eee', paddingLeft: 8, marginTop: 2 }}>
          <pre
            style={{
              fontSize: 10,
              fontFamily: 'monospace',
              color: '#666',
              whiteSpace: 'pre-wrap',
              maxHeight: 200,
              overflow: 'auto',
              margin: 0,
            }}
          >
            {block.code}
          </pre>

          {(block.output || block.error) && (
            <div
              style={{
                fontSize: 10,
                fontFamily: 'monospace',
                marginTop: 4,
                paddingTop: 4,
                borderTop: '1px solid #f0f0f0',
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {block.output && <pre style={{ margin: 0, color: '#888', whiteSpace: 'pre-wrap' }}>{block.output}</pre>}
              {block.error && <pre style={{ margin: 0, color: '#c33', whiteSpace: 'pre-wrap' }}>{block.error}</pre>}
            </div>
          )}

          {hasCompleted && !block.output && !block.error && (
            <div style={{ fontSize: 10, color: '#ccc', fontStyle: 'italic', marginTop: 2 }}>No output</div>
          )}
        </div>
      )}
    </div>
  );
}
