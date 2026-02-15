import {Show, Match, Switch} from "solid-js"
import {useDocHandle} from "@automerge/automerge-repo-solid-primitives"
import type {FileDoc} from "../types"
import {isImmutableStringFileDoc} from "../datatype"
import {isImageFile} from "../utils"
import {HTMLFileViewer, isHTMLFile} from "./HTMLFileViewer"
import {ImageFileViewer} from "./ImageFileViewer"
import {PDFFileViewer, isPDFFile} from "./PDFFileViewer"
import {TextFileEditor, isTextFile} from "./TextFileEditor"
import {LongTextFileViewer} from "./LongTextFileViewer"
import {LONG_TEXT_FILE_LENGTH_THRESHOLD} from "../types"
import {DocHandle} from "@automerge/automerge-repo"
import {UnixFileEntry} from "@inkandswitch/patchwork-filesystem"
import {PatchworkViewElement} from "@inkandswitch/patchwork-elements"

export function FileEditor(props: {
	handle: DocHandle<UnixFileEntry>
	element: PatchworkViewElement
}) {
	const handle = useDocHandle<FileDoc>(props.handle.url, props.element)
	const doc = () => handle.latest?.doc()

	return (
		<Show when={doc()} fallback={"Loading..."}>
			<Switch
				fallback={
					<div>
						No preview available for this file type
						<table>
							<tbody>
								<tr>
									<td>mimeType</td>
									<td>{doc()?.mimeType}</td>
								</tr>
							</tbody>
						</table>
					</div>
				}>
				<Match when={isHTMLFile(doc()!)}>
					<HTMLFileViewer doc={doc()!} />
				</Match>
				<Match
					when={
						isTextFile(doc()!) &&
						!isImmutableStringFileDoc(doc()!) &&
						// @ts-expect-error typescript doesn't know we've narrowed, because it is a function
						doc()!.content.length <= LONG_TEXT_FILE_LENGTH_THRESHOLD
					}>
					<TextFileEditor doc={doc()!} handle={props.handle} />
				</Match>
				<Match
					when={
						isTextFile(doc()!) &&
						(isImmutableStringFileDoc(doc()!) ||
							// @ts-expect-error typescript doesn't know we've narrowed, because it is a function
							doc()!.content.length > LONG_TEXT_FILE_LENGTH_THRESHOLD)
					}>
					<LongTextFileViewer doc={doc()!} />
				</Match>
				<Match when={isImageFile(doc()!)}>
					<ImageFileViewer doc={doc()!} />
				</Match>
				<Match when={isPDFFile(doc()!)}>
					<PDFFileViewer doc={doc()!} />
				</Match>
			</Switch>
		</Show>
	)
}
