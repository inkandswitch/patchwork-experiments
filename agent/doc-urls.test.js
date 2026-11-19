/**
 * Mending the document URLs a model mistypes (doc-urls.js).
 *
 * Every corruption of a small set of real ids is tried — every run-on, every
 * wrapping, every one-character substitution, deletion and insertion at every
 * position — and one property is held over all of them: a repair names
 * either the document that was meant or nothing. It never names some other
 * document.
 */

import { describe, it, expect } from "vitest"
import { Repo, initSubduction, generateAutomergeUrl, isValidAutomergeUrl } from "@automerge/automerge-repo"
import { repairDocUrl, urlsIn, editDistance, MistypedUrl } from "./doc-urls.js"
import { kernelRepo } from "./scope.js"

await initSubduction()

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const IDS = Array.from({ length: 20 }, () => generateAutomergeUrl())
const idOf = (url) => url.slice("automerge:".length)

/** Every one-character change to an id: substitutions, deletions, insertions. */
function* oneEdit(id) {
  for (let i = 0; i < id.length; i++) {
    yield id.slice(0, i) + id.slice(i + 1) // deletion
    const other = BASE58[(BASE58.indexOf(id[i]) + 7) % BASE58.length]
    yield id.slice(0, i) + other + id.slice(i + 1) // substitution
  }
  for (let i = 0; i <= id.length; i++) yield id.slice(0, i) + "z" + id.slice(i) // insertion
}

/** The invariant: a repair is a valid URL that the input or the conversation supplied. */
function holds(input, known, result) {
  expect(isValidAutomergeUrl(result.url), input).toBe(true)
  const id = idOf(result.url).split("#")[0]
  const fromInput = input.includes(id)
  const fromKnown = known.some((url) => idOf(url) === id)
  expect(fromInput || fromKnown, `${input} → ${result.url}`).toBe(true)
}

describe("a valid or acceptable URL is used as it is", () => {
  it("a URL, with or without heads; a bare id; a legacy UUID; a web address", () => {
    const url = IDS[0]
    const known = () => {
      throw new Error("the conversation is not read for a URL that is fine")
    }
    for (const input of [url, `${url}#2pQ`, idOf(url), "964c1726-fde4-41b9-89d4-4d4c85283d30", "https://x.test/paper", "automerge:"]) {
      expect(repairDocUrl(input, known)).toEqual({ url: input, repaired: false })
    }
  })
})

describe("a run-on or a wrapping is mended with no help", () => {
  it("for every id, every suffix a model runs on, and every way prose wraps a URL", () => {
    let cases = 0
    for (const url of IDS) {
      for (const suffix of ["can", "s", "and", "x", ".", ",", "`", ")", " and then", "!"]) {
        const input = url + suffix
        const result = repairDocUrl(input, [])
        expect(result, input).toEqual({ url, repaired: true })
        cases++
      }
      for (const [open, close] of [["`", "`"], ['"', '"'], ["<", ">"], ["(", ")."], ["'", "',"]]) {
        expect(repairDocUrl(open + url + close, [])).toEqual({ url, repaired: true })
        cases++
      }
    }
    expect(cases).toBe(IDS.length * 15)
  })

  it("the URL from the report: a run-on onto a real id", () => {
    expect(repairDocUrl("automerge:2A5mceJwVPddcxxjyhEKzw56iYnCcan", [])).toEqual({ url: "automerge:2A5mceJwVPddcxxjyhEKzw56iYnC", repaired: true })
  })

  it("keeps heads through a mend", () => {
    expect(repairDocUrl(`${IDS[1]}x#2pQ`, [])).toEqual({ url: `${IDS[1]}#2pQ`, repaired: true })
  })
})

describe("a changed, dropped or extra character is mended to an id the conversation has seen", () => {
  it("every one-character edit of every id, among the others: mended to the right one, never another", () => {
    let mended = 0
    let refused = 0
    for (const url of IDS) {
      for (const wrong of oneEdit(idOf(url))) {
        const input = `automerge:${wrong}`
        if (isValidAutomergeUrl(input)) continue // the checksum passed by chance: a different document, rightly used as written
        const result = repairDocUrl(input, IDS)
        holds(input, IDS, result)
        if (result.url === url) mended++
        else refused++
      }
    }
    // With the meant id in the conversation, every edit is mended to it. (A
    // deletion at the very end can leave a valid prefix of another length; it
    // is still mended to the meant id because the meant id is known.)
    expect(refused).toBe(0)
    expect(mended).toBeGreaterThan(IDS.length * 80)
  })

  it("without having seen it, a changed character is refused, saying why and what is near", () => {
    let refusals = 0
    for (const url of IDS.slice(0, 5)) {
      const id = idOf(url)
      const wrong = `automerge:${id.slice(0, 10)}${BASE58[(BASE58.indexOf(id[10]) + 3) % BASE58.length]}${id.slice(11)}`
      if (isValidAutomergeUrl(wrong)) continue
      try {
        const result = repairDocUrl(wrong, IDS.filter((u) => u !== url))
        holds(wrong, IDS, result) // only a valid prefix of what was written could mend it
      } catch (err) {
        expect(err).toBeInstanceOf(MistypedUrl)
        expect(err.message).toMatch(/fails it, so a character is wrong or missing/)
        refusals++
      }
    }
    expect(refusals).toBeGreaterThan(0)
  })

  it("names the nearest ids it has seen when it cannot mend", () => {
    const meant = idOf(IDS[2])
    const wrong = `automerge:${meant.slice(0, 5)}${"x".repeat(5)}${meant.slice(10)}` // five edits: too far to take as meant
    let err
    try {
      repairDocUrl(wrong, IDS)
    } catch (e) {
      err = e
    }
    expect(err?.suggestions?.[0]).toBe(IDS[2])
    expect(err.message).toContain(IDS[2])
  })
})

describe("helpers", () => {
  it("finds every valid URL in text, once, and no invalid one", () => {
    const text = `see ${IDS[0]}, then ${IDS[1]} and ${IDS[0]} again; not automerge:2A5mceJwVPddcxxjyhEKzw56iYnCcan`
    expect(urlsIn(text)).toEqual([IDS[0], IDS[1]])
  })

  it("measures edit distance", () => {
    expect([editDistance("abc", "abc"), editDistance("abc", "abd"), editDistance("abc", "ab"), editDistance("abc", "xabc"), editDistance("", "abc")]).toEqual([0, 1, 1, 1, 3])
  })
})

describe("through the repo a session's tools use", () => {
  it("a mistyped URL opens the document that was meant", async () => {
    const repo = new Repo({ network: [] })
    const handle = repo.create({ title: "Scene" })
    const meant = handle.url
    const tools = kernelRepo(repo, { known: () => [meant] })
    expect((await tools.find(`${meant}can`)).doc().title).toBe("Scene")
    const changed = `automerge:${idOf(meant).slice(0, 12)}${idOf(meant)[12] === "a" ? "b" : "a"}${idOf(meant).slice(13)}`
    if (!isValidAutomergeUrl(changed)) expect((await tools.find(changed)).doc().title).toBe("Scene")
  })

  it("and one it cannot mend fails with a reason, not 'Invalid AutomergeUrl'", async () => {
    const tools = kernelRepo(new Repo({ network: [] }), { known: () => [] })
    expect(() => tools.find("automerge:2pLkpEiKYRcwzz7LqQ6ihCjVqJvxyz")).toThrow(MistypedUrl)
  })
})
