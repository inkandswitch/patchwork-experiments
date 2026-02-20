/**
 * Search skill — recursively search file contents for a text or regex pattern.
 *
 * Uses the global `fs` object (available in the LLM eval context).
 */

/**
 * Recursively search for a pattern across all files under startPath.
 *
 * @param {object} fs - Filesystem object from the LLM eval context
 * @param {string | RegExp} pattern - Text or RegExp to search for (strings are case-insensitive)
 * @param {string} [startPath="/"] - Directory to start searching from
 * @returns {Promise<Array<{ file: string, line: string, lineNumber: number }>>}
 */
export async function search(fs, pattern, startPath = "/") {
  const results = [];
  const matcher =
    pattern instanceof RegExp
      ? (line) => pattern.test(line)
      : (line) => line.toLowerCase().includes(pattern.toLowerCase());

  async function walk(dirPath) {
    let entries;
    try {
      entries = await fs.listFolder(dirPath);
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
            if (matcher(lines[i])) {
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
