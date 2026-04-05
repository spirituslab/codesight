// Module grouping logic — maps file paths to semantic module names.

import { relative } from "path";

/**
 * Compute module name for a file path.
 * Returns the first directory component, e.g. "src", "tests", "web", or "root" for top-level files.
 *
 * @param {string} filePath - absolute file path
 * @param {string} projectRoot - absolute project root
 * @returns {string} module name
 */
export function getModuleName(filePath, projectRoot) {
  const rel = relative(projectRoot, filePath);
  return getModuleFromRelPath(rel);
}

/**
 * Get module from a relative path. Exported for testing.
 */
export function getModuleFromRelPath(relPath) {
  const parts = relPath.split("/");
  // Files at top level (no directory) → root
  if (parts.length <= 1) return "root";

  // Module = first directory
  return parts[0];
}

/**
 * Post-process module grouping (no-op — preserves directory structure as-is).
 *
 * @param {Map<string, {files: Array}>} moduleMap - module name → { files, ... }
 * @param {string} projectRoot - project root
 * @returns {Map<string, {files: Array}>} same module map, unchanged
 */
export function refineModuleGrouping(moduleMap, _projectRoot) {
  return moduleMap;
}
