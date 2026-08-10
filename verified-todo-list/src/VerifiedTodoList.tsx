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
import { createRoot } from 'react-dom/client';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import type { ToolElement, ToolImplementation } from '@inkandswitch/patchwork-plugins';
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
    <div className="vtl">
      <div className="vtl__column">
        <div className="vtl__frame">
          <div className="vtl__sheet">
            <header className="vtl__header">
              <div className="vtl__heading">
                <div className="vtl__eyebrow">
                  <Lock size={10} strokeWidth={2.5} />
                  <span>Verified</span>
                  <span className="vtl__rule" />
                </div>
                <input
                  type="text"
                  value={doc?.title ?? ''}
                  className="vtl__title"
                  onChange={(e) => setTitle(handle, e.target.value)}
                  placeholder="Untitled"
                />
                <p className="vtl__note">
                  State transitions are proven non-duplicating in Dafny — see{' '}
                  <code className="vtl__code">
                    dafny/TodoDomain.dfy
                  </code>
                  .
                </p>
              </div>
              <ShieldBadge completed={completed} total={total} />
            </header>

            <VerifiedPropertiesPanel />

            <form onSubmit={onSubmit} className="vtl__compose">
              <input
                type="text"
                className="vtl__input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Add a new todo"
              />
              <button
                type="submit"
                disabled={!text.trim()}
                className="vtl__add"
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
  <div className="vtl-props">
    <div className="vtl-props__head">
      <Lock size={10} strokeWidth={2.5} />
      <span>Verified properties</span>
      <span className="vtl-props__rule" />
      <Lock size={10} strokeWidth={2.5} />
    </div>
    <ul className="vtl-props__list">
      {VERIFIED_PROPERTIES.map((p) => (
        <li key={p}>
          <span className="vtl-props__tick">
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
    className="vtl-shield"
    title="Verified in Dafny"
  >
    <ShieldCheck size={18} strokeWidth={2.25} />
    <span className="vtl-shield__count">
      {completed}/{total}
    </span>
  </div>
);

const EmptyState = () => (
  <div className="vtl-empty">
    <div className="vtl-empty__mark">
      <Check size={18} strokeWidth={2.5} />
    </div>
    <p>No todos yet. Add one above.</p>
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
        <ul className="vtl-list">
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
      className="vtl-row"
      data-done={done || undefined}
      data-dragging={isDragging || undefined}
    >
      <span
        {...attributes}
        {...listeners}
        className="vtl-row__grip"
        aria-label="Drag to reorder"
        title="Drag to reorder"
      >
        <GripVertical size={16} />
      </span>
      <label className="vtl-check">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => onToggle(visible.key, e.target.checked)}
          className="vtl-check__input"
        />
        <span className="vtl-check__box">
          {done && <Check size={12} strokeWidth={3.5} />}
        </span>
      </label>
      <span className="vtl-row__text">
        {visible.item.text}
      </span>
      <button
        onClick={() => onDelete(visible.key)}
        className="vtl-row__delete"
        aria-label="Delete"
        title="Delete"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
};

export function renderVerifiedTodoListEditor(
  handle: { url: AutomergeUrl },
  element: ToolElement
): ReturnType<ToolImplementation> {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <VerifiedTodoListEditor docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
}
