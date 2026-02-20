import "solid-js"

declare module "solid-js" {
	namespace JSX {
		interface IntrinsicElements {
			"patchwork-view": {
				"doc-url"?: string
				"tool-id"?: string
				class?: string
				style?: string | Record<string, string>
			}
		}
		interface CustomEvents {
			click: MouseEvent
			input: InputEvent
			keydown: KeyboardEvent
			scroll: Event
			paste: ClipboardEvent
			change: Event
			blur: FocusEvent
			dragenter: DragEvent
			dragleave: DragEvent
			dragover: DragEvent
			drop: DragEvent
			pointerdown: PointerEvent
		}
	}
}
