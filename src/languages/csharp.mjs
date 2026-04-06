import { resolve, dirname, relative } from "path";
import { getModuleName as sharedGetModuleName, getModuleFromRelPath } from "../analyzer/modules.mjs";
import {
  extractPrecedingComment,
  getNodeSource,
  buildSignature,
  findFunctionBody,
  walkBodyForCalls,
} from "./helpers.mjs";

function loadGrammar(require) {
  return require("tree-sitter-c-sharp");
}

function isCSharpExported(node) {
  // Walk children for modifier keywords
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === "modifier") {
      const text = child.text;
      if (text === "public" || text === "internal") return true;
      if (text === "private" || text === "protected") return false;
    }
  }
  // Default: top-level types are internal (exported), members are private (not exported)
  const parent = node.parent;
  if (!parent || parent.type === "compilation_unit" || parent.type === "namespace_declaration") return true;
  return false;
}

function extractCSharpParameters(paramsNode) {
  if (!paramsNode) return [];
  const params = [];
  for (const child of paramsNode.children) {
    if (child.type === "parameter") {
      const typeNode = child.childForFieldName("type");
      const nameNode = child.childForFieldName("name");
      params.push({
        name: nameNode?.text || child.text,
        type: typeNode?.text || null,
      });
    }
  }
  return params;
}

function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");

  function walk(node, className) {
    for (const child of node.children) {
      const type = child.type;

      if (type === "namespace_declaration") {
        const body = child.childForFieldName("body");
        if (body) walk(body, null);
        continue;
      }

      if (type === "class_declaration" || type === "struct_declaration") {
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        const name = nameNode.text;
        symbols.push({
          name,
          kind: "class",
          exported: isCSharpExported(child),
          signature: buildSignature(child, lines),
          parameters: [],
          returnType: null,
          comment: extractPrecedingComment(child),
          ...getNodeSource(child, lines),
          usedBy: [],
        });
        const body = child.childForFieldName("body");
        if (body) walk(body, name);
        continue;
      }

      if (type === "interface_declaration") {
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        symbols.push({
          name: nameNode.text,
          kind: "interface",
          exported: isCSharpExported(child),
          signature: buildSignature(child, lines),
          parameters: [],
          returnType: null,
          comment: extractPrecedingComment(child),
          ...getNodeSource(child, lines),
          usedBy: [],
        });
        continue;
      }

      if (type === "enum_declaration") {
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        symbols.push({
          name: nameNode.text,
          kind: "enum",
          exported: isCSharpExported(child),
          signature: buildSignature(child, lines),
          parameters: [],
          returnType: null,
          comment: extractPrecedingComment(child),
          ...getNodeSource(child, lines),
          usedBy: [],
        });
        continue;
      }

      if (type === "method_declaration") {
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        const paramsNode = child.childForFieldName("parameters");
        const returnNode = child.childForFieldName("type");
        symbols.push({
          name: nameNode.text,
          kind: "method",
          exported: isCSharpExported(child),
          signature: buildSignature(child, lines),
          parameters: extractCSharpParameters(paramsNode),
          returnType: returnNode?.text || null,
          comment: extractPrecedingComment(child),
          className,
          ...getNodeSource(child, lines),
          usedBy: [],
        });
        continue;
      }

      if (type === "constructor_declaration") {
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        const paramsNode = child.childForFieldName("parameters");
        symbols.push({
          name: nameNode.text,
          kind: "method",
          exported: isCSharpExported(child),
          signature: buildSignature(child, lines),
          parameters: extractCSharpParameters(paramsNode),
          returnType: null,
          comment: extractPrecedingComment(child),
          className,
          ...getNodeSource(child, lines),
          usedBy: [],
        });
        continue;
      }

      if (type === "property_declaration") {
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        const typeNode = child.childForFieldName("type");
        symbols.push({
          name: nameNode.text,
          kind: "const",
          exported: isCSharpExported(child),
          signature: buildSignature(child, lines),
          parameters: [],
          returnType: typeNode?.text || null,
          comment: extractPrecedingComment(child),
          className,
          ...getNodeSource(child, lines),
          usedBy: [],
        });
        continue;
      }
    }
  }

  walk(rootNode, null);
  return symbols;
}

function extractImports(rootNode, _source) {
  const imports = [];

  for (const node of rootNode.children) {
    if (node.type !== "using_directive") continue;
    // The name is a qualified_name or identifier
    const nameNode = node.childForFieldName("name");
    if (!nameNode) {
      // Try children directly
      for (const child of node.children) {
        if (child.type === "qualified_name" || child.type === "identifier") {
          imports.push({ source: child.text, symbols: [], typeOnly: false });
          break;
        }
      }
      continue;
    }
    imports.push({ source: nameNode.text, symbols: [], typeOnly: false });
  }

  return imports;
}

const CSHARP_BUILTINS = new Set([
  "Console", "String", "Math", "Convert", "Object", "Array",
  "List", "Dictionary", "Task", "Debug", "GC",
  "Activator", "Environment", "Int32", "Boolean", "Byte",
  "Char", "Decimal", "Double", "Single", "Int64",
  "Tuple", "Nullable", "Enum", "Type", "Attribute",
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
    if (sym.kind !== "method" && sym.kind !== "function") continue;
    const bodyNode = findSymbolBody(rootNode, sym);
    if (!bodyNode) continue;

    const calls = walkBodyForCalls(bodyNode, importLookup, localSymbols, sym.name, CSHARP_BUILTINS, resolveCSharpCallee);
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

function resolveCSharpCallee(node, importLookup, localSymbols, builtins) {
  if (node.type === "identifier") {
    const name = node.text;
    if (builtins.has(name)) return null;
    const imp = importLookup.get(name);
    if (imp) return { name, resolvedFile: imp.resolvedPath, resolvedModule: imp.resolvedModule, isExternal: imp.resolvedModule === "external" };
    if (localSymbols.has(name)) return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    return null;
  }

  if (node.type === "member_access_expression") {
    const name = node.childForFieldName("name");
    const expr = node.childForFieldName("expression");
    if (!name) return null;
    const methodName = name.text;
    if (expr?.type === "identifier") {
      if (builtins.has(expr.text)) return null;
      const imp = importLookup.get(expr.text);
      if (imp) return { name: `${expr.text}.${methodName}`, resolvedFile: imp.resolvedPath, resolvedModule: imp.resolvedModule, isExternal: imp.resolvedModule === "external" };
    }
    return null;
  }

  return null;
}

function resolveImport(importPath, fromFile, projectRoot, fileIndex) {
  // Convert dotted namespace to path: Foo.Bar.Baz → Foo/Bar/Baz
  const pathParts = importPath.split(".");
  const relPath = pathParts.join("/");

  const candidates = [
    relPath + ".cs",
    relPath,
    "src/" + relPath + ".cs",
    "src/" + relPath,
  ];

  if (fileIndex) {
    for (const c of candidates) {
      const exact = fileIndex.resolve(c);
      if (exact) return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
    }
  }

  return { resolvedPath: null, resolvedModule: "external" };
}

function getModulePath(filePath, projectRoot) {
  return sharedGetModuleName(filePath, projectRoot);
}

export default {
  id: "csharp",
  loadGrammar,
  extractSymbols,
  extractImports,
  extractCalls,
  resolveImport,
  getModulePath,
};
