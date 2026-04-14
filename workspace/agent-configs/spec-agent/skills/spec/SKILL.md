---
name: spec
description: Create and manage tree-structured SpecDoc documents — standalone Automerge documents with a goal, Datalog verification URLs, optional child specs, and optional file folders.
---

# Spec Skill

Create a **tree of SpecDoc documents**. Each SpecDoc is a standalone Automerge document that holds a goal, references to Datalog constraint files (`verificationUrls`), and optional child spec URLs (`subSpecUrls`). A root SpecDoc links to one or more leaf SpecDocs via `subSpecUrls`.

## Import

```javascript
const { createSpec, getSpec, createFolder, addFileToFolder } = await useSkill("spec");
```

## SpecDoc Shape

```javascript
{
  '@patchwork': { type: 'spec' },
  spec: {
    goal: string,
    verificationUrls: AutomergeUrl[],  // Datalog constraint docs (merged + checked at validation)
    subSpecUrls: AutomergeUrl[],        // child SpecDoc URLs (for root spec)
    filesFolderUrl?: AutomergeUrl,      // folder of solution artifact files (for leaf specs)
  }
}
```

## API

### `createSpec(goal)` (sync)

Creates a new SpecDoc. **Do NOT await** — `repo.create()` is synchronous.

Returns `{ handle, url }`.

```javascript
const { url: leafUrl } = createSpec("Machine A satisfies firewall rules");
```

### `await getSpec(url)` (async)

Returns a spec handle for read/write access.

| Method | Description |
|--------|-------------|
| `getGoal()` | Returns the goal string |
| `setGoal(goal)` | Sets the goal |
| `await addVerificationDoc(datalogUrl, options?)` | Creates a verification wrapper doc for the Datalog doc and appends it to `verificationUrls`. Options: `{ title?, description? }`. Returns the verification doc URL. **Must be awaited.** |
| `removeVerificationDoc(url)` | Removes a verification doc URL |
| `addSubSpec(url)` | Appends a child SpecDoc URL to `subSpecUrls` (root spec) |
| `removeSubSpec(url)` | Removes a child SpecDoc URL |
| `setFilesFolder(url)` | Sets `filesFolderUrl` (for solution artifact files) |
| `getUrl()` | Returns the Automerge URL of the spec doc |

### `createFolder()` (sync)

Creates a folder doc for holding solution artifact files. **Do NOT await.**

Returns `{ handle, url }`.

```javascript
const { url: folderUrl } = createFolder();
```

### `await addFileToFolder(folderUrl, name, docUrl, type)` (async)

Appends a file entry to a folder doc.

```javascript
await addFileToFolder(folderUrl, "machine-a-iptables", datalogUrl, "datalog");
```

## Tree Structure

The output is always a **root SpecDoc** that may contain **leaf SpecDocs** via `subSpecUrls`:

```
Root SpecDoc
  ├── verificationUrls: [globalConstraintsDatalog]
  └── subSpecUrls:
        ├── Leaf SpecDoc A
        │     ├── verificationUrls: [commonRules, machineARules]
        │     └── filesFolderUrl: folderA  ← solution artifacts go here
        └── Leaf SpecDoc B
              ├── verificationUrls: [commonRules, machineBRules]
              └── filesFolderUrl: folderB
```

`verificationUrls` always point to **Datalog constraint docs**. The plan executor merges the verification docs with the solution files from `filesFolderUrl` and checks for constraint violations.

