const EXTENSION_MAP = {
  ".ts":   "typescript",
  ".tsx":  "typescript",
  ".js":   "javascript",
  ".jsx":  "javascript",
  ".mjs":  "javascript",
  ".cjs":  "javascript",
  ".py":   "python",
};

export function detectLanguage(filePath) {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filePath.slice(dot).toLowerCase();
  return EXTENSION_MAP[ext] || null;
}

export function getSupportedExtensions() {
  return Object.keys(EXTENSION_MAP);
}
