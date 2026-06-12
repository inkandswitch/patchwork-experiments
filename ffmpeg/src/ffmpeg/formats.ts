// Curated output formats (everything the bundled @ffmpeg/core can encode
// well), plus extension → kind/mime tables used for detection and previews.

export type MediaKind = "video" | "audio" | "image"

export type OutputFormat = {
	ext: string
	label: string
	kind: MediaKind
}

export const OUTPUT_FORMATS: OutputFormat[] = [
	// video
	{ext: "mp4", label: "MP4 (H.264)", kind: "video"},
	{ext: "webm", label: "WebM (VP9)", kind: "video"},
	{ext: "mkv", label: "Matroska (MKV)", kind: "video"},
	{ext: "mov", label: "QuickTime (MOV)", kind: "video"},
	{ext: "avi", label: "AVI", kind: "video"},
	{ext: "gif", label: "Animated GIF", kind: "video"},
	// audio
	{ext: "mp3", label: "MP3", kind: "audio"},
	{ext: "m4a", label: "AAC (M4A)", kind: "audio"},
	{ext: "wav", label: "WAV", kind: "audio"},
	{ext: "ogg", label: "Ogg Vorbis", kind: "audio"},
	{ext: "opus", label: "Opus", kind: "audio"},
	{ext: "flac", label: "FLAC", kind: "audio"},
	// image (single frame)
	{ext: "png", label: "PNG", kind: "image"},
	{ext: "jpg", label: "JPEG", kind: "image"},
	{ext: "webp", label: "WebP", kind: "image"},
	{ext: "bmp", label: "BMP", kind: "image"},
]

const VIDEO_EXTENSIONS = new Set([
	"mp4", "m4v", "webm", "mkv", "mov", "avi", "wmv", "flv", "mpg", "mpeg",
	"ts", "m2ts", "3gp", "ogv",
])

const AUDIO_EXTENSIONS = new Set([
	"mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "wma", "aiff",
	"aif", "amr", "mka",
])

const IMAGE_EXTENSIONS = new Set([
	"png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "tif", "avif", "heic",
	"ico", "svg",
])

export function extensionOf(name: string): string {
	const base = name.split("/").pop() || name
	const i = base.lastIndexOf(".")
	return i > 0 ? base.slice(i + 1).toLowerCase() : ""
}

/** Kind of a file based on its extension (gif counts as image for previews). */
export function detectKind(name: string): MediaKind | null {
	const ext = extensionOf(name)
	if (VIDEO_EXTENSIONS.has(ext)) return "video"
	if (AUDIO_EXTENSIONS.has(ext)) return "audio"
	if (IMAGE_EXTENSIONS.has(ext)) return "image"
	return null
}

export function isMediaName(name: string): boolean {
	return detectKind(name) !== null
}

/** Pick a sensible default output format for a newly added main input. */
export function autoOutputFormat(name: string): string {
	const ext = extensionOf(name)
	switch (detectKind(name)) {
		case "video":
			return ext === "mp4" ? "webm" : "mp4"
		case "audio":
			return ext === "mp3" ? "wav" : "mp3"
		case "image":
			return ext === "png" ? "jpg" : "png"
		default:
			return "mp4"
	}
}

export const mimeByExtension: Record<string, string> = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	webm: "video/webm",
	mkv: "video/x-matroska",
	mov: "video/quicktime",
	avi: "video/x-msvideo",
	mpg: "video/mpeg",
	mpeg: "video/mpeg",
	ogv: "video/ogg",
	"3gp": "video/3gpp",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	aac: "audio/aac",
	wav: "audio/wav",
	ogg: "audio/ogg",
	oga: "audio/ogg",
	opus: "audio/ogg",
	flac: "audio/flac",
	aiff: "audio/aiff",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	bmp: "image/bmp",
	tiff: "image/tiff",
	svg: "image/svg+xml",
}

export function mimeFor(name: string): string {
	return mimeByExtension[extensionOf(name)] || "application/octet-stream"
}

export function formatLabel(ext: string): string {
	return OUTPUT_FORMATS.find(f => f.ext === ext)?.label || ext.toUpperCase()
}

/** Preview kind for an output extension (gif previews as an image). */
export function previewKind(ext: string): MediaKind | null {
	if (ext === "gif") return "image"
	const fmt = OUTPUT_FORMATS.find(f => f.ext === ext)
	if (fmt) return fmt.kind
	return detectKind(`x.${ext}`)
}
