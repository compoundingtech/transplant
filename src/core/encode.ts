/**
 * Encode an absolute working-directory path the way Claude Code does when it
 * keys a session transcript folder: every non-alphanumeric character becomes a
 * hyphen.
 *
 *   encodeCwd("/path/to/my-project") === "-path-to-my-project"
 *
 * This transform is LOSSY and therefore one-way: `/`, `.`, `_`, spaces and
 * every other separator all collapse to `-`, so the encoded form cannot be
 * reliably decoded back to the original path. The original absolute path is
 * preserved out-of-band (in a bundle manifest), never recovered from the folder
 * name.
 */
export function encodeCwd(absPath: string): string {
  return absPath.replace(/[^a-zA-Z0-9]/g, "-");
}
