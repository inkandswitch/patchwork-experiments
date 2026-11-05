import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import type {AutomergeUrl} from "@automerge/automerge-repo"
import {createImportResolver, defaultRetryDelay, type ImportHandle} from "./importResolver"

const url = (id: string) => `automerge:${id}` as AutomergeUrl

function fakeHandle(content: unknown) {
	const listeners = new Set<() => void>()
	let value = content
	const handle: ImportHandle = {
		doc: () => value,
		on: (_e, fn) => listeners.add(fn),
		off: (_e, fn) => listeners.delete(fn),
	}
	return {
		handle,
		listeners,
		change(next: unknown) {
			value = next
			for (const fn of listeners) fn()
		},
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (err: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return {promise, resolve, reject}
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("defaultRetryDelay", () => {
	it("doubles from one second up to thirty", () => {
		expect([1, 2, 3, 4, 5, 6, 7].map(defaultRetryDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
	})
})

describe("createImportResolver", () => {
	it("settles only once every import's first find is done, so the first render binds real data", async () => {
		const a = deferred<ImportHandle>()
		const b = deferred<ImportHandle>()
		const finds: Record<string, Promise<ImportHandle>> = {[url("a")]: a.promise, [url("b")]: b.promise}
		const onChange = vi.fn()
		const resolver = createImportResolver({find: u => finds[u], onChange})
		const imports = [
			{name: "a", docUrl: url("a")},
			{name: "b", docUrl: url("b")},
		]
		resolver.sync(imports)
		expect(resolver.pending()).toBe(true)

		let settled = false
		void resolver.settled(Infinity).then(() => (settled = true))
		a.resolve(fakeHandle({w: 1}).handle)
		await vi.advanceTimersByTimeAsync(0)
		expect(settled).toBe(false)

		b.reject(new Error("unavailable"))
		await vi.advanceTimersByTimeAsync(0)
		expect(settled).toBe(true)
		expect(resolver.pending()).toBe(false)
		expect(resolver.payload(imports)).toEqual([
			{name: "a", json: '{"w":1}'},
			{name: "b", json: "{}"},
		])
		resolver.dispose()
	})

	it("stops waiting after the timeout", async () => {
		const resolver = createImportResolver({find: () => new Promise(() => {}), onChange: () => {}})
		resolver.sync([{docUrl: url("slow")}])
		let settled = false
		void resolver.settled(5000).then(() => (settled = true))
		await vi.advanceTimersByTimeAsync(4999)
		expect(settled).toBe(false)
		await vi.advanceTimersByTimeAsync(1)
		expect(settled).toBe(true)
	})

	it("settles at once with no imports", async () => {
		const resolver = createImportResolver({find: vi.fn(), onChange: () => {}})
		resolver.sync([])
		await expect(resolver.settled(Infinity)).resolves.toBeUndefined()
	})

	it("retries a failed find with backoff and reports the arrival", async () => {
		const doc = fakeHandle({w: 7})
		const find = vi
			.fn<(u: AutomergeUrl) => Promise<ImportHandle>>()
			.mockRejectedValueOnce(new Error("unavailable"))
			.mockRejectedValueOnce(new Error("unavailable"))
			.mockResolvedValue(doc.handle)
		const onChange = vi.fn()
		const resolver = createImportResolver({find, onChange})
		const imports = [{name: "data", docUrl: url("a")}]
		resolver.sync(imports)

		await vi.advanceTimersByTimeAsync(0)
		expect(find).toHaveBeenCalledTimes(1)
		expect(onChange).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(999)
		expect(find).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(1) // 1 s after the first failure
		expect(find).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1999)
		expect(find).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(1) // 2 s after the second
		expect(find).toHaveBeenCalledTimes(3)
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(resolver.payload(imports)).toEqual([{name: "data", json: '{"w":7}'}])

		// and it is live from then on
		doc.change({w: 8})
		expect(onChange).toHaveBeenCalledTimes(2)
		expect(resolver.payload(imports)[0].json).toBe('{"w":8}')
		resolver.dispose()
		expect(doc.listeners.size).toBe(0)
	})

	it("stops retrying an import that is removed, and ignores a find that lands after removal", async () => {
		const late = deferred<ImportHandle>()
		const find = vi
			.fn<(u: AutomergeUrl) => Promise<ImportHandle>>()
			.mockImplementation(async u => {
				if (u === url("gone")) throw new Error("unavailable")
				return late.promise
			})
		const onChange = vi.fn()
		const resolver = createImportResolver({find, onChange})
		resolver.sync([{docUrl: url("gone")}, {docUrl: url("late")}])
		await vi.advanceTimersByTimeAsync(0)
		resolver.sync([])
		const doc = fakeHandle({})
		late.resolve(doc.handle)
		await vi.advanceTimersByTimeAsync(60_000)
		expect(find.mock.calls.filter(c => c[0] === url("gone"))).toHaveLength(1)
		expect(doc.listeners.size).toBe(0)
		expect(onChange).not.toHaveBeenCalled()
	})

	it("finds each doc once however often it is synced, and binds by the current names", async () => {
		const find = vi.fn(async () => fakeHandle({x: 1}).handle)
		const resolver = createImportResolver({find, onChange: () => {}})
		resolver.sync([{docUrl: url("a")}])
		resolver.sync([{docUrl: url("a")}, {docUrl: url("a")}])
		await vi.advanceTimersByTimeAsync(0)
		expect(find).toHaveBeenCalledTimes(1)
		expect(resolver.payload([{name: "renamed", docUrl: url("a")}])).toEqual([{name: "renamed", json: '{"x":1}'}])
	})

	it("treats a find that throws synchronously like a failed one", async () => {
		const find = vi.fn<(u: AutomergeUrl) => Promise<ImportHandle>>(() => {
			throw new Error("bad url")
		})
		const resolver = createImportResolver({find, onChange: () => {}, retryDelay: () => 10})
		resolver.sync([{docUrl: url("a")}])
		await expect(resolver.settled(Infinity)).resolves.toBeUndefined()
		await vi.advanceTimersByTimeAsync(10)
		expect(find).toHaveBeenCalledTimes(2)
		resolver.dispose()
	})
})
