/**
 * A real PDF for tests, written by hand: one Helvetica line of text per page,
 * or none (`null`) for a page that only draws a box, which is what a scan
 * looks like to a text extractor. The cross-reference table is exact.
 */
export function makePdf(pages) {
  const objects = []
  const add = (body) => objects.push(body) && objects.length
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  const parent = objects.length + 1 + pages.length * 2
  const kids = []
  for (const text of pages) {
    const draw = text == null ? "0 0 100 100 re f" : `BT /F1 12 Tf 72 700 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`
    const content = add(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`)
    kids.push(add(`<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`))
  }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${pages.length} >>`)
  const root = add(`<< /Type /Catalog /Pages ${parent} 0 R >>`)

  let out = "%PDF-1.4\n"
  const offsets = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${root} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(out)
}
