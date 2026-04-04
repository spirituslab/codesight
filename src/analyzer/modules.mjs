// Module grouping logic — maps file paths to semantic module names.

import { relative } from "path";

const SKIP_DIRS = new Set([]);
const MONOREPO_DIRS = new Set(["packages", "apps", "services", "libs", "modules"]);

// Threshold: if a single module has more files than this, try splitting into 2-level
const SPLIT_THRESHOLD = 15;

/**
 * Compute module name for a file path.
 * Returns a string like "auth", "services/auth", "packages/core", or "root".
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

  const firstDir = parts[0];

  // Monorepo pattern: packages/foo/..., apps/bar/...
  // Use 2-level: packages/foo
  if (MONOREPO_DIRS.has(firstDir) && parts.length > 2) {
    return `${firstDir}/${parts[1]}`;
  }

  // Module = first directory (e.g. src, web, vscode, tests)
  return firstDir;
}

/**
 * Post-process module grouping: split oversized modules into 2-level names.
 * Called after initial grouping to refine modules that are too large.
 *
 * @param {Map<string, {files: Array}>} moduleMap - module name → { files, ... }
 * @param {string} projectRoot - project root
 * @returns {Map<string, {files: Array}>} refined module map
 */
export function refineModuleGrouping(moduleMap, projectRoot) {
  const refined = new Map();

  for (const [moduleName, data] of moduleMap) {
    if (moduleName === "root" || data.files.length <= SPLIT_THRESHOLD) {
      refined.set(moduleName, data);
      continue;
    }

    // Check if files span multiple subdirectories — if so, split
    const subdirCounts = new Map();
    for (const file of data.files) {
      const rel = file.path;
      const parts = rel.split("/");

      // Find where the module name ends in the path
      let moduleDepth = 0;
      const skipParts = rel.split("/");
      for (const p of skipParts) {
        if (SKIP_DIRS.has(p)) { moduleDepth++; continue; }
        moduleDepth++; // the module dir itself
        break;
      }

      // Get the next directory component after the module
      if (moduleDepth < parts.length - 1) {
        const subdir = parts[moduleDepth];
        subdirCounts.set(subdir, (subdirCounts.get(subdir) || 0) + 1);
      }
    }

    // Only split if there are multiple meaningful subdirectories
    if (subdirCounts.size >= 2) {
      const rootOverflow = [];
      for (const file of data.files) {
        const rel = file.path;
        const parts = rel.split("/");

        let moduleDepth = 0;
        for (const p of parts) {
          if (SKIP_DIRS.has(p)) { moduleDepth++; continue; }
          moduleDepth++;
          break;
        }

        if (moduleDepth < parts.length - 1) {
          const subModuleName = `${moduleName}/${parts[moduleDepth]}`;
          if (!refined.has(subModuleName)) {
            refined.set(subModuleName, { files: [], lineCount: 0, languages: new Set() });
          }
          const mod = refined.get(subModuleName);
          mod.files.push(file);
          mod.lineCount += file.lineCount;
          mod.languages.add(file.language);
        } else {
          // File sits directly in the module dir (no subdirectory) — treat as root
          rootOverflow.push(file);
        }
      }
      // Keep lone files in the original module (as a standalone entry in the group)
      if (rootOverflow.length > 0) {
        const langSet = new Set();
        let lc = 0;
        for (const file of rootOverflow) { lc += file.lineCount; langSet.add(file.language); }
        refined.set(moduleName, { files: rootOverflow, lineCount: lc, languages: langSet });
      }
    } else {
      refined.set(moduleName, data);
    }
  }

  return refined;
}
