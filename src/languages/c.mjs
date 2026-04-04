import { resolve, dirname, relative } from "path";
import { getModuleName as sharedGetModuleName, getModuleFromRelPath } from "../analyzer/modules.mjs";
import {
  extractPrecedingComment,
  extractParameters as helpersExtractParameters,
  getNodeSource,
  isExported,
  buildSignature,
  findFunctionBody,
  walkBodyForCalls,
} from "./helpers.mjs";

function loadGrammar(require) {
  return require("tree-sitter-c");
}

function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");

  for (const node of rootNode.children) {
    const type = node.type;

    if (type === "function_definition") {
      const sym = extractFunctionDef(node, lines);
      if (sym) symbols.push(sym);
    } else if (type === "struct_specifier" || type === "union_specifier" || type === "enum_specifier") {
      const sym = extractStructLike(node, lines);
      if (sym) symbols.push(sym);
    } else if (type === "type_definition") {
      const sym = extractTypedef(node, lines);
      if (sym) symbols.push(sym);
    } else if (type === "declaration") {
      const sym = extractTopLevelDeclaration(node, lines);
      if (sym) symbols.push(sym);
    }
  }

  return symbols;
}

function extractFunctionDef(node, lines) {
  // function_definition: type declarator(function_declarator) body
  const declaratorNode = node.childForFieldName("declarator");
  if (!declaratorNode) return null;

  // declarator is a function_declarator with its own declarator (the name) and parameters
  let nameNode = declaratorNode;
  let paramsNode = null;

  if (declaratorNode.type === "function_declarator") {
    nameNode = declaratorNode.childForFieldName("declarator");
    paramsNode = declaratorNode.childForFieldName("parameters");
  } else if (declaratorNode.type === "pointer_declarator") {
    // *funcname(...) — dig through pointer_declarator
    const inner = declaratorNode.childForFieldName("declarator");
    if (inner && inner.type === "function_declarator") {
      nameNode = inner.childForFieldName("declarator");
      paramsNode = inner.childForFieldName("parameters");
    }
  }

  const name = nameNode?.text;
  if (!name) return null;

  const typeNode = node.childForFieldName("type");
  const returnType = typeNode?.text || null;
  const parameters = helpersExtractParameters(paramsNode, { typeFirst: true });
  const exported = isExported(node, "c");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature(node, lines);

  return {
    name,
    kind: "function",
    exported,
    signature,
    parameters,
    returnType,
    comment,
    source,
    line,
    usedBy: [],
  };
}

function extractStructLike(node, lines) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;

  const name = nameNode.text;
  const exported = isExported(node, "c");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature(node, lines);

  return {
    name,
    kind: "class",
    exported,
    signature,
    parameters: [],
    returnType: null,
    comment,
    source,
    line,
    usedBy: [],
  };
}

function extractTypedef(node, lines) {
  // typedef ... name;
  // The name is typically the last identifier child (before the semicolon)
  let name = null;
  for (let i = node.childCount - 1; i >= 0; i--) {
    const child = node.child(i);
    if (child.type === "type_identifier" || child.type === "identifier") {
      name = child.text;
      break;
    }
    // Handle pointer declarators: typedef struct foo *bar_t;
    if (child.type === "pointer_declarator") {
      const inner = child.childForFieldName("declarator");
      if (inner) {
        name = inner.text;
        break;
      }
    }
  }

  if (!name) return null;

  const exported = isExported(node, "c");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature(node, lines);

  return {
    name,
    kind: "type",
    exported,
    signature,
    parameters: [],
    returnType: null,
    comment,
    source,
    line,
    usedBy: [],
  };
}

function extractTopLevelDeclaration(node, lines) {
  // Top-level declaration with init_declarator (e.g. const int x = 5;)
  let hasInit = false;
  let nameText = null;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === "init_declarator") {
      hasInit = true;
      const declarator = child.childForFieldName("declarator");
      nameText = declarator?.text?.replace(/^\*+/, "") || null;
      break;
    }
  }

  if (!hasInit || !nameText) return null;

  // Check for const qualifier in the type specifiers
  let isConst = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === "type_qualifier" && child.text === "const") {
      isConst = true;
      break;
    }
  }

  const exported = isExported(node, "c");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = lines[node.startPosition.row]?.trim() || "";

  return {
    name: nameText,
    kind: "const",
    exported,
    signature: signature.length > 150 ? signature.slice(0, 147) + "..." : signature,
    parameters: [],
    returnType: null,
    comment,
    source,
    line,
    usedBy: [],
  };
}

