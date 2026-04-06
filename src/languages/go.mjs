import { resolve, dirname, relative } from "path";
import { readFileSync } from "fs";
import { getModuleName as sharedGetModuleName, getModuleFromRelPath } from "../analyzer/modules.mjs";
import {
  extractPrecedingComment,
  getNodeSource,
  buildSignature,
  findFunctionBody,
  walkBodyForCalls,
} from "./helpers.mjs";

function loadGrammar(require) {
  return require("tree-sitter-go");
}

function isGoExported(name) {
  return name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
}

function extractGoParameters(paramsNode) {
  if (!paramsNode) return [];
  const params = [];
  for (const child of paramsNode.children) {
    if (child.type === "parameter_declaration") {
      const typeNode = child.childForFieldName("type");
      const typeName = typeNode?.text || null;
      // Go can have multiple names sharing one type: (a, b int)
      const names = [];
      for (const c of child.children) {
        if (c.type === "identifier" && c !== typeNode) names.push(c.text);
      }
      if (names.length === 0) {
        // Unnamed param (just type)
        params.push({ name: typeName || "?", type: null });
      } else {
        for (const n of names) params.push({ name: n, type: typeName });
      }
    }
  }
  return params;
}

function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");

  for (const node of rootNode.children) {
    const type = node.type;

    if (type === "function_declaration") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) continue;
      const name = nameNode.text;
      const paramsNode = node.childForFieldName("parameters");
      const resultNode = node.childForFieldName("result");
      symbols.push({
        name,
        kind: "function",
        exported: isGoExported(name),
        signature: buildSignature(node, lines),
        parameters: extractGoParameters(paramsNode),
        returnType: resultNode?.text || null,
        comment: extractPrecedingComment(node),
        ...getNodeSource(node, lines),
        usedBy: [],
      });
    } else if (type === "method_declaration") {
      const nameNode = node.childForFieldName("name");
      const receiverNode = node.childForFieldName("receiver");
      if (!nameNode) continue;
      const name = nameNode.text;
      // Extract receiver type (strip pointer *)
      let className = null;
      if (receiverNode) {
        const text = receiverNode.text.replace(/[()]/g, "").trim();
        const parts = text.split(/\s+/);
        className = (parts[parts.length - 1] || "").replace(/^\*/, "");
      }
      const paramsNode = node.childForFieldName("parameters");
      const resultNode = node.childForFieldName("result");
      symbols.push({
        name,
        kind: "method",
        exported: isGoExported(name),
        signature: buildSignature(node, lines),
        parameters: extractGoParameters(paramsNode),
        returnType: resultNode?.text || null,
        comment: extractPrecedingComment(node),
        className,
        ...getNodeSource(node, lines),
        usedBy: [],
      });
    } else if (type === "type_declaration") {
      for (const child of node.children) {
        if (child.type !== "type_spec") continue;
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        const name = nameNode.text;
        const typeBody = child.childForFieldName("type");
        let kind = "type";
        if (typeBody?.type === "struct_type") kind = "class";
        else if (typeBody?.type === "interface_type") kind = "interface";
        symbols.push({
          name,
          kind,
          exported: isGoExported(name),
          signature: buildSignature(child, lines),
          parameters: [],
          returnType: null,
          comment: extractPrecedingComment(node),
          ...getNodeSource(child, lines),
          usedBy: [],
        });
      }
    }
  }

  return symbols;
}

function extractImports(rootNode, _source) {
  const imports = [];

  for (const node of rootNode.children) {
    if (node.type !== "import_declaration") continue;

    const specs = [];
    for (const child of node.children) {
      if (child.type === "import_spec") specs.push(child);
      if (child.type === "import_spec_list") {
        for (const sc of child.children) {
          if (sc.type === "import_spec") specs.push(sc);
        }
      }
    }

    for (const spec of specs) {
      const pathNode = spec.childForFieldName("path");
      if (!pathNode) continue;
      const raw = pathNode.text.replace(/^"|"$/g, "");
      // Default import name is last path segment
      const nameNode = spec.childForFieldName("name");
      const alias = nameNode?.text;
      const defaultName = alias || raw.split("/").pop();
      imports.push({ source: raw, symbols: [defaultName], typeOnly: false });
    }
  }

  return imports;
}

const GO_BUILTINS = new Set([
  "make", "len", "cap", "append", "copy", "delete", "close",
  "panic", "recover", "print", "println", "new",
  "complex", "real", "imag", "error",
]);

function extractCalls(rootNode, symbols, fileImports) {
  const callMap = new Map();

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

  const localSymbols = new Set(symbols.map(s => s.name));

  for (const sym of symbols) {
    if (sym.kind !== "function" && sym.kind !== "method") continue;
    const bodyNode = findSymbolBody(rootNode, sym);
    if (!bodyNode) continue;

    const calls = walkBodyForCalls(bodyNode, importLookup, localSymbols, sym.name, GO_BUILTINS, resolveGoCallee);
    if (calls.length > 0) callMap.set(sym.name, calls);
  }

  return callMap;
}

function findSymbolBody(rootNode, sym) {
  const targetLine = sym.line - 1;
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

function resolveGoCallee(node, importLookup, localSymbols, builtins) {
  if (node.type === "identifier") {
    const name = node.text;
    if (builtins.has(name)) return null;
    const imp = importLookup.get(name);
    if (imp) return { name, resolvedFile: imp.resolvedPath, resolvedModule: imp.resolvedModule, isExternal: imp.resolvedModule === "external" };
    if (localSymbols.has(name)) return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    return null;
  }

  if (node.type === "selector_expression") {
    const operand = node.childForFieldName("operand");
    const field = node.childForFieldName("field");
    if (!field) return null;
    const methodName = field.text;
    if (operand?.type === "identifier") {
      const imp = importLookup.get(operand.text);
      if (imp) return { name: `${operand.text}.${methodName}`, resolvedFile: imp.resolvedPath, resolvedModule: imp.resolvedModule, isExternal: imp.resolvedModule === "external" };
    }
    return null;
  }

  return null;
}

function resolveImport(importPath, fromFile, projectRoot, fileIndex) {
  // Try to read go.mod for module prefix
  let goModPrefix = null;
  try {
    const goMod = readFileSync(resolve(projectRoot, "go.mod"), "utf-8");
    const match = goMod.match(/module\s+(\S+)/);
    if (match) goModPrefix = match[1];
  } catch {}

  // Strip module prefix if present
  let relPath = importPath;
  if (goModPrefix && importPath.startsWith(goModPrefix + "/")) {
    relPath = importPath.slice(goModPrefix.length + 1);
  } else if (goModPrefix && importPath === goModPrefix) {
    relPath = "";
  } else {
    // External package
    return { resolvedPath: null, resolvedModule: "external" };
  }

  if (fileIndex) {
    // Try direct file
    const exact = fileIndex.resolve(relPath + ".go");
    if (exact) return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
    // Try as directory (any .go file inside)
    const dirIndex = fileIndex.resolve(relPath);
    if (dirIndex) return { resolvedPath: dirIndex, resolvedModule: getModuleFromRelPath(dirIndex) };
  }

  return { resolvedPath: null, resolvedModule: "external" };
}

function getModulePath(filePath, projectRoot) {
  return sharedGetModuleName(filePath, projectRoot);
}

export default {
  id: "go",
  loadGrammar,
  extractSymbols,
  extractImports,
  extractCalls,
  resolveImport,
  getModulePath,
};
