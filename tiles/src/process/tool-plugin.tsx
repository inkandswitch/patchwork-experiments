import { createRoot } from 'react-dom/client';
import type { ToolImplementation } from '@inkandswitch/patchwork-plugins';
import { RepoContext } from '@automerge/react';
import { ProcessView } from './components/ProcessView.tsx';

export const processToolImpl: ToolImplementation = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          fontFamily: 'sans-serif',
          fontSize: 12,
          padding: 8,
        }}
      >
        <ProcessView processUrl={handle.url} />
      </div>
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};
