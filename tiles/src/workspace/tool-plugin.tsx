import { createRoot } from 'react-dom/client';
import type { ToolImplementation } from '@inkandswitch/patchwork-plugins';
import { RepoContext } from '@automerge/react';
import { WorkspaceUI } from './components/WorkspaceUI.tsx';

export const workspaceToolImpl: ToolImplementation = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'sans-serif',
          fontSize: 12,
        }}
      >
        <WorkspaceUI docUrl={handle.url} />
      </div>
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
