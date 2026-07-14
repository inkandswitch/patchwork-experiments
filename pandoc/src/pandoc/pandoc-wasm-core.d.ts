// Type shim for the aliased pandoc-wasm internal module (see vite.config.ts).
declare module "pandoc-wasm-core" {
	export type PandocConvertResult = {
		stdout: string
		stderr: string
		warnings: {verbosity?: string; pretty?: string; message?: string}[]
		files: Record<string, Blob | string>
		mediaFiles: Record<string, Blob>
	}

	export type RawPandocInstance = {
		convert(
			options: Record<string, unknown>,
			stdin: string | null,
			files: Record<string, Blob | string>
		): Promise<PandocConvertResult>
		query(options: {query: string; format?: string}): unknown
		pandoc(
			args: string,
			input: string | Blob,
			resources?: {filename: string; contents: string | Blob}[]
		): Promise<{out: string | Blob; mediaFiles: Map<string, string | Blob>}>
	}

	export function createPandocInstance(
		wasmBinary: ArrayBuffer
	): Promise<RawPandocInstance>
}
