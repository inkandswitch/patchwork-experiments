import { Show } from "solid-js"
import { EditIcon, DeleteIcon, AddIcon, CopyIcon, OkIcon, CancelIcon } from "./Icons"

export function EditActionButtons(props: {
  canEdit: boolean
  canDelete: boolean
  canAdd: boolean
  canCopy: boolean
  onEdit?: () => void
  onDelete?: () => void
  onAdd?: () => void
  onCopy?: () => void
}) {
  return (
    <div class="te-edit-buttons">
      <Show when={props.canEdit && props.onEdit}>
        <span
          class="te-icon te-icon-edit"
          title="Edit"
          onClick={(e) => {
            e.stopPropagation()
            props.onEdit!()
          }}
        >
          <EditIcon />
        </span>
      </Show>
      <Show when={props.canAdd && props.onAdd}>
        <span
          class="te-icon te-icon-add"
          title="Add"
          onClick={(e) => {
            e.stopPropagation()
            props.onAdd!()
          }}
        >
          <AddIcon />
        </span>
      </Show>
      <Show when={props.canDelete && props.onDelete}>
        <span
          class="te-icon te-icon-delete"
          title="Delete"
          onClick={(e) => {
            e.stopPropagation()
            props.onDelete!()
          }}
        >
          <DeleteIcon />
        </span>
      </Show>
      <Show when={props.canCopy && props.onCopy}>
        <span
          class="te-icon te-icon-copy"
          title="Copy"
          onClick={(e) => {
            e.stopPropagation()
            props.onCopy!()
          }}
        >
          <CopyIcon />
        </span>
      </Show>
    </div>
  )
}

export function ConfirmButtons(props: {
  onOk: () => void
  onCancel: () => void
}) {
  return (
    <div class="te-confirm-buttons">
      <span
        class="te-icon te-icon-ok"
        title="Confirm"
        onClick={(e) => {
          e.stopPropagation()
          props.onOk()
        }}
      >
        <OkIcon />
      </span>
      <span
        class="te-icon te-icon-cancel"
        title="Cancel"
        onClick={(e) => {
          e.stopPropagation()
          props.onCancel()
        }}
      >
        <CancelIcon />
      </span>
    </div>
  )
}
