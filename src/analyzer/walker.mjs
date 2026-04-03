import { readdir } from "fs/promises";
import { join } from "path";

const DEFAULT_IGNORE = new Set([
  "node_modules", ".git", "__pycache__", ".venv", "venv",
  "target", "dist", "build", ".next", ".cache", "vendor",
  "coverage", ".mypy_cache", ".pytest_cache", "env", ".tox",
  ".eggs", ".cargo", ".gradle", "bin", "obj", ".idea",
  ".vscode", ".DS_Store",
]);

export async function walkDir(dir, extraIgnore = []) {
  const ignore = new Set([...DEFAULT_IGNORE, ...extraIgnore]);
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

      if (entry.isDirectory()) {
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
