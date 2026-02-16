/**
 * Search skill — recursively search file contents for a text pattern.
 *
 * Uses the global `fs` object (available in the LLM eval context).
 */

/**
 * Recursively search for a pattern across all files under startPath.
 *
 * @param {string} pattern - Text to search for (case-insensitive)
 * @param {string} [startPath="/"] - Directory to start searching from
 * @returns {Promise<Array<{ file: string, line: string, lineNumber: number }>>}
 */
export async function search(pattern, startPath = "/") {
  const results = [];
  const lowerPattern = pattern.toLowerCase();

  async function walk(dirPath) {
    let entries;
    try {
      entries = await fs.listDir(dirPath);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = dirPath === "/" ? `/${entry.name}` : `${dirPath}/${entry.name}`;

      if (entry.type === "folder") {
        await walk(fullPath);
      } else {
        try {
          const content = await fs.readFile(fullPath);
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerPattern)) {
              results.push({
                file: fullPath,
                line: lines[i],
                lineNumber: i + 1,
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(startPath);
  return results;
}
