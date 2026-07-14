import { Show } from "solid-js";

export type ContextMenuState = {
  x: number;
  y: number;
  bulletId: string;
  parentId: string;
  childIndex: number;
} | null;

export function ContextMenu(props: {
  state: ContextMenuState;
  isCompleted: (id: string) => boolean;
  onDelete: (id: string, parentId: string, childIndex: number) => void;
  onComplete: (id: string) => void;
  onCopyBullet: (id: string) => void;
  onCopyLink: (id: string) => void;
  onCopyAsMirror: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Show when={props.state}>
      {(menu) => (
        <div
          class="bullets-context-menu"
          style={{
            left: `${menu().x}px`,
            top: `${menu().y}px`,
          }}
        >
          <button
            class="bullets-context-menu-item"
            onClick={() => {
              props.onComplete(menu().bulletId);
              props.onClose();
            }}
          >
            {props.isCompleted(menu().bulletId) ? "Uncomplete" : "Complete"}
          </button>
          <button
            class="bullets-context-menu-item"
            onClick={() => {
              props.onDelete(menu().bulletId, menu().parentId, menu().childIndex);
              props.onClose();
            }}
          >
            Delete
          </button>
          {/* DISABLED: mirroring feature temporarily disabled, will be re-enabled later
          <button
            class="bullets-context-menu-item"
            onClick={() => {
              const id = menu().bulletId;
              props.onCopyAsMirror(id);
              props.onClose();
              // Re-focus the bullet so Cmd+V has a target context
              requestAnimationFrame(() => {
                const row = document.querySelector(`.bullet-row[data-bullet-id="${id}"]`);
                const content = row?.querySelector(".bullet-content") as HTMLElement | null;
                if (content) content.focus();
              });
            }}
          >
            Copy as mirror
          </button>
          */}
          <button
            class="bullets-context-menu-item"
            onClick={() => {
              props.onCopyBullet(menu().bulletId);
              props.onClose();
            }}
          >
            Copy bullet
          </button>
          <button
            class="bullets-context-menu-item"
            onClick={() => {
              props.onCopyLink(menu().bulletId);
              props.onClose();
            }}
          >
            Copy link
          </button>
        </div>
      )}
    </Show>
  );
}
