// Engine worker: loads pandoc.wasm and runs conversions off the main thread
// so the UI never blocks while pandoc works.

import {loadPandoc} from "./wasm-load"

type ConvertRequest = {
	id: number
	type: "convert"
	options: Record<string, unknown>
	stdin: string | null
	files: Record<string, Blob | string>
}

const pandocPromise = loadPandoc(progress =>
	postMessage({type: "progress", progress})
)

pandocPromise
	.then(({info}) => postMessage({type: "ready", info}))
	.catch(err =>
		postMessage({
			type: "init-error",
			error: String((err as Error)?.message ?? err),
		})
	)

self.onmessage = async (event: MessageEvent<ConvertRequest>) => {
	const msg = event.data
	if (msg?.type !== "convert") return
	try {
		const {instance} = await pandocPromise
		const value = await instance.convert(msg.options, msg.stdin, msg.files)
		postMessage({type: "result", id: msg.id, ok: true, value})
	} catch (err) {
		postMessage({
			type: "result",
			id: msg.id,
			ok: false,
			error: String((err as Error)?.message ?? err),
		})
	}
}
