import { ANNOTATE_SKILL } from "./annotate";
import { SEARCH_SKILL } from "./search";

// A "skill" is a self-contained slice of the system prompt that documents one
// capability (a set of providers and the exact effect.js contract for it). The
// core prompt only advertises the menu; the model pulls a skill's full doc into
// the loop with loadSkill(name) before it writes effect.js.
export type Skill = {
  name: string;
  summary: string;
  doc: string;
};

export const SKILLS: Record<string, Skill> = {
  [ANNOTATE_SKILL.name]: ANNOTATE_SKILL,
  [SEARCH_SKILL.name]: SEARCH_SKILL,
};

// The one-line-per-skill menu injected into the system prompt.
export function formatSkillMenu(): string {
  return Object.values(SKILLS)
    .map((skill) => `- ${skill.name}: ${skill.summary}`)
    .join("\n");
}

// Resolve a skill's full doc for loadSkill(). Returns a corrective message for
// unknown names so the model can retry with a valid one instead of failing.
export function loadSkill(name: string): string {
  const key = typeof name === "string" ? name.trim() : String(name);
  const skill = SKILLS[key];
  if (!skill) {
    return `Unknown skill "${name}". Available skills: ${Object.keys(SKILLS).join(", ")}.`;
  }
  return skill.doc;
}
