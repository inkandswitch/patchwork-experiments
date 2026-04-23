import { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocHandle, useDocument } from '@automerge/automerge-repo-react-hooks';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, Lock, ShieldCheck, Trash2 } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import {
  addTodo,
  deleteTodo,
  midpointPosition,
  moveTodo,
  setTitle,
  toggleTodo,
  visibleItems,
  type VerifiedTodoDoc,
  type Visible,
} from './bridge';
import { toolify } from './react-util';
import './styles.css';

export const VerifiedTodoListEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc] = useDocument<VerifiedTodoDoc>(docUrl, { suspense: true });
  const handle = useDocHandle<VerifiedTodoDoc>(docUrl, { suspense: true });
  const [text, setText] = useState('');

  const visible: Visible[] = useMemo(() => (doc ? visibleItems(doc) : []), [doc]);

  const onSubmit: React.FormEventHandler = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    addTodo(handle, trimmed);
    setText('');
  };

  const onReorder = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const reordered = arrayMove(visible, fromIdx, toIdx);
    const movedKey = reordered[toIdx].key;
    const before = reordered[toIdx - 1]?.item.position;
    const after = reordered[toIdx + 1]?.item.position;
    const newPos = midpointPosition(before, after);
    moveTodo(handle, movedKey, newPos);
  };

  const completed = visible.filter((v) => v.item.done).length;
  const total = visible.length;

  return (
    <div className="p-4 sm:p-6 h-full overflow-auto bg-linear-to-b from-emerald-50/40 to-transparent dark:from-emerald-950/20 dark:to-transparent">
      <div className="max-w-[520px] mx-auto">
        <div className="rounded-2xl p-[1px] bg-linear-to-br from-emerald-400/60 via-emerald-300/20 to-emerald-500/50 shadow-lg shadow-emerald-500/5">
          <div className="rounded-2xl bg-base-100 dark:bg-base-300 p-5 sm:p-6 flex flex-col gap-4">
            <header className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-[0.65rem] font-semibold uppercase tracking-[0.25em] mb-1">
                  <Lock size={10} strokeWidth={2.5} />
                  <span>Verified</span>
                  <span className="inline-block h-px w-6 bg-emerald-400/40" />
                </div>
                <input
                  type="text"
                  value={doc?.title ?? ''}
                  className="w-full bg-transparent outline-none text-2xl font-bold tracking-tight placeholder:text-gray-400"
                  onChange={(e) => setTitle(handle, e.target.value)}
                  placeholder="Untitled"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  State transitions are proven non-duplicating in Dafny — see{' '}
                  <code className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[0.72rem] text-emerald-700 dark:text-emerald-300">
                    dafny/TodoDomain.dfy
                  </code>
                  .
                </p>
              </div>
              <ShieldBadge completed={completed} total={total} />
            </header>

            <VerifiedPropertiesPanel />

            <form onSubmit={onSubmit} className="flex gap-2">
              <input
                type="text"
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/60 dark:bg-base-200/60 px-3 py-2 text-sm outline-none transition-[box-shadow,border-color] focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 placeholder:text-gray-400"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add a new todo"
              />
              <button
                type="submit"
                disabled={!text.trim()}
                className="rounded-lg bg-linear-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-600 disabled:from-gray-300 disabled:to-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-medium px-4 shadow-sm shadow-emerald-500/30 transition-colors"
              >
                Add
              </button>
            </form>

            {total > 0 ? (
              <TodoList
                items={visible}
                onToggle={(key, done) => toggleTodo(handle, key, done)}
                onDelete={(key) => deleteTodo(handle, key)}
                onReorder={onReorder}
              />
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const VerifiedPropertiesPanel = () => (
  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] dark:bg-emerald-400/5 p-3.5">
    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-[0.6rem] font-semibold uppercase tracking-[0.22em] mb-2">
      <Lock size={10} strokeWidth={2.5} />
      <span>Verified properties</span>
      <span className="flex-1 h-px bg-emerald-400/25" />
      <Lock size={10} strokeWidth={2.5} />
    </div>
    <ul className="grid gap-1.5 text-[0.82rem] text-emerald-950/90 dark:text-emerald-100/90">
      {VERIFIED_PROPERTIES.map((p) => (
        <li key={p} className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex h-[1.1rem] w-[1.1rem] items-center justify-center rounded-full bg-linear-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-500/40 shrink-0">
            <Check size={11} strokeWidth={3} />
          </span>
          <span>{p}</span>
        </li>
      ))}
    </ul>
  </div>
);

const VERIFIED_PROPERTIES = [
  'Visible todos contain no duplicates.',
  'Add inserts exactly one fresh id.',
  'Move, toggle, and delete keep the keyset unchanged.',
  'Delete hides items from the view without removing keys.',
];

const ShieldBadge = ({ completed, total }: { completed: number; total: number }) => (
  <div
    className="shrink-0 flex flex-col items-center gap-0.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-emerald-700 dark:text-emerald-300"
    title="Verified in Dafny"
  >
    <ShieldCheck size={18} strokeWidth={2.25} />
    <span className="text-[0.6rem] font-mono tabular-nums">
      {completed}/{total}
    </span>
  </div>
);

const EmptyState = () => (
  <div className="flex flex-col items-center gap-2 py-8 text-gray-400 dark:text-gray-500">
    <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-500">
      <Check size={18} strokeWidth={2.5} />
    </div>
    <p className="text-sm">No todos yet. Add one above.</p>
  </div>
);

type TodoListProps = {
  items: Visible[];
  onToggle: (key: string, done: boolean) => void;
  onDelete: (key: string) => void;
  onReorder: (fromIdx: number, toIdx: number) => void;
};

const TodoList = ({ items, onToggle, onDelete, onReorder }: TodoListProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const ids = items.map((v) => v.key);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(from, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-col rounded-xl border border-gray-200 dark:border-gray-700/70 divide-y divide-gray-100 dark:divide-gray-700/50 overflow-hidden">
          {items.map((v) => (
            <TodoRow key={v.key} visible={v} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
};

type TodoRowProps = {
  visible: Visible;
  onToggle: (key: string, done: boolean) => void;
  onDelete: (key: string) => void;
};

const TodoRow = ({ visible, onToggle, onDelete }: TodoRowProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: visible.key });
  const done = visible.item.done;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={
        'group flex gap-2 items-center pl-1.5 pr-2 py-2 bg-base-100 dark:bg-base-200/30 hover:bg-emerald-50/40 dark:hover:bg-emerald-400/5 transition-colors' +
        (isDragging ? ' shadow-lg shadow-emerald-500/10 rounded-lg' : '')
      }
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400 touch-none"
        aria-label="Drag to reorder"
        title="Drag to reorder"
      >
        <GripVertical size={16} />
      </span>
      <label className="relative inline-flex items-center shrink-0 cursor-pointer">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => onToggle(visible.key, e.target.checked)}
          className="peer sr-only"
        />
        <span
          className={
            'inline-flex h-[18px] w-[18px] items-center justify-center rounded-md border transition-all ' +
            (done
              ? 'bg-linear-to-br from-emerald-400 to-emerald-600 border-emerald-600 text-white shadow-sm shadow-emerald-500/40'
              : 'bg-white dark:bg-base-300 border-gray-300 dark:border-gray-600 peer-hover:border-emerald-400')
          }
        >
          {done && <Check size={12} strokeWidth={3.5} />}
        </span>
      </label>
      <span
        className={
          'flex-1 text-sm ' +
          (done
            ? 'line-through text-gray-400 dark:text-gray-500'
            : 'text-gray-800 dark:text-gray-100')
        }
      >
        {visible.item.text}
      </span>
      <button
        onClick={() => onDelete(visible.key)}
        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity p-1 rounded hover:bg-red-500/10"
        aria-label="Delete"
        title="Delete"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
};

export const renderVerifiedTodoListEditor = toolify(VerifiedTodoListEditor);
