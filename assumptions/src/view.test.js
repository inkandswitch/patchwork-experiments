import { beforeEach, describe, expect, it } from "vitest"
import { Repo, initSubduction } from "@automerge/automerge-repo"
import { AssumptionsDatatype } from "./datatype.js"
import { AssumptionsView } from "./view.js"

await initSubduction()

let repo, handle, element, dispose

beforeEach(() => {
  dispose?.()
  repo = new Repo({ network: [] })
  handle = repo.create()
  handle.change((d) => {
    AssumptionsDatatype.init(d)
    d.title = "Battery"
    d.entries.cell_cap_Ah = { label: "capacity", unit: "Ah", value: 300, kind: "fact", status: "verified", source: "automerge:x", quote: "280Ah", note: null, inputs: null, by: null, at: null }
    d.entries.gas_cell_L = { label: null, unit: "L", value: { min: 112, max: 392 }, kind: "result", status: "derived", source: null, quote: null, note: null, inputs: { cell_cap_Ah: 280 }, by: null, at: null }
  })
  element = document.createElement("div")
  document.body.append(element)
  dispose = AssumptionsView(handle, element, { repo })
})

const rowOf = (id) => [...element.querySelectorAll("tr.entry")].find((tr) => tr.textContent.includes(id))

describe("view", () => {
  it("shows entries by group, with status and stale results", () => {
    expect(element.querySelector("h1").textContent).toBe("Battery")
    expect([...element.querySelectorAll("tr.group")].map((tr) => tr.textContent)).toEqual(["cell", "gas"])
    expect(rowOf("cell_cap_Ah").textContent).toContain("300 Ah")
    expect(rowOf("gas_cell_L").querySelector(".stale")).toBeTruthy()
    expect(rowOf("gas_cell_L").textContent).toContain("112–392 L")
  })

  it("an edit to a verified value is no longer verified", () => {
    rowOf("cell_cap_Ah").click()
    const value = element.querySelector(".edit input[placeholder^='3.2']")
    value.value = "280"
    ;[...element.querySelectorAll(".edit button")].find((b) => b.textContent === "Save").click()
    const entry = handle.doc().entries.cell_cap_Ah
    expect(entry.value).toBe(280)
    expect(entry.status).toBe("cited")
    // and the result computed at 280 is fresh again
    expect(rowOf("gas_cell_L").querySelector(".stale")).toBeNull()
  })

  it("adds an entry, refusing a bad id", () => {
    ;[...element.querySelectorAll(".bar button")].find((b) => b.textContent === "Add entry").click()
    const [id, value] = element.querySelectorAll(".edit input")
    id.value = "barrier"
    value.value = "3"
    const save = () => [...element.querySelectorAll(".edit button")].find((b) => b.textContent === "Save").click()
    save()
    expect(element.querySelector(".edit .problem").textContent).toContain("not a usable id")
    id.value = "barrier_mm"
    save()
    expect(handle.doc().entries.barrier_mm).toMatchObject({ value: 3, kind: "fact", status: "estimated" })
  })
})
