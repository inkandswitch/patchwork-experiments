/**
 * What the agent's prompt and its tools' results carry beyond the loop's own:
 * what earlier sessions learned, the usage guides it keeps, and the skills
 * installed packages bring.
 */

import { notesSection } from "../knowledge/notes.js"
import { guidesSection, surfaceGuides } from "../knowledge/guides.js"
import { packageSkillsSection } from "../knowledge/skills.js"

/** Added to the system prompt, in this order, each a function of the tools' context. */
export const PROMPT_SECTIONS = [notesSection, guidesSection, packageSkillsSection]

/** Added to a call's result: a package's usage guide, with the first call that uses the package. */
export const AFTER_CALL = [surfaceGuides]
