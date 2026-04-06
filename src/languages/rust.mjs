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
  return require("tree-sitter-rust");
}

function hasVisibilityModifier(node) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === "visibility_modifier") return true;
  }
  return false;
}

function extractRustParameters(paramsNode) {
  if (!paramsNode) return [];
  const params = [];
  for (const child of paramsNode.children) {
    // Skip self parameters
    if (child.type === "self_parameter") continue;
    if (child.type === "parameter") {
      const pattern = child.childForFieldName("pattern");
      const typeNode = child.childForFieldName("type");
      params.push({
        name: pattern?.text || child.text,
        type: typeNode?.text || null,
      });
    }
  }
  return params;
}

function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");

  function processNode(node, implClassName) {
    const type = node.type;

    if (type === "function_item") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      const name = nameNode.text;
      const paramsNode = node.childForFieldName("parameters");
      const returnNode = node.childForFieldName("return_type");
      const sym = {
        name,
        kind: implClassName ? "method" : "function",
        exported: hasVisibilityModifier(node),
        signature: buildSignature(node, lines),
        parameters: extractRustParameters(paramsNode),
        returnType: returnNode?.text?.replace(/^->\s*/, "") || null,
        comment: extractPrecedingComment(node),
        ...getNodeSource(node, lines),
        usedBy: [],
      };
      if (implClassName) sym.className = implClassName;
      symbols.push(sym);
    } else if (type === "struct_item") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      symbols.push({
        name: nameNode.text,
        kind: "class",
        exported: hasVisibilityModifier(node),
        signature: buildSignature(node, lines),
        parameters: [],
        returnType: null,
        comment: extractPrecedingComment(node),
        ...getNodeSource(node, lines),
        usedBy: [],
      });
    } else if (type === "enum_item") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      symbols.push({
        name: nameNode.text,
        kind: "enum",
        exported: hasVisibilityModifier(node),
        signature: buildSignature(node, lines),
        parameters: [],
        returnType: null,
        comment: extractPrecedingComment(node),
        ...getNodeSource(node, lines),
        usedBy: [],
      });
    } else if (type === "trait_item") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      symbols.push({
        name: nameNode.text,
        kind: "interface",
        exported: hasVisibilityModifier(node),
        signature: buildSignature(node, lines),
        parameters: [],
        returnType: null,
        comment: extractPrecedingComment(node),
        ...getNodeSource(node, lines),
        usedBy: [],
      });
    } else if (type === "impl_item") {
      const typeNode = node.childForFieldName("type");
      const className = typeNode?.text || null;
      const body = node.childForFieldName("body");
      if (body) {
        for (const child of body.children) {
          processNode(child, className);
        }
      }
    } else if (type === "type_item") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      symbols.push({
        name: nameNode.text,
        kind: "type",
        exported: hasVisibilityModifier(node),
        signature: buildSignature(node, lines),
        parameters: [],
        returnType: null,
        comment: extractPrecedingComment(node),
        ...getNodeSource(node, lines),
        usedBy: [],
      });
    } else if (type === "const_item" || type === "static_item") {
      const nameNode = node.childForFieldName("name");
      if (!nameNode) return;
      symbols.push({
        name: nameNode.text,
        kind: "const",
        exported: hasVisibilityModifier(node),
        signature: buildSignature(node, lines),
        parameters: [],
        returnType: null,
        comment: extractPrecedingComment(node),
        ...getNodeSource(node, lines),
        usedBy: [],
      });
    }
  }

  for (const node of rootNode.children) {
    processNode(node, null);
  }

  return symbols;
}

function extractImports(rootNode, _source) {
  const imports = [];

  for (const node of rootNode.children) {
    if (node.type !== "use_declaration") continue;
    const argument = node.childForFieldName("argument");
    if (!argument) continue;
    parseUseTree(argument, "", imports);
  }

  return imports;
}

