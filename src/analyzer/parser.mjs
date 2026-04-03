import { createRequire } from "module";
import { getLanguage } from "../languages/index.mjs";

const require = createRequire(import.meta.url);
const Parser = require("tree-sitter");

const parserCache = new Map();

function getParser(langId) {
  if (parserCache.has(langId)) return parserCache.get(langId);

  const lang = getLanguage(langId);
  if (!lang) return null;

  const parser = new Parser();
  const grammar = lang.loadGrammar(require);
  parser.setLanguage(grammar);
  parserCache.set(langId, { parser, lang });
  return { parser, lang };
}

export function parseFile(content, langId) {
  const cached = getParser(langId);
  if (!cached) return null;

  const { parser, lang } = cached;
  // Use callback-based parsing to avoid tree-sitter 0.21 string length limit
  const tree = parser.parse((index) => content.slice(index, index + 4096));
  const rootNode = tree.rootNode;

  const symbols = lang.extractSymbols(rootNode, content);
  const imports = lang.extractImports(rootNode, content);

  return { symbols, imports, rootNode, content };
}
