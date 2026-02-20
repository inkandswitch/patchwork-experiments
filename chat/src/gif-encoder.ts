export class SimpleGIFEncoder {
	width: number
	height: number
	frames: {data: Uint8ClampedArray | number[]; delay: number}[]
	transparent: boolean

	constructor(w: number, h: number, transparent = false) {
		this.width = w
		this.height = h
		this.frames = []
		this.transparent = transparent
	}

	addFrame(canvas: HTMLCanvasElement, delay = 100) {
		const ctx = canvas.getContext("2d")!
		this.frames.push({
			data: ctx.getImageData(0, 0, this.width, this.height).data,
			delay,
		})
	}

	addFrameData(imageData: Uint8ClampedArray | number[], delay = 100) {
		this.frames.push({data: imageData, delay})
	}

	_quantize(pixels: Uint8ClampedArray | number[]): number[][] {
		const m = new Map<number, number>()
		for (let i = 0; i < pixels.length; i += 4) {
			if (this.transparent && pixels[i + 3] < 128) continue
			const k =
				((pixels[i] >> 3) << 10) |
				((pixels[i + 1] >> 3) << 5) |
				(pixels[i + 2] >> 3)
			m.set(k, (m.get(k) || 0) + 1)
		}
		const max = this.transparent ? 255 : 256
		const s = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, max)
		const p: number[][] = s.map(([k]) => [
			((k >> 10) & 0x1f) << 3,
			((k >> 5) & 0x1f) << 3,
			(k & 0x1f) << 3,
		])
		while (p.length < 256) p.push([0, 0, 0])
		return p
	}

	_closest(p: number[][], r: number, g: number, b: number): number {
		let best = 0,
			bd = Infinity
		for (let i = 0; i < p.length; i++) {
			const dr = r - p[i][0],
				dg = g - p[i][1],
				db = b - p[i][2],
				d = dr * dr + dg * dg + db * db
			if (d < bd) {
				bd = d
				best = i
			}
		}
		return best
	}

	encode(): Uint8Array | null {
		if (!this.frames.length) return null
		const pal = this._quantize(this.frames[0].data)
		const bytes: number[] = []
		const wb = (b: number) => bytes.push(b & 0xff)
		const ws = (s: number) => {
			wb(s)
			wb(s >> 8)
		}
		const wr = (s: string) => {
			for (let i = 0; i < s.length; i++) wb(s.charCodeAt(i))
		}
		const transIdx = this.transparent ? 255 : 0

		wr("GIF89a")
		ws(this.width)
		ws(this.height)
		wb(0xf7)
		wb(0)
		wb(0)
		for (const [r, g, b] of pal) {
			wb(r)
			wb(g)
			wb(b)
		}
		wb(0x21)
		wb(0xff)
		wb(11)
		wr("NETSCAPE2.0")
		wb(3)
		wb(1)
		ws(0)
		wb(0)

		for (const frame of this.frames) {
			wb(0x21)
			wb(0xf9)
			wb(4)
			wb(this.transparent ? 0x09 : 0x04)
			ws(Math.round(frame.delay / 10))
			wb(transIdx)
			wb(0)
			wb(0x2c)
			ws(0)
			ws(0)
			ws(this.width)
			ws(this.height)
			wb(0)
			const mcs = 8
			wb(mcs)
			const w = this.width,
				h = this.height,
				px = frame.data,
				idx = new Uint8Array(w * h)
			for (let i = 0; i < w * h; i++) {
				if (this.transparent && px[i * 4 + 3] < 128) idx[i] = transIdx
				else
					idx[i] = this._closest(
						pal,
						px[i * 4],
						px[i * 4 + 1],
						px[i * 4 + 2]
					)
			}
			const lzw = this._lzw(mcs, idx)
			let pos = 0
			while (pos < lzw.length) {
				const c = Math.min(255, lzw.length - pos)
				wb(c)
				for (let i = 0; i < c; i++) bytes.push(lzw[pos++])
			}
			wb(0)
		}
		wb(0x3b)
		return new Uint8Array(bytes)
	}

	_lzw(mcs: number, pixels: Uint8Array): number[] {
		const cc = 1 << mcs,
			eoi = cc + 1
		let cs = mcs + 1,
			nc = eoi + 1
		const tbl = new Map<string, number>()
		const out: number[] = []
		let buf = 0,
			bb = 0
		const emit = (c: number) => {
			buf |= c << bb
			bb += cs
			while (bb >= 8) {
				out.push(buf & 0xff)
				buf >>= 8
				bb -= 8
			}
		}
		const reset = () => {
			tbl.clear()
			for (let i = 0; i < cc; i++) tbl.set(String(i), i)
			nc = eoi + 1
			cs = mcs + 1
		}
		emit(cc)
		reset()
		if (!pixels.length) {
			emit(eoi)
			if (bb > 0) out.push(buf & 0xff)
			return out
		}
		let cur = String(pixels[0])
		for (let i = 1; i < pixels.length; i++) {
			const nx = cur + "," + pixels[i]
			if (tbl.has(nx)) {
				cur = nx
			} else {
				emit(tbl.get(cur)!)
				if (nc < 4096) {
					tbl.set(nx, nc++)
					if (nc > 1 << cs && cs < 12) cs++
				} else {
					emit(cc)
					reset()
				}
				cur = String(pixels[i])
			}
		}
		emit(tbl.get(cur)!)
		emit(eoi)
		if (bb > 0) out.push(buf & 0xff)
		return out
	}
}
