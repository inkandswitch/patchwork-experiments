import type {FileDoc} from "../types"
import {isImmutableStringFileDoc} from "../datatype"

export function LongTextFileViewer(props: {doc: FileDoc}) {
	if (!props.doc || !isImmutableStringFileDoc(props.doc)) {
		return null
	}

	return (
		<div class="p-4">
			<div class="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
				This file is too large to edit directly. It is displayed in read-only
				mode.
			</div>
			<pre class="font-mono text-sm whitespace-pre-wrap break-words">
				{props.doc.content.toString()}
			</pre>
		</div>
	)
}
