import {describe, expect, it, vi} from "vitest"
import {createRenderCache, renderKey, type RenderImportInput, type RenderResult} from "./engine"

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (err: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return {promise, resolve, reject}
}

const result = (n: number): RenderResult => ({stl: new Uint8Array([n]), logs: [], elapsedMillis: n})

describe("renderKey", () => {
	it("depends on the source and on each import's name and JSON, in order", () => {
		const a = {name: "a", json: "{}"}
		const b = {name: "b", json: '{"w":1}'}
		const key = renderKey("cube(1);", [a, b])
		expect(renderKey("cube(1);", [{...a}, {...b}])).toBe(key)
		expect(renderKey("cube(2);", [a, b])).not.toBe(key)
		expect(renderKey("cube(1);", [b, a])).not.toBe(key)
		expect(renderKey("cube(1);", [a, {...b, json: '{"w":2}'}])).not.toBe(key)
		expect(renderKey("cube(1);", [a, {...b, name: "c"}])).not.toBe(key)
		expect(renderKey("cube(1);")).toBe(renderKey("cube(1);", []))
	})

	it("can't be confused by separators inside the strings", () => {
		expect(renderKey("a", [{name: "b", json: "c"}])).not.toBe(renderKey('a",["b', [{name: "", json: "c"}]))
	})
})

describe("createRenderCache", () => {
	it("serves a repeat render from the cache, marked cached", async () => {
		const render = vi.fn(async (source: string) => result(source.length))
		const cached = createRenderCache(render)
		const first = await cached("cube(1);")
		expect(first.cached).toBeFalsy()
		const second = await cached("cube(1);", [])
		expect(second.cached).toBe(true)
		expect(second.stl).toBe(first.stl)
		expect(second.elapsedMillis).toBe(first.elapsedMillis)
		expect(render).toHaveBeenCalledTimes(1)
	})

	it("keys by import JSON as well as source", async () => {
		const render = vi.fn(async (_s: string, imports: RenderImportInput[] = []) => result(imports.length))
		const cached = createRenderCache(render)
		await cached("cube(d.w);", [{name: "d", json: '{"w":1}'}])
		await cached("cube(d.w);", [{name: "d", json: '{"w":2}'}])
		await cached("cube(d.w);", [{name: "d", json: '{"w":1}'}])
		expect(render).toHaveBeenCalledTimes(2)
	})

	it("joins a render of the same key that is still running", async () => {
		const pending = deferred<RenderResult>()
		const render = vi.fn(() => pending.promise)
		const cached = createRenderCache(render)
		const a = cached("cube(1);")
		const b = cached("cube(1);")
		expect(render).toHaveBeenCalledTimes(1)
		pending.resolve(result(1))
		expect(await a).toBe(await b)
	})

	it("does not join a render of a different key", async () => {
		const render = vi.fn(async (source: string) => result(source.length))
		const cached = createRenderCache(render)
		await Promise.all([cached("cube(1);"), cached("cube(22);")])
		expect(render).toHaveBeenCalledTimes(2)
	})

	it("does not cache failures, and every joined caller sees the failure", async () => {
		const pending = deferred<RenderResult>()
		const render = vi.fn(() => pending.promise)
		const cached = createRenderCache(render)
		const a = cached("cube(")
		const b = cached("cube(")
		pending.reject(new Error("Parser error"))
		await expect(a).rejects.toThrow("Parser error")
		await expect(b).rejects.toThrow("Parser error")
		render.mockImplementation(async () => result(2))
		await expect(cached("cube(")).resolves.toMatchObject({elapsedMillis: 2})
		expect(render).toHaveBeenCalledTimes(2)
	})

	it("evicts the least recently used entry past its size", async () => {
		const render = vi.fn(async (source: string) => result(source.length))
		const cached = createRenderCache(render, 2)
		await cached("a")
		await cached("b")
		await cached("a") // a is now the most recent
		await cached("c") // evicts b
		expect(render).toHaveBeenCalledTimes(3)
		expect((await cached("a")).cached).toBe(true)
		expect((await cached("c")).cached).toBe(true)
		expect((await cached("b")).cached).toBeFalsy()
		expect(render).toHaveBeenCalledTimes(4)
	})
})
