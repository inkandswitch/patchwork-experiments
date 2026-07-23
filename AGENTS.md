# AGENTS.md

This repo builds Patchwork tools, datatypes, and actions.

When building, scaffolding, or modifying anything Patchwork — a tool from scratch,
porting something in, a datatype/tool/action plugin, an automerge document model,
or the build/sync setup — read the skill first:

`.claude/skills/writing-patchwork-tools/SKILL.md`

It covers the plugin registration shape, the `(handle, element) => cleanup` render
contract, the datatype lifecycle, bundleless vs bundled builds (vite + pushwork),
multiplayer/ephemeral messaging, the importmap, and the common gotchas.

House style: small, simple tools in plain vanilla JavaScript. TypeScript, npm deps,
and a bundled build are all fine (pushwork handles them). If a reactive framework is
needed, use Solid — never React.
