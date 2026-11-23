import {For, Show} from "solid-js"
import {chainOf, definitionOf, labelOf, type SourceMap, type SourceSite, type ModuleDef} from "../render/sourceMap"

/** A place in a source to show: a call site or a module definition. */
export type SourcePlace = Pick<SourceSite, "file" | "from" | "to" | "line" | "col">

/**
 * The selected part's chain of calls, outermost first, the shape last: each a
 * button that shows its call in the code. The innermost of the model's own
 * modules is the part's label (in bold), with a link to where that module is
 * defined. A library's calls name their file and can't be shown here.
 */
export function SourceTrail(props: {map: SourceMap; record: number; onReveal(place: SourcePlace): void; onClose(): void}) {
	const chain = () => chainOf(props.map, props.record)
	const labelled = () => [...chain()].reverse().find(s => s.kind === "call")
	const definition = (): ModuleDef | undefined => {
		const site = labelled()
		return site ? definitionOf(props.map, site.name, site.file) : undefined
	}
	const where = (p: {file: string; line: number}) => (p.file ? `${p.file}:${p.line}` : `${p.line}`)
	return (
		<div class="openscad-trail" role="toolbar" aria-label={`Source of ${labelOf(props.map, props.record)}`}>
			<For each={chain()}>
				{(site, i) => (
					<>
						<Show when={i() > 0}>
							<span class="openscad-trail-sep" aria-hidden="true">
								›
							</span>
						</Show>
						<button
							class="openscad-trail-step"
							classList={{"is-label": site === labelled(), "is-shape": site.kind === "shape"}}
							disabled={site.file !== ""}
							title={site.file ? `In the library ${site.file}, line ${site.line}` : `Show this call (line ${site.line})`}
							onClick={() => props.onReveal(site)}
						>
							<span class="openscad-trail-name">{site.name}</span>
							<span class="openscad-trail-line">{where(site)}</span>
						</button>
					</>
				)}
			</For>
			<Show when={definition()}>
				{def => (
					<button
						class="openscad-trail-def"
						disabled={def().file !== ""}
						title={def().file ? `Defined in the library ${def().file}, line ${def().line}` : `Show where ${def().name} is defined (line ${def().line})`}
						onClick={() => props.onReveal(def())}
					>
						module {def().name} ↗
					</button>
				)}
			</Show>
			<button class="openscad-trail-close" title="Clear the selection (Esc)" aria-label="Clear the selection" onClick={() => props.onClose()}>
				×
			</button>
		</div>
	)
}
