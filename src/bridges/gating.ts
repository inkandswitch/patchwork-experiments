/**
 * Capability gating shared by the bridges that relay a named capability across
 * the boundary.
 *
 * Every such bridge gates the same way: read a comma-separated attribute the
 * HOST set on the isolation element, intersect it with a hardcoded allowlist of
 * things that have had security review, and drop anything else with a warning.
 * Two opt-ins are required — the host must ask for it AND isolation must permit
 * it — so nothing is bridged by default and a host can always decline.
 *
 * This was independently reimplemented in each bridge; the copies had drifted
 * only in their warning text. One implementation, two call sites
 * (shared-providers and shared-tools).
 */

/**
 * Resolve the capabilities to bridge for one isolation instance: the
 * intersection of `attribute` on `element` and `allowed`.
 *
 * @param element   the isolation host element carrying the attribute
 * @param attribute e.g. "shared-providers" — comma-separated, host-set
 * @param allowed   the hardcoded allowlist for this capability
 * @param label     name used in the warning (defaults to `attribute`)
 * @returns the requested entries that are permitted, in requested order
 */
export function resolveGatedAttribute(
  element: HTMLElement,
  attribute: string,
  allowed: readonly string[],
  label: string = attribute
): string[] {
  const requested = (element.getAttribute(attribute) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const granted: string[] = [];
  for (const entry of requested) {
    if (allowed.includes(entry)) {
      granted.push(entry);
    } else {
      console.warn(
        `[patchwork-isolation] ${label}: "${entry}" is not permitted. ` +
          `New entries need independent security analysis before being added.`
      );
    }
  }
  return granted;
}
