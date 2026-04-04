import { readdir, readFile } from "fs/promises";
import { join, relative } from "path";

const DEFAULT_IGNORE = new Set([
  "node_modules", ".git", "__pycache__", ".venv", "venv",
  "target", "dist", "build", ".next", ".cache", "vendor",
  "coverage", ".mypy_cache", ".pytest_cache", "env", ".tox",
  ".eggs", ".cargo", ".gradle", "bin", "obj", ".idea",
  ".vscode", ".DS_Store",
]);

/**
 * Parse a .gitignore file into a list of matchers.
 * Supports: exact names, directory patterns (trailing /), wildcards (*),
 * double-star prefixes (**\/), and negation (!).
 */
function parseGitignorePatterns(content) {
  const patterns = [];
  for (let line of content.split('\n')) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);

    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);

    patterns.push({ raw: line, negated, dirOnly });
  }
  return patterns;
}

/**
 * Check if a relative path matches a gitignore pattern.
 */
function matchesPattern(relPath, name, isDir, pattern) {
  const { raw, dirOnly } = pattern;
  if (dirOnly && !isDir) return false;

  // Pattern contains a slash (not just trailing) — match against full relative path
  if (raw.includes('/')) {
    // Strip leading / for root-relative patterns
    const pat = raw.startsWith('/') ? raw.slice(1) : raw;
    return globMatch(relPath, pat);
  }

  // No slash — match against the entry name only (any depth)
  return globMatch(name, raw);
}

/**
 * Simple glob matching supporting * (any chars except /) and ** (any path).
 */
function globMatch(str, pattern) {
  // Convert glob pattern to regex
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      // ** matches any path segment(s)
      re += '.*';
      i += 2;
      if (pattern[i] === '/') i++; // skip trailing slash after **
    } else if (pattern[i] === '*') {
      re += '[^/]*';
      i++;
    } else if (pattern[i] === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(pattern[i])) {
      re += '\\' + pattern[i];
      i++;
    } else {
      re += pattern[i];
      i++;
    }
  }
  return new RegExp('^' + re + '$').test(str);
}

/**
 * Check if a path should be ignored based on gitignore patterns.
 */
function isGitignored(relPath, name, isDir, patterns) {
  let ignored = false;
  for (const pattern of patterns) {
    if (matchesPattern(relPath, name, isDir, pattern)) {
      ignored = !pattern.negated;
    }
  }
  return ignored;
}

async function loadGitignore(dir) {
  try {
    const content = await readFile(join(dir, '.gitignore'), 'utf-8');
    return parseGitignorePatterns(content);
  } catch {
    return [];
  }
}

export async function walkDir(dir, extraIgnore = []) {
  const ignore = new Set([...DEFAULT_IGNORE, ...extraIgnore]);
  const gitignorePatterns = await loadGitignore(dir);
  const results = [];

  async function recurse(current) {
    const entries = await readdir(current, { withFileTypes: true });
    const promises = [];

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") {
        if (ignore.has(entry.name)) continue;
      }
      if (ignore.has(entry.name)) continue;

      const fullPath = join(current, entry.name);
      const relPath = relative(dir, fullPath);
      const isDir = entry.isDirectory();

      // Check gitignore patterns
      if (gitignorePatterns.length > 0 && isGitignored(relPath, entry.name, isDir, gitignorePatterns)) {
        continue;
      }

      if (isDir) {
        promises.push(recurse(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }

    await Promise.all(promises);
  }

  await recurse(dir);
  return results;
}