function extractImports(rootNode, _source) {
  const imports = [];

  for (const node of rootNode.children) {
    if (node.type !== "preproc_include") continue;

    const pathNode = node.childForFieldName("path");
    if (!pathNode) continue;

    if (pathNode.type === "string_literal") {
      // Local include: #include "foo.h"
      const raw = pathNode.text.replace(/^"|"$/g, "");
      imports.push({ source: raw, symbols: [], typeOnly: false });
    } else if (pathNode.type === "system_lib_string") {
      // System include: #include <stdio.h>
      const raw = pathNode.text.replace(/^<|>$/g, "");
      imports.push({ source: raw, symbols: [], typeOnly: false, isSystem: true });
    }
  }

  return imports;
}

const C_BUILTINS = new Set([
  "printf", "fprintf", "sprintf", "snprintf",
  "scanf",
  "malloc", "calloc", "realloc", "free",
  "memcpy", "memset", "memmove",
  "strlen", "strcmp", "strncmp", "strcpy", "strcat",
  "exit", "abort", "assert",
]);

function extractCalls(rootNode, symbols, fileImports) {
  const callMap = new Map();

  // Build import lookup: local name → { source, resolvedPath, resolvedModule }
  const importLookup = new Map();
  for (const imp of fileImports) {
    for (const sym of imp.symbols) {
      importLookup.set(sym, {
        source: imp.source,
        resolvedPath: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
      });
    }
  }

  // Build local symbol lookup
  const localSymbols = new Set(symbols.map(s => s.name));

  for (const sym of symbols) {
    if (sym.kind !== "function") continue;

    const bodyNode = findSymbolBody(rootNode, sym);
    if (!bodyNode) continue;

    const calls = walkBodyForCalls(bodyNode, importLookup, localSymbols, sym.name, C_BUILTINS, resolveCCallee);
    if (calls.length > 0) {
      callMap.set(sym.name, calls);
    }
  }

  return callMap;
}

function findSymbolBody(rootNode, sym) {
  const targetLine = sym.line - 1; // sym.line is 1-indexed

  function search(node) {
    if (node.startPosition.row === targetLine) {
      const body = findFunctionBody(node);
      if (body) return body;
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.startPosition.row <= targetLine && child.endPosition.row >= targetLine) {
        const result = search(child);
        if (result) return result;
      }
    }
    return null;
  }

  return search(rootNode);
}

function resolveCCallee(node, importLookup, localSymbols, builtins) {
  if (node.type === "identifier") {
    const name = node.text;
    if (builtins.has(name)) return null;

    // Check imported symbols
    const imp = importLookup.get(name);
    if (imp) {
      return {
        name,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === "external",
      };
    }

    // Check local symbols
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }

    return null;
  }

  if (node.type === "field_expression") {
    // struct->method or struct.method calls
    const obj = node.childForFieldName("argument");
    const field = node.childForFieldName("field");
    if (!field) return null;

    const methodName = field.text;

    if (obj?.type === "identifier") {
      const imp = importLookup.get(obj.text);
      if (imp) {
        return {
          name: `${obj.text}.${methodName}`,
          resolvedFile: imp.resolvedPath,
          resolvedModule: imp.resolvedModule,
          isExternal: imp.resolvedModule === "external",
        };
      }
    }

    return null;
  }

  return null;
}

function resolveImport(importPath, fromFile, projectRoot, fileIndex) {
  // System includes resolve to external
  if (importPath.includes("/") === false && !importPath.startsWith(".")) {
    // Could be system — but we rely on the isSystem flag from extractImports.
    // Check the raw fileImports for isSystem flag is done at a higher level;
    // here we try to resolve it as a local path first.
  }

  // Try resolving relative to the including file
  const candidates = [
    resolve(dirname(fromFile), importPath),
    resolve(projectRoot, importPath),
    resolve(projectRoot, "include", importPath),
    resolve(projectRoot, "src", importPath),
    resolve(projectRoot, "lib", importPath),
  ];

  for (const candidate of candidates) {
    const rel = relative(projectRoot, candidate);
    if (rel.startsWith("..")) continue;

    if (fileIndex) {
      const exact = fileIndex.resolve(rel);
      if (exact) {
        return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
      }
    }
  }

  // If nothing resolved, treat as external
  return { resolvedPath: null, resolvedModule: "external" };
}

function getModulePath(filePath, projectRoot) {
  return sharedGetModuleName(filePath, projectRoot);
}

export default {
  id: "c",
  loadGrammar,
  extractSymbols,
  extractImports,
  extractCalls,
  resolveImport,
  getModulePath,
};
