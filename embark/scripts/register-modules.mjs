// Registers every pushed feature package's pushwork rootUrl into a
// module-settings doc. `pw-modules add` already dedupes (it only appends a url
// to modules[] when not already present), so re-running is safe and existing
// entries are left untouched. Packages without a .pushwork (e.g. @embark/core)
// are skipped.
//
// Usage: node scripts/register-modules.mjs <module-settings-automerge-url>
//        MODULE_SETTINGS_DOC_URL=automerge:... node scripts/register-modules.mjs

import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const settings = process.argv[2] ?? process.env.MODULE_SETTINGS_DOC_URL;
if (!settings) {
  throw new Error(
    "pass the module-settings automerge url as an argument or via MODULE_SETTINGS_DOC_URL",
  );
}

for (const dir of readdirSync("packages")) {
  const cfg = `packages/${dir}/.pushwork/config.json`;
  let rootUrl;
  try {
    rootUrl = JSON.parse(readFileSync(cfg, "utf8")).rootUrl;
  } catch {
    continue; // core / non-pushed packages have no .pushwork
  }
  if (!rootUrl) continue;
  console.log(`registering @embark/${dir} -> ${rootUrl}`);
  execFileSync("pw-modules", ["add", settings, rootUrl], { stdio: "inherit" });
}