If the domain is simple (no sub-problems), create a single leaf spec and use it as the root too (just don't add `subSpecUrls`).

## ROOT_SPEC_URL Convention

At the end of your final script, always log the root spec URL so the workflow can locate it:

```javascript
console.log('ROOT_SPEC_URL:', rootUrl);
```

## Example — Network Firewall

```javascript
const { createDatalog } = await useSkill("datalog");
const { createSpec, getSpec, createFolder, addFileToFolder } = await useSkill("spec");

// --- Shared constraint Datalog docs ---
const commonRules = createDatalog("Common Machine Rules");
commonRules.assertConstraint("no_redundant_rules", {
  body: [
    { pred: "rule", args: ["M", "Chain", "Idx", "Action", "Src", "Proto", "Port"] },
    { pred: "rule", args: ["M", "Chain", "Earlier", "Action", "Broader", "Proto", "Port"] },
    { pred: "lt", args: ["Earlier", "Idx"] },
    { pred: "ip_in", args: ["Src", "Broader"] },
  ],
});

const globalRules = createDatalog("Global Firewall Rules");
globalRules.assertFact("machine", ["machine_a", "192.168.1.10"]);
globalRules.assertFact("machine", ["machine_b", "192.168.1.11"]);
globalRules.assertConstraint("blocked_ip_not_allowed", {
  body: [
    { pred: "blocked_ip", args: ["IP"] },
    { pred: "rule", args: ["M", "input", "_", "accept", "Src", "_", "_"] },
    { pred: "ip_in", args: ["IP", "Src"] },
  ],
});

const machineARules = createDatalog("Machine A Rules");
machineARules.assertFact("role", ["machine_a", "webserver"]);
// ... add machine-specific constraints

const machineBRules = createDatalog("Machine B Rules");
machineBRules.assertFact("role", ["machine_b", "database"]);
// ... add machine-specific constraints

// --- Pre-create solution artifact stubs ---
// These DatalogDocs will be modified by the plan executor to satisfy the constraints.
// Seed them with domain facts so the executor knows the structure.
const machineASolution = createDatalog("Machine A IPTables");
machineASolution.assertFact("chain", ["machine_a", "input", "drop"]);
machineASolution.assertFact("chain", ["machine_a", "output", "accept"]);
// (plan executor will add/modify rule(...) facts here)

const machineBSolution = createDatalog("Machine B IPTables");
machineBSolution.assertFact("chain", ["machine_b", "input", "drop"]);
machineBSolution.assertFact("chain", ["machine_b", "output", "accept"]);

// --- Files folders ---
const folderA = createFolder();
await addFileToFolder(folderA.url, "machine-a-iptables", machineASolution.url, "datalog");

const folderB = createFolder();
await addFileToFolder(folderB.url, "machine-b-iptables", machineBSolution.url, "datalog");

// --- Leaf specs — goals name the artifact ---
const { url: leafAUrl } = createSpec("Machine A iptables configuration");
const leafA = await getSpec(leafAUrl);
await leafA.addVerificationDoc(commonRules.url, { title: "Common Machine Rules" });
await leafA.addVerificationDoc(machineARules.url, { title: "Machine A Rules" });
leafA.setFilesFolder(folderA.url);

const { url: leafBUrl } = createSpec("Machine B iptables configuration");
const leafB = await getSpec(leafBUrl);
await leafB.addVerificationDoc(commonRules.url, { title: "Common Machine Rules" });
await leafB.addVerificationDoc(machineBRules.url, { title: "Machine B Rules" });
leafB.setFilesFolder(folderB.url);

// --- Root spec ---
const { url: rootUrl } = createSpec("Network Firewall Configuration");
const root = await getSpec(rootUrl);
await root.addVerificationDoc(globalRules.url, { title: "Global Firewall Rules" });
root.addSubSpec(leafAUrl);
root.addSubSpec(leafBUrl);

console.log('ROOT_SPEC_URL:', rootUrl);
```

## Guidelines

- Always log `ROOT_SPEC_URL: <url>` at the end of your final script.
- `addVerificationDoc` creates a verification wrapper document pointing to a Datalog doc and adds it to `verificationUrls`. The underlying Datalog doc must contain at least one `assertConstraint`. **Must be awaited.**
- Add constraints to Datalog docs via `assertConstraint(name, { body: [...] })`. Give every constraint a descriptive name.
- **Leaf spec goals name the artifact** to be produced (e.g. `"Machine A iptables configuration"`), not a validation statement.
- **Pre-create a solution DatalogDoc stub** for each leaf artifact and place it in the `filesFolderUrl` folder with `addFileToFolder`. Seed it with domain facts; the plan executor will modify it to satisfy constraints.
- The root spec holds cross-cutting/global constraints; leaf specs hold per-domain constraints.
- If the problem has no sub-domains, a single SpecDoc (no subSpecUrls) is fine.
