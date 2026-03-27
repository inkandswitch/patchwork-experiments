import type { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { toolify } from './react-util';
import type { PyonpyonDoc } from './types';
import './styles.css';

const DIV_COUNT = 20;

export const PyonpyonEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc] = useDocument<PyonpyonDoc>(docUrl, { suspense: true });
  const title = doc.title?.trim() || 'Pyonpyon';

  return (
    <div className="p-4 h-full overflow-auto bg-base-100">
      <div className="flex flex-col gap-1 max-w-prose">
        {Array.from({ length: DIV_COUNT }, (_, i) => (
          <div key={i} className="text-sm border border-base-300 rounded px-2 py-1">
            {title}
          </div>
        ))}
      </div>
    </div>
  );
};

export const renderPyonpyonEditor = toolify(PyonpyonEditor);