function parseUseTree(node, prefix, imports) {
  if (node.type === "scoped_identifier" || node.type === "identifier") {
    const fullPath = prefix ? prefix + "::" + node.text : node.text;
    const lastSeg = node.text.split("::").pop();
    imports.push({ source: fullPath, symbols: [lastSeg], typeOnly: false });
  } else if (node.type === "use_wildcard") {
    const pathNode = node.childForFieldName("path");
    const fullPath = prefix ? prefix + "::" + (pathNode?.text || "") : (pathNode?.text || "");
    imports.push({ source: fullPath.replace(/::$/, ""), symbols: ["*"], typeOnly: false });
  } else if (node.type === "use_as_clause") {
    const pathNode = node.childForFieldName("path");
    const aliasNode = node.childForFieldName("alias");
    const fullPath = prefix ? prefix + "::" + (pathNode?.text || "") : (pathNode?.text || "");
    const name = aliasNode?.text || pathNode?.text?.split("::").pop() || "";
    imports.push({ source: fullPath, symbols: [name], typeOnly: false });
  } else if (node.type === "scoped_use_list") {
    const pathNode = node.childForFieldName("path");
    const listNode = node.childForFieldName("list");
    const basePath = prefix ? prefix + "::" + (pathNode?.text || "") : (pathNode?.text || "");
    if (listNode) {
      for (const child of listNode.children) {
        if (child.type === "identifier" || child.type === "scoped_identifier" ||
            child.type === "use_as_clause" || child.type === "use_wildcard" ||
            child.type === "scoped_use_list" || child.type === "self") {
          if (child.type === "self") {
            const lastSeg = basePath.split("::").pop();
            imports.push({ source: basePath, symbols: [lastSeg], typeOnly: false });
          } else if (child.type === "identifier") {
            imports.push({ source: basePath + "::" + child.text, symbols: [child.text], typeOnly: false });
          } else {
            parseUseTree(child, basePath, imports);
          }
        }
      }
    }
  }
}

const RUST_BUILTINS = new Set([
  "println", "print", "eprintln", "eprint", "format", "write", "writeln",
  "vec", "panic", "todo", "unimplemented", "assert", "assert_eq", "assert_ne",
  "dbg", "cfg", "include", "include_str", "include_bytes",
  "drop", "Box", "Vec", "String", "Ok", "Err", "Some", "None",
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

    const calls = walkBodyForCalls(bodyNode, importLookup, localSymbols, sym.name, RUST_BUILTINS, resolveRustCallee);
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

function resolveRustCallee(node, importLookup, localSymbols, builtins) {
  if (node.type === "identifier") {
    const name = node.text;
    if (builtins.has(name)) return null;
    const imp = importLookup.get(name);
    if (imp) return { name, resolvedFile: imp.resolvedPath, resolvedModule: imp.resolvedModule, isExternal: imp.resolvedModule === "external" };
    if (localSymbols.has(name)) return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    return null;
  }

  if (node.type === "field_expression") {
    const field = node.childForFieldName("field");
    return field ? { name: field.text, resolvedFile: null, resolvedModule: null, isExternal: false } : null;
  }

  if (node.type === "scoped_identifier") {
    const name = node.childForFieldName("name");
    const path = node.childForFieldName("path");
    if (!name) return null;
    if (path?.type === "identifier") {
      const imp = importLookup.get(path.text);
      if (imp) return { name: `${path.text}::${name.text}`, resolvedFile: imp.resolvedPath, resolvedModule: imp.resolvedModule, isExternal: imp.resolvedModule === "external" };
    }
    return { name: name.text, resolvedFile: null, resolvedModule: null, isExternal: false };
  }

  return null;
}

function resolveImport(importPath, fromFile, projectRoot, fileIndex) {
  // crate:: paths resolve to src/
  if (importPath.startsWith("crate::")) {
    const inner = importPath.slice(7).replace(/::/g, "/");
    const candidates = [`src/${inner}.rs`, `src/${inner}/mod.rs`, `${inner}.rs`, `${inner}/mod.rs`];
    if (fileIndex) {
      for (const c of candidates) {
        const exact = fileIndex.resolve(c);
        if (exact) return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
      }
    }
    return { resolvedPath: null, resolvedModule: "external" };
  }

  // super:: paths resolve relative to parent
  if (importPath.startsWith("super::")) {
    const inner = importPath.slice(7).replace(/::/g, "/");
    const fromDir = dirname(relative(projectRoot, fromFile));
    const parentDir = dirname(fromDir);
    const candidates = [`${parentDir}/${inner}.rs`, `${parentDir}/${inner}/mod.rs`];
    if (fileIndex) {
      for (const c of candidates) {
        const exact = fileIndex.resolve(c);
        if (exact) return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
      }
    }
    return { resolvedPath: null, resolvedModule: "external" };
  }

  // self:: paths resolve relative to current dir
  if (importPath.startsWith("self::")) {
    const inner = importPath.slice(6).replace(/::/g, "/");
    const fromDir = dirname(relative(projectRoot, fromFile));
    const candidates = [`${fromDir}/${inner}.rs`, `${fromDir}/${inner}/mod.rs`];
    if (fileIndex) {
      for (const c of candidates) {
        const exact = fileIndex.resolve(c);
        if (exact) return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
      }
    }
    return { resolvedPath: null, resolvedModule: "external" };
  }

  // External crate
  return { resolvedPath: null, resolvedModule: "external" };
}

function getModulePath(filePath, projectRoot) {
  return sharedGetModuleName(filePath, projectRoot);
}

export default {
  id: "rust",
  loadGrammar,
  extractSymbols,
  extractImports,
  extractCalls,
  resolveImport,
  getModulePath,
};
