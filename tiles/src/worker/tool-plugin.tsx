import { createRoot } from 'react-dom/client';
import type { ToolImplementation } from '@inkandswitch/patchwork-plugins';
import { RepoContext } from '@automerge/react';
import { WorkerInner } from './components/WorkerUI.tsx';

export const workerToolImpl: ToolImplementation = (handle, element) => {
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
        <WorkerInner workerDocUrl={handle.url} />
      </div>
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
