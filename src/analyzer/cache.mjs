// Incremental analysis cache — caches parsed file results keyed by content hash.
// Stored in .codesight-cache.json in the project root.

import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { createHash } from "crypto";

const CACHE_FILE = ".codesight-cache.json";
const CACHE_VERSION = 1;

/**
 * Load the cache from disk. Returns empty cache on any error.
 */
export async function loadCache(projectRoot) {
  try {
    const raw = await readFile(resolve(projectRoot, CACHE_FILE), "utf-8");
    const data = JSON.parse(raw);
    if (data.version !== CACHE_VERSION) return createEmptyCache();
    return data;
  } catch {
    return createEmptyCache();
  }
}

/**
 * Save the cache to disk.
 */
export async function saveCache(projectRoot, cache) {
  try {
    const path = resolve(projectRoot, CACHE_FILE);
    await writeFile(path, JSON.stringify(cache), "utf-8");
  } catch (err) {
    console.warn(`  Warning: Could not write cache: ${err.message}`);
  }
}

/**
 * Hash file content for cache key.
 */
export function hashContent(content) {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

/**
 * Check if a cached entry is still valid for given content.
 */
export function getCachedParse(cache, relPath, contentHash) {
  const entry = cache.files?.[relPath];
  if (entry && entry.hash === contentHash) {
    return entry.result;
  }
  return null;
}

/**
 * Store a parse result in the cache.
 */
export function setCachedParse(cache, relPath, contentHash, result) {
  if (!cache.files) cache.files = {};
  cache.files[relPath] = {
    hash: contentHash,
    result,
  };
}

/**
 * Prune cache entries for files that no longer exist.
 */
export function pruneCache(cache, currentRelPaths) {
  if (!cache.files) return;
  const validPaths = new Set(currentRelPaths);
  for (const path of Object.keys(cache.files)) {
    if (!validPaths.has(path)) {
      delete cache.files[path];
    }
  }
}

function createEmptyCache() {
  return { version: CACHE_VERSION, files: {} };
}
