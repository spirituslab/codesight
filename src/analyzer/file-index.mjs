// File path index for accurate import resolution.
// Maps multiple path variants (with/without extension, /index barrel) to canonical relative paths.

import { dirname, resolve, relative } from "path";

const TS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const PY_EXTENSIONS = [".py"];
const INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs"];
const PY_INIT_FILES = ["__init__.py"];

/**
 * Build a file index from all known project file paths.
 * @param {string[]} absolutePaths - all file paths (absolute)
 * @param {string} projectRoot - project root (absolute)
 * @returns {FileIndex}
 */
export function buildFileIndex(absolutePaths, projectRoot) {
  // Map: normalized relative path (no extension) → canonical relative path
  const byPathNoExt = new Map();
  // Map: exact relative path → true
  const byExactPath = new Map();
  // Map: directory path → index/init file relative path (for barrel/package imports)
  const byDirIndex = new Map();

  for (const absPath of absolutePaths) {
    const rel = relative(projectRoot, absPath);
    byExactPath.set(rel, rel);

    // Strip extension for extensionless lookups
    const noExt = rel.replace(/\.[^./]+$/, "");
    // Only set if not already set (first file wins for same base path — but this
    // shouldn't happen in practice since file names are unique)
    if (!byPathNoExt.has(noExt)) {
      byPathNoExt.set(noExt, rel);
    }

    // Check if this is an index/init file (barrel import target)
    const fileName = rel.split("/").pop();
    if (INDEX_FILES.includes(fileName) || PY_INIT_FILES.includes(fileName)) {
      const dir = dirname(rel);
      if (dir !== ".") {
        byDirIndex.set(dir, rel);
      }
    }
  }

  return {
    /**
     * Resolve a path (relative to project root, no extension) to the actual file.
     * Tries: exact match, extension probing, directory index/init file.
     * @param {string} pathNoExt - resolved path relative to project root, without extension
     * @returns {string|null} canonical relative path, or null
     */
    resolve(pathNoExt) {
      if (!pathNoExt) return null;

      // 1. Exact match (path already has extension)
      if (byExactPath.has(pathNoExt)) return pathNoExt;

      // 2. Extensionless match
      if (byPathNoExt.has(pathNoExt)) return byPathNoExt.get(pathNoExt);

      // 3. Directory index/init (barrel import: import from './components' → ./components/index.ts)
      if (byDirIndex.has(pathNoExt)) return byDirIndex.get(pathNoExt);

      return null;
    },

    /**
     * Check if a relative path exists in the project.
     */
    has(relPath) {
      return byExactPath.has(relPath);
    },

    /**
     * Get all known relative paths.
     */
    allPaths() {
      return [...byExactPath.keys()];
    },
  };
}
