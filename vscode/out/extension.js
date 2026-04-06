var importMetaUrl = require("url").pathToFileURL(__filename).href;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// ../src/analyzer/modules.mjs
function getModuleName(filePath, projectRoot) {
  const rel = (0, import_path2.relative)(projectRoot, filePath);
  return getModuleFromRelPath(rel);
}
function getModuleFromRelPath(relPath) {
  const parts = relPath.split("/");
  if (parts.length <= 1) return "root";
  return parts[0];
}
function refineModuleGrouping(moduleMap, _projectRoot) {
  return moduleMap;
}
var import_path2;
var init_modules = __esm({
  "../src/analyzer/modules.mjs"() {
    import_path2 = require("path");
  }
});

// ../src/languages/typescript.mjs
function loadGrammar(require3) {
  return require3("tree-sitter-typescript").typescript;
}
function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");
  for (const node of rootNode.children) {
    let decl = node;
    let exported = false;
    if (node.type === "export_statement") {
      decl = node.childForFieldName("declaration");
      exported = true;
      if (!decl) continue;
    }
    const sym = extractDeclaration(decl, lines, exported);
    if (sym) {
      symbols.push(sym);
      if (sym.kind === "class") {
        const methods = extractClassMethods(decl, lines, sym.name);
        symbols.push(...methods);
      }
    }
  }
  return symbols;
}
function extractClassMethods(classNode, lines, className) {
  const methods = [];
  const body = classNode.childForFieldName("body");
  if (!body) return methods;
  for (const member of body.children) {
    if (member.type !== "method_definition") continue;
    const nameNode = member.childForFieldName("name");
    if (!nameNode) continue;
    const name = nameNode.text;
    if (name === "constructor") continue;
    const parameters = extractParameters(member.childForFieldName("parameters"));
    const returnType = extractReturnType(member);
    const comment = extractComment(member, lines);
    const startLine = member.startPosition.row;
    const endLine = member.endPosition.row;
    const source = lines.slice(startLine, endLine + 1).join("\n");
    methods.push({
      name,
      kind: "method",
      exported: false,
      className,
      signature: buildSignature(member, lines),
      parameters,
      returnType,
      comment,
      source,
      line: startLine + 1,
      usedBy: []
    });
  }
  return methods;
}
function extractDeclaration(node, lines, exported) {
  const type = node.type;
  let kind, name, parameters, returnType, signature, comment;
  if (type === "function_declaration" || type === "generator_function_declaration") {
    kind = "function";
    name = node.childForFieldName("name")?.text;
    parameters = extractParameters(node.childForFieldName("parameters"));
    returnType = extractReturnType(node);
    signature = buildSignature(node, lines);
  } else if (type === "class_declaration") {
    kind = "class";
    name = node.childForFieldName("name")?.text;
    parameters = [];
    returnType = null;
    signature = extractClassSignature(node, lines);
  } else if (type === "interface_declaration") {
    kind = "interface";
    name = node.childForFieldName("name")?.text;
    parameters = [];
    returnType = null;
    signature = extractBlockSignature(node, lines);
  } else if (type === "type_alias_declaration") {
    kind = "type";
    name = node.childForFieldName("name")?.text;
    parameters = [];
    returnType = null;
    signature = extractBlockSignature(node, lines);
  } else if (type === "enum_declaration") {
    kind = "enum";
    name = node.childForFieldName("name")?.text;
    parameters = [];
    returnType = null;
    signature = extractBlockSignature(node, lines);
  } else if (type === "lexical_declaration") {
    const declarator = node.children.find((c) => c.type === "variable_declarator");
    if (!declarator) return null;
    name = declarator.childForFieldName("name")?.text;
    const value = declarator.childForFieldName("value");
    if (value && (value.type === "arrow_function" || value.type === "function")) {
      kind = "function";
      parameters = extractParameters(value.childForFieldName("parameters"));
      returnType = extractReturnType(value) || extractTypeAnnotation(declarator);
      signature = buildConstFnSignature(node, lines);
    } else {
      kind = "const";
      parameters = [];
      returnType = extractTypeAnnotation(declarator);
      signature = lines[node.startPosition.row]?.trim() || "";
      if (signature.length > 150) signature = signature.slice(0, 147) + "...";
    }
  } else {
    return null;
  }
  if (!name) return null;
  comment = extractComment(node, lines);
  const startLine = node.startPosition.row;
  const endLine = node.endPosition.row;
  let source = lines.slice(startLine, endLine + 1).join("\n");
  return {
    name,
    kind,
    exported,
    signature,
    parameters,
    returnType,
    comment,
    source,
    line: node.startPosition.row + 1,
    usedBy: []
  };
}
function extractParameters(paramsNode) {
  if (!paramsNode) return [];
  const params = [];
  for (const child of paramsNode.children) {
    if (child.type === "required_parameter" || child.type === "optional_parameter") {
      const pattern = child.childForFieldName("pattern");
      const typeNode = child.childForFieldName("type");
      params.push({
        name: pattern?.text || child.text,
        type: typeNode?.text?.replace(/^:\s*/, "") || null
      });
    } else if (child.type === "identifier") {
      params.push({ name: child.text, type: null });
    } else if (child.type === "rest_parameter") {
      const nameNode = child.children.find((c) => c.type === "identifier");
      const typeNode = child.childForFieldName("type");
      params.push({
        name: "..." + (nameNode?.text || ""),
        type: typeNode?.text?.replace(/^:\s*/, "") || null
      });
    }
  }
  return params;
}
function extractReturnType(node) {
  const typeAnnotation = node.children?.find((c) => c.type === "type_annotation" && c.startPosition.row >= (node.childForFieldName("parameters")?.endPosition?.row || 0));
  if (typeAnnotation) {
    return typeAnnotation.text.replace(/^:\s*/, "");
  }
  return null;
}
function extractTypeAnnotation(declarator) {
  const typeNode = declarator.childForFieldName("type");
  if (typeNode) return typeNode.text.replace(/^:\s*/, "");
  return null;
}
function buildSignature(node, lines) {
  const startLine = node.startPosition.row;
  let sig = "";
  for (let i = startLine; i < Math.min(lines.length, startLine + 15); i++) {
    sig += (sig ? " " : "") + lines[i].trim();
    if (sig.includes("{")) {
      sig = sig.slice(0, sig.indexOf("{")).trim();
      break;
    }
  }
  return sig;
}
function buildConstFnSignature(node, lines) {
  const startLine = node.startPosition.row;
  let sig = "";
  let depth = 0;
  let seenParen = false;
  for (let i = startLine; i < Math.min(lines.length, startLine + 15); i++) {
    sig += (sig ? " " : "") + lines[i].trim();
    for (const ch of lines[i]) {
      if (ch === "(") {
        depth++;
        seenParen = true;
      }
      if (ch === ")") depth--;
    }
    if (seenParen && depth <= 0) {
      const arrowIdx = sig.indexOf("=>");
      if (arrowIdx !== -1) {
        sig = sig.slice(0, arrowIdx + 2).trim();
      } else if (sig.includes("{")) {
        sig = sig.slice(0, sig.indexOf("{")).trim();
      }
      break;
    }
  }
  return sig;
}
function extractClassSignature(node, lines) {
  return lines[node.startPosition.row]?.trim()?.replace(/\{[\s\S]*$/, "").trim() || "";
}
function extractBlockSignature(node, lines) {
  const startLine = node.startPosition.row;
  const endLine = Math.min(node.endPosition.row, startLine + 20, lines.length - 1);
  const block = [];
  let braceDepth = 0;
  let started = false;
  for (let i = startLine; i <= endLine; i++) {
    block.push(lines[i]);
    for (const ch of lines[i]) {
      if (ch === "{" || ch === "=") started = true;
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }
    if (started && braceDepth <= 0) break;
  }
  const sig = block.join("\n").trim();
  if (sig.length > 500) return sig.slice(0, 497) + "...";
  return sig;
}
function extractComment(node, lines) {
  const prev = node.previousNamedSibling;
  if (!prev) return "";
  if (prev.type === "comment") {
    return prev.text.replace(/^\/\*\*?\s*/, "").replace(/\*\/\s*$/, "").replace(/^\s*\*\s?/gm, "").trim();
  }
  return "";
}
function extractImports(rootNode, _source) {
  const imports = [];
  for (const node of rootNode.children) {
    if (node.type === "import_statement") {
      const sourceNode = node.childForFieldName("source");
      if (!sourceNode) continue;
      const source = sourceNode.text.replace(/['"]/g, "");
      const symbols = [];
      let typeOnly = false;
      if (node.text.startsWith("import type")) typeOnly = true;
      const clause = node.children.find((c) => c.type === "import_clause");
      if (clause) {
        for (const child of clause.children) {
          if (child.type === "identifier") {
            symbols.push(child.text);
          } else if (child.type === "named_imports") {
            for (const spec of child.children) {
              if (spec.type === "import_specifier") {
                const alias = spec.childForFieldName("alias");
                const name = spec.childForFieldName("name");
                symbols.push(alias?.text || name?.text || spec.text);
              }
            }
          } else if (child.type === "namespace_import") {
            const nameNode = child.children.find((c) => c.type === "identifier");
            symbols.push(nameNode?.text || "*");
          }
        }
      }
      imports.push({ source, symbols, typeOnly });
    } else if (node.type === "export_statement") {
      const sourceNode = node.childForFieldName("source");
      if (sourceNode) {
        const source = sourceNode.text.replace(/['"]/g, "");
        const symbols = [];
        const clause = node.children.find((c) => c.type === "export_clause");
        if (clause) {
          for (const spec of clause.children) {
            if (spec.type === "export_specifier") {
              const name = spec.childForFieldName("name");
              symbols.push(name?.text || spec.text);
            }
          }
        }
        imports.push({ source, symbols, typeOnly: false });
      }
    }
  }
  return imports;
}
function extractCalls(rootNode, symbols, fileImports) {
  const callMap = /* @__PURE__ */ new Map();
  const importLookup = /* @__PURE__ */ new Map();
  for (const imp of fileImports) {
    for (const sym of imp.symbols) {
      importLookup.set(sym, {
        source: imp.source,
        resolvedPath: imp.resolvedPath,
        resolvedModule: imp.resolvedModule
      });
    }
  }
  const localSymbols = new Set(symbols.map((s) => s.name));
  for (const sym of symbols) {
    if (sym.kind !== "function" && sym.kind !== "method") continue;
    const bodyNode = findSymbolBody(rootNode, sym);
    if (!bodyNode) continue;
    const calls = [];
    const seen = /* @__PURE__ */ new Set();
    walkForCalls(bodyNode, calls, seen, importLookup, localSymbols, sym.name);
    if (calls.length > 0) {
      callMap.set(sym.name, calls);
    }
  }
  return callMap;
}
function findSymbolBody(rootNode, sym) {
  const targetLine = sym.line - 1;
  function search(node) {
    if (node.startPosition.row === targetLine) {
      const body = findBody(node);
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
  function findBody(node) {
    const body = node.childForFieldName("body");
    if (body) return body;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "variable_declarator") {
        const value = child.childForFieldName("value");
        if (value && (value.type === "arrow_function" || value.type === "function")) {
          return value.childForFieldName("body") || value;
        }
      }
    }
    return null;
  }
  return search(rootNode);
}
function walkForCalls(node, calls, seen, importLookup, localSymbols, callerName) {
  if (node.type === "call_expression" || node.type === "new_expression") {
    const callee = node.type === "new_expression" ? node.children.find((c) => c.type === "identifier" || c.type === "member_expression") : node.childForFieldName("function") || node.children[0];
    if (callee) {
      const callInfo = resolveCallee(callee, importLookup, localSymbols);
      if (callInfo && callInfo.name !== callerName) {
        const key = `${callInfo.name}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);
          calls.push({
            name: callInfo.name,
            resolvedFile: callInfo.resolvedFile,
            resolvedModule: callInfo.resolvedModule,
            line: node.startPosition.row + 1,
            isExternal: callInfo.isExternal
          });
        }
      }
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    walkForCalls(node.child(i), calls, seen, importLookup, localSymbols, callerName);
  }
}
function resolveCallee(node, importLookup, localSymbols) {
  const SKIP = /* @__PURE__ */ new Set(["console", "process", "JSON", "Math", "Object", "Array", "Promise", "Error", "Date", "Map", "Set", "RegExp", "parseInt", "parseFloat", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "require"]);
  if (node.type === "identifier") {
    const name = node.text;
    if (SKIP.has(name)) return null;
    const imp = importLookup.get(name);
    if (imp) {
      return {
        name,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === "external" && !imp.source?.startsWith("@/")
      };
    }
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    return null;
  }
  if (node.type === "member_expression") {
    const obj = node.childForFieldName("object");
    const prop = node.childForFieldName("property");
    if (!prop) return null;
    const methodName = prop.text;
    if (obj?.type === "identifier" && SKIP.has(obj.text)) return null;
    if (obj?.type === "this" || obj?.type === "super") {
      return { name: methodName, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    if (obj?.type === "identifier") {
      const imp = importLookup.get(obj.text);
      if (imp) {
        return {
          name: `${obj.text}.${methodName}`,
          resolvedFile: imp.resolvedPath,
          resolvedModule: imp.resolvedModule,
          isExternal: imp.resolvedModule === "external" && !imp.source?.startsWith("@/")
        };
      }
    }
    return null;
  }
  return null;
}
function resolveImport(importPath, fromFile, projectRoot, fileIndex) {
  if (!importPath.startsWith(".") && !importPath.startsWith("/") && fileIndex?.tsconfig) {
    const aliased = resolvePathAlias(importPath, projectRoot, fileIndex.tsconfig, fileIndex);
    if (aliased) return aliased;
  }
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return { resolvedPath: null, resolvedModule: "external" };
  }
  const resolved = (0, import_path3.resolve)((0, import_path3.dirname)(fromFile), importPath).replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "");
  const rel = (0, import_path3.relative)(projectRoot, resolved);
  if (rel.startsWith("..")) {
    return { resolvedPath: null, resolvedModule: "external" };
  }
  if (fileIndex) {
    const exact = fileIndex.resolve(rel);
    if (exact) {
      return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
    }
  }
  return { resolvedPath: rel, resolvedModule: getModuleFromRelPath(rel) };
}
function resolvePathAlias(importPath, projectRoot, tsconfig, fileIndex) {
  const { paths, baseUrl } = tsconfig;
  if (!paths) return null;
  const base = baseUrl ? (0, import_path3.resolve)(projectRoot, baseUrl) : projectRoot;
  for (const [pattern, targets] of Object.entries(paths)) {
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      if (importPath.startsWith(prefix + "/")) {
        const rest = importPath.slice(prefix.length + 1);
        for (const target of targets) {
          if (target.endsWith("/*")) {
            const targetDir = target.slice(0, -2);
            const resolved = (0, import_path3.resolve)(base, targetDir, rest).replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "");
            const rel = (0, import_path3.relative)(projectRoot, resolved);
            if (!rel.startsWith("..") && fileIndex) {
              const exact = fileIndex.resolve(rel);
              if (exact) {
                return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
              }
            }
          }
        }
      }
    } else if (pattern === importPath) {
      for (const target of targets) {
        const resolved = (0, import_path3.resolve)(base, target).replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "");
        const rel = (0, import_path3.relative)(projectRoot, resolved);
        if (!rel.startsWith("..") && fileIndex) {
          const exact = fileIndex.resolve(rel);
          if (exact) {
            return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
          }
        }
      }
    }
  }
  return null;
}
function getModulePath(filePath, projectRoot) {
  return getModuleName(filePath, projectRoot);
}
var import_path3, typescript_default;
var init_typescript = __esm({
  "../src/languages/typescript.mjs"() {
    import_path3 = require("path");
    init_modules();
    typescript_default = {
      id: "typescript",
      loadGrammar,
      extractSymbols,
      extractImports,
      extractCalls,
      resolveImport,
      getModulePath
    };
  }
});

// ../src/languages/python.mjs
function loadGrammar2(require3) {
  return require3("tree-sitter-python");
}
function extractSymbols2(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");
  for (const node of rootNode.children) {
    let defNode = node;
    let decoratedNode = null;
    if (node.type === "decorated_definition") {
      defNode = node.children.find(
        (c) => c.type === "function_definition" || c.type === "class_definition"
      );
      decoratedNode = node;
      if (!defNode) continue;
    }
    const sym = extractDef(defNode, lines, decoratedNode);
    if (sym) {
      symbols.push(sym);
      if (sym.kind === "class") {
        const methods = extractClassMethods2(defNode, lines, sym.name);
        symbols.push(...methods);
      }
    }
  }
  return symbols;
}
function extractClassMethods2(classNode, lines, className) {
  const methods = [];
  const body = classNode.childForFieldName("body");
  if (!body) return methods;
  for (const child of body.children) {
    let methodNode = child;
    let decoratedNode = null;
    if (child.type === "decorated_definition") {
      methodNode = child.children.find((c) => c.type === "function_definition");
      decoratedNode = child;
      if (!methodNode) continue;
    }
    if (methodNode.type !== "function_definition") continue;
    const name = methodNode.childForFieldName("name")?.text;
    if (!name || name === "__init__" || name.startsWith("_")) continue;
    const parameters = extractParameters2(methodNode.childForFieldName("parameters"));
    const returnType = methodNode.childForFieldName("return_type")?.text?.replace(/^\s*->\s*/, "") || null;
    const comment = extractDocstring(methodNode) || extractComment2(decoratedNode || methodNode, lines);
    const startLine = (decoratedNode || methodNode).startPosition.row;
    const endLine = methodNode.endPosition.row;
    const source = lines.slice(startLine, endLine + 1).join("\n");
    methods.push({
      name,
      kind: "method",
      exported: false,
      className,
      signature: buildFnSignature(methodNode, lines, decoratedNode),
      parameters,
      returnType,
      comment,
      source,
      line: startLine + 1,
      usedBy: []
    });
  }
  return methods;
}
function extractDef(node, lines, decoratedNode) {
  const type = node.type;
  const commentNode = decoratedNode || node;
  function getSource(n) {
    const dn = decoratedNode || n;
    const startLine = dn.startPosition.row;
    const endLine = n.endPosition.row;
    return lines.slice(startLine, endLine + 1).join("\n");
  }
  if (type === "function_definition") {
    const name = node.childForFieldName("name")?.text;
    if (!name) return null;
    const parameters = extractParameters2(node.childForFieldName("parameters"));
    const returnType = node.childForFieldName("return_type")?.text?.replace(/^\s*->\s*/, "") || null;
    const signature = buildFnSignature(node, lines, decoratedNode);
    const comment = extractDocstring(node) || extractComment2(commentNode, lines);
    const exported = !name.startsWith("_");
    return {
      name,
      kind: "function",
      exported,
      signature,
      parameters,
      returnType,
      comment,
      source: getSource(node),
      line: (decoratedNode || node).startPosition.row + 1,
      usedBy: []
    };
  }
  if (type === "class_definition") {
    const name = node.childForFieldName("name")?.text;
    if (!name) return null;
    const signature = lines[node.startPosition.row]?.trim()?.replace(/:\s*$/, "") || "";
    const comment = extractDocstring(node) || extractComment2(commentNode, lines);
    const exported = !name.startsWith("_");
    return {
      name,
      kind: "class",
      exported,
      signature,
      parameters: [],
      returnType: null,
      comment,
      source: getSource(node),
      line: (decoratedNode || node).startPosition.row + 1,
      usedBy: []
    };
  }
  if (type === "expression_statement") {
    const assignment = node.children.find((c) => c.type === "assignment");
    if (!assignment) return null;
    const left = assignment.childForFieldName("left");
    if (!left || left.type !== "identifier") return null;
    const name = left.text;
    if (name !== name.toUpperCase() || name.length < 2) return null;
    const typeNode = assignment.childForFieldName("type");
    return {
      name,
      kind: "const",
      exported: !name.startsWith("_"),
      signature: lines[node.startPosition.row]?.trim() || "",
      parameters: [],
      returnType: typeNode?.text?.replace(/^:\s*/, "") || null,
      comment: extractComment2(node, lines),
      source: lines[node.startPosition.row] || "",
      line: node.startPosition.row + 1,
      usedBy: []
    };
  }
  return null;
}
function extractParameters2(paramsNode) {
  if (!paramsNode) return [];
  const params = [];
  for (const child of paramsNode.children) {
    if (child.type === "identifier") {
      if (child.text === "self" || child.text === "cls") continue;
      params.push({ name: child.text, type: null });
    } else if (child.type === "typed_parameter") {
      const nameNode = child.children.find((c) => c.type === "identifier");
      const typeNode = child.childForFieldName("type");
      const name = nameNode?.text;
      if (name === "self" || name === "cls") continue;
      params.push({ name: name || child.text, type: typeNode?.text || null });
    } else if (child.type === "default_parameter") {
      const nameNode = child.childForFieldName("name");
      params.push({ name: nameNode?.text || child.text, type: null });
    } else if (child.type === "typed_default_parameter") {
      const nameNode = child.childForFieldName("name");
      const typeNode = child.childForFieldName("type");
      params.push({
        name: nameNode?.text || child.text,
        type: typeNode?.text || null
      });
    } else if (child.type === "list_splat_pattern" || child.type === "dictionary_splat_pattern") {
      const nameNode = child.children.find((c) => c.type === "identifier");
      const prefix = child.type === "list_splat_pattern" ? "*" : "**";
      params.push({ name: prefix + (nameNode?.text || ""), type: null });
    }
  }
  return params;
}
function buildFnSignature(node, lines, decoratedNode) {
  const startLine = (decoratedNode || node).startPosition.row;
  let sig = "";
  for (let i = startLine; i < Math.min(lines.length, startLine + 10); i++) {
    sig += (sig ? "\n" : "") + lines[i];
    if (lines[i].includes(":") && !lines[i].trim().startsWith("@")) {
      sig = sig.replace(/:\s*$/, "");
      break;
    }
  }
  if (sig.length > 300) sig = sig.slice(0, 297) + "...";
  return sig.trim();
}
function extractDocstring(node) {
  const body = node.childForFieldName("body");
  if (!body) return "";
  const first = body.children?.[0];
  if (!first) return "";
  if (first.type === "expression_statement") {
    const str = first.children?.[0];
    if (str && (str.type === "string" || str.type === "concatenated_string")) {
      return str.text.replace(/^['"]{1,3}/, "").replace(/['"]{1,3}$/, "").trim();
    }
  }
  return "";
}
function extractComment2(node, lines) {
  const prev = node.previousNamedSibling;
  if (prev && prev.type === "comment") {
    return prev.text.replace(/^#\s*/, "").trim();
  }
  return "";
}
function extractImports2(rootNode, _source) {
  const imports = [];
  for (const node of rootNode.children) {
    if (node.type === "import_statement") {
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const source = nameNode.text;
        imports.push({ source, symbols: [source.split(".").pop()], typeOnly: false });
      }
    } else if (node.type === "import_from_statement") {
      const moduleNode = node.childForFieldName("module_name");
      const source = moduleNode?.text || "";
      const symbols = [];
      for (const child of node.children) {
        if (child.type === "dotted_name" && child !== moduleNode) {
          symbols.push(child.text);
        } else if (child.type === "aliased_import") {
          const alias = child.childForFieldName("alias");
          const name = child.childForFieldName("name");
          symbols.push(alias?.text || name?.text || child.text);
        }
      }
      imports.push({ source, symbols, typeOnly: false });
    }
  }
  return imports;
}
function extractCalls2(rootNode, symbols, fileImports) {
  const callMap = /* @__PURE__ */ new Map();
  const importLookup = /* @__PURE__ */ new Map();
  for (const imp of fileImports) {
    for (const sym of imp.symbols) {
      importLookup.set(sym, {
        source: imp.source,
        resolvedPath: imp.resolvedPath,
        resolvedModule: imp.resolvedModule
      });
    }
  }
  const localSymbols = new Set(symbols.map((s) => s.name));
  for (const sym of symbols) {
    if (sym.kind !== "function" && sym.kind !== "method") continue;
    const bodyNode = findPythonBody(rootNode, sym);
    if (!bodyNode) continue;
    const calls = [];
    const seen = /* @__PURE__ */ new Set();
    walkPythonCalls(bodyNode, calls, seen, importLookup, localSymbols, sym.name);
    if (calls.length > 0) {
      callMap.set(sym.name, calls);
    }
  }
  return callMap;
}
function findPythonBody(rootNode, sym) {
  const targetLine = sym.line - 1;
  function search(node) {
    if (node.type === "function_definition" && node.startPosition.row === targetLine) {
      return node.childForFieldName("body");
    }
    if (node.type === "decorated_definition" && node.startPosition.row === targetLine) {
      const inner = node.children.find((c) => c.type === "function_definition");
      if (inner) return inner.childForFieldName("body");
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
function walkPythonCalls(node, calls, seen, importLookup, localSymbols, callerName) {
  if (node.type === "call") {
    const funcNode = node.childForFieldName("function");
    if (funcNode) {
      const callInfo = resolvePythonCallee(funcNode, importLookup, localSymbols);
      if (callInfo && callInfo.name !== callerName) {
        const key = `${callInfo.name}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);
          calls.push({
            name: callInfo.name,
            resolvedFile: callInfo.resolvedFile,
            resolvedModule: callInfo.resolvedModule,
            line: node.startPosition.row + 1,
            isExternal: callInfo.isExternal
          });
        }
      }
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    walkPythonCalls(node.child(i), calls, seen, importLookup, localSymbols, callerName);
  }
}
function resolvePythonCallee(node, importLookup, localSymbols) {
  if (node.type === "identifier") {
    const name = node.text;
    if (PYTHON_BUILTINS.has(name)) return null;
    const imp = importLookup.get(name);
    if (imp) {
      return {
        name,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === "external"
      };
    }
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    return null;
  }
  if (node.type === "attribute") {
    const obj = node.childForFieldName("object");
    const attr = node.childForFieldName("attribute");
    if (!attr) return null;
    if (obj?.type === "identifier") {
      if (obj.text === "self" || obj.text === "cls") {
        return { name: attr.text, resolvedFile: null, resolvedModule: null, isExternal: false };
      }
      const imp = importLookup.get(obj.text);
      if (imp) {
        return {
          name: `${obj.text}.${attr.text}`,
          resolvedFile: imp.resolvedPath,
          resolvedModule: imp.resolvedModule,
          isExternal: imp.resolvedModule === "external"
        };
      }
    }
    return null;
  }
  return null;
}
function resolveImport2(importPath, fromFile, projectRoot, fileIndex) {
  if (importPath.startsWith(".")) {
    const dotMatch = importPath.match(/^\.+/);
    if (!dotMatch) return { resolvedPath: null, resolvedModule: "external" };
    const dots = dotMatch[0].length;
    let base = (0, import_path4.dirname)(fromFile);
    for (let i = 1; i < dots; i++) base = (0, import_path4.dirname)(base);
    const modulePart = importPath.slice(dots).replace(/\./g, "/");
    const resolved = (0, import_path4.resolve)(base, modulePart);
    const rel = (0, import_path4.relative)(projectRoot, resolved);
    if (rel.startsWith("..")) return { resolvedPath: null, resolvedModule: "external" };
    if (fileIndex) {
      const exact = fileIndex.resolve(rel);
      if (exact) return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
    }
    return { resolvedPath: rel, resolvedModule: getModuleFromRelPath(rel) };
  }
  const parts = importPath.split(".");
  const joined = parts.join("/");
  const SOURCE_ROOTS = ["", "src/", "lib/", "app/", "source/"];
  for (const prefix of SOURCE_ROOTS) {
    const localPath = (0, import_path4.resolve)(projectRoot, prefix + joined);
    const rel = (0, import_path4.relative)(projectRoot, localPath);
    if (rel.startsWith("..")) continue;
    if (fileIndex) {
      const exact = fileIndex.resolve(rel);
      if (exact) return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
    }
  }
  return { resolvedPath: null, resolvedModule: "external" };
}
function getModulePath2(filePath, projectRoot) {
  return getModuleName(filePath, projectRoot);
}
var import_path4, PYTHON_BUILTINS, python_default;
var init_python = __esm({
  "../src/languages/python.mjs"() {
    import_path4 = require("path");
    init_modules();
    PYTHON_BUILTINS = /* @__PURE__ */ new Set([
      "print",
      "len",
      "range",
      "enumerate",
      "zip",
      "map",
      "filter",
      "sorted",
      "reversed",
      "any",
      "all",
      "min",
      "max",
      "sum",
      "abs",
      "round",
      "hash",
      "id",
      "repr",
      "dir",
      "vars",
      "getattr",
      "setattr",
      "hasattr",
      "delattr",
      "callable",
      "super",
      "property",
      "staticmethod",
      "classmethod",
      "open",
      "input",
      "iter",
      "next",
      "format",
      "chr",
      "ord",
      "hex",
      "oct",
      "bin",
      "pow",
      "divmod",
      "isinstance",
      "issubclass",
      "type",
      "str",
      "int",
      "float",
      "bool",
      "list",
      "dict",
      "set",
      "tuple",
      "bytes",
      "bytearray",
      "frozenset",
      "object",
      "complex",
      "memoryview",
      "Exception",
      "ValueError",
      "TypeError",
      "KeyError",
      "IndexError",
      "AttributeError",
      "RuntimeError",
      "StopIteration",
      "NotImplementedError",
      "OSError",
      "IOError",
      "FileNotFoundError",
      "ImportError",
      "NameError"
    ]);
    python_default = {
      id: "python",
      loadGrammar: loadGrammar2,
      extractSymbols: extractSymbols2,
      extractImports: extractImports2,
      extractCalls: extractCalls2,
      resolveImport: resolveImport2,
      getModulePath: getModulePath2
    };
  }
});

// ../src/languages/helpers.mjs
function extractPrecedingComment(node) {
  const prev = node.previousNamedSibling;
  if (!prev) return "";
  if (prev.type === "comment") {
    return prev.text.replace(/^\/\*\*?\s*/, "").replace(/\*\/\s*$/, "").replace(/^\s*\*\s?/gm, "").replace(/^\/\/\s*/, "").replace(/^#\s*/, "").trim();
  }
  return "";
}
function extractParameters3(paramListNode, opts = {}) {
  if (!paramListNode) return [];
  const params = [];
  for (const child of paramListNode.children) {
    if (child.type === "parameter_declaration") {
      const typeNode = child.childForFieldName("type");
      const declarator = child.childForFieldName("declarator");
      const name = declarator?.text?.replace(/^\*+/, "") || child.text;
      params.push({
        name,
        type: typeNode?.text || null
      });
      continue;
    }
    if (child.type === "formal_parameter" || child.type === "spread_parameter") {
      const typeNode = child.childForFieldName("type");
      const nameNode = child.childForFieldName("name");
      const prefix = child.type === "spread_parameter" ? "..." : "";
      params.push({
        name: prefix + (nameNode?.text || child.text),
        type: typeNode?.text || null
      });
      continue;
    }
  }
  return params;
}
function getNodeSource(node, lines) {
  const startLine = node.startPosition.row;
  const endLine = node.endPosition.row;
  const source = lines.slice(startLine, endLine + 1).join("\n");
  return { source, line: startLine + 1 };
}
function isExported(node, language) {
  if (language === "c" || language === "cpp") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "storage_class_specifier" && child.text === "static") {
        return false;
      }
    }
    return true;
  }
  if (language === "java") {
    const modifiers = node.childForFieldName("modifiers") || node.children?.find((c) => c.type === "modifiers");
    if (!modifiers) return false;
    for (const child of modifiers.children) {
      if (child.text === "public") return true;
    }
    return false;
  }
  return true;
}
function findFunctionBody(node) {
  const body = node.childForFieldName("body");
  if (body) return body;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === "compound_statement" || child.type === "block") {
      return child;
    }
  }
  return null;
}
function buildSignature2(node, lines, maxLines = 10) {
  const startLine = node.startPosition.row;
  let sig = "";
  for (let i = startLine; i < Math.min(lines.length, startLine + maxLines); i++) {
    sig += (sig ? " " : "") + lines[i].trim();
    if (sig.includes("{")) {
      sig = sig.slice(0, sig.indexOf("{")).trim();
      break;
    }
  }
  if (sig.length > 300) sig = sig.slice(0, 297) + "...";
  return sig;
}
function walkBodyForCalls(bodyNode, importLookup, localSymbols, callerName, builtins, resolveCallee2) {
  const calls = [];
  const seen = /* @__PURE__ */ new Set();
  function walk(node) {
    if (node.type === "call_expression" || node.type === "new_expression") {
      const callee = node.type === "new_expression" ? node.children.find((c) => c.type === "identifier" || c.type === "qualified_identifier" || c.type === "type_identifier") : node.childForFieldName("function") || node.children[0];
      if (callee) {
        const callInfo = resolveCallee2(callee, importLookup, localSymbols, builtins);
        if (callInfo && callInfo.name !== callerName) {
          const key = `${callInfo.name}:${node.startPosition.row}`;
          if (!seen.has(key)) {
            seen.add(key);
            calls.push({
              name: callInfo.name,
              resolvedFile: callInfo.resolvedFile,
              resolvedModule: callInfo.resolvedModule,
              line: node.startPosition.row + 1,
              isExternal: callInfo.isExternal
            });
          }
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }
  walk(bodyNode);
  return calls;
}
var init_helpers = __esm({
  "../src/languages/helpers.mjs"() {
  }
});

// ../src/languages/c.mjs
function loadGrammar3(require3) {
  return require3("tree-sitter-c");
}
function extractSymbols3(rootNode, source) {
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
  const declaratorNode = node.childForFieldName("declarator");
  if (!declaratorNode) return null;
  let nameNode = declaratorNode;
  let paramsNode = null;
  if (declaratorNode.type === "function_declarator") {
    nameNode = declaratorNode.childForFieldName("declarator");
    paramsNode = declaratorNode.childForFieldName("parameters");
  } else if (declaratorNode.type === "pointer_declarator") {
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
  const parameters = extractParameters3(paramsNode, { typeFirst: true });
  const exported = isExported(node, "c");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature2(node, lines);
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
    usedBy: []
  };
}
function extractStructLike(node, lines) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const name = nameNode.text;
  const exported = isExported(node, "c");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature2(node, lines);
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
    usedBy: []
  };
}
function extractTypedef(node, lines) {
  let name = null;
  for (let i = node.childCount - 1; i >= 0; i--) {
    const child = node.child(i);
    if (child.type === "type_identifier" || child.type === "identifier") {
      name = child.text;
      break;
    }
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
  const signature = buildSignature2(node, lines);
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
    usedBy: []
  };
}
function extractTopLevelDeclaration(node, lines) {
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
    usedBy: []
  };
}
function extractImports3(rootNode, _source) {
  const imports = [];
  for (const node of rootNode.children) {
    if (node.type !== "preproc_include") continue;
    const pathNode = node.childForFieldName("path");
    if (!pathNode) continue;
    if (pathNode.type === "string_literal") {
      const raw = pathNode.text.replace(/^"|"$/g, "");
      imports.push({ source: raw, symbols: [], typeOnly: false });
    } else if (pathNode.type === "system_lib_string") {
      const raw = pathNode.text.replace(/^<|>$/g, "");
      imports.push({ source: raw, symbols: [], typeOnly: false, isSystem: true });
    }
  }
  return imports;
}
function extractCalls3(rootNode, symbols, fileImports) {
  const callMap = /* @__PURE__ */ new Map();
  const importLookup = /* @__PURE__ */ new Map();
  for (const imp of fileImports) {
    for (const sym of imp.symbols) {
      importLookup.set(sym, {
        source: imp.source,
        resolvedPath: imp.resolvedPath,
        resolvedModule: imp.resolvedModule
      });
    }
  }
  const localSymbols = new Set(symbols.map((s) => s.name));
  for (const sym of symbols) {
    if (sym.kind !== "function") continue;
    const bodyNode = findSymbolBody2(rootNode, sym);
    if (!bodyNode) continue;
    const calls = walkBodyForCalls(bodyNode, importLookup, localSymbols, sym.name, C_BUILTINS, resolveCCallee);
    if (calls.length > 0) {
      callMap.set(sym.name, calls);
    }
  }
  return callMap;
}
function findSymbolBody2(rootNode, sym) {
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
function resolveCCallee(node, importLookup, localSymbols, builtins) {
  if (node.type === "identifier") {
    const name = node.text;
    if (builtins.has(name)) return null;
    const imp = importLookup.get(name);
    if (imp) {
      return {
        name,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === "external"
      };
    }
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    return null;
  }
  if (node.type === "field_expression") {
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
          isExternal: imp.resolvedModule === "external"
        };
      }
    }
    return null;
  }
  return null;
}
function resolveImport3(importPath, fromFile, projectRoot, fileIndex) {
  if (importPath.includes("/") === false && !importPath.startsWith(".")) {
  }
  const candidates = [
    (0, import_path5.resolve)((0, import_path5.dirname)(fromFile), importPath),
    (0, import_path5.resolve)(projectRoot, importPath),
    (0, import_path5.resolve)(projectRoot, "include", importPath),
    (0, import_path5.resolve)(projectRoot, "src", importPath),
    (0, import_path5.resolve)(projectRoot, "lib", importPath)
  ];
  for (const candidate of candidates) {
    const rel = (0, import_path5.relative)(projectRoot, candidate);
    if (rel.startsWith("..")) continue;
    if (fileIndex) {
      const exact = fileIndex.resolve(rel);
      if (exact) {
        return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
      }
    }
  }
  return { resolvedPath: null, resolvedModule: "external" };
}
function getModulePath3(filePath, projectRoot) {
  return getModuleName(filePath, projectRoot);
}
var import_path5, C_BUILTINS, c_default;
var init_c = __esm({
  "../src/languages/c.mjs"() {
    import_path5 = require("path");
    init_modules();
    init_helpers();
    C_BUILTINS = /* @__PURE__ */ new Set([
      "printf",
      "fprintf",
      "sprintf",
      "snprintf",
      "scanf",
      "malloc",
      "calloc",
      "realloc",
      "free",
      "memcpy",
      "memset",
      "memmove",
      "strlen",
      "strcmp",
      "strncmp",
      "strcpy",
      "strcat",
      "exit",
      "abort",
      "assert"
    ]);
    c_default = {
      id: "c",
      loadGrammar: loadGrammar3,
      extractSymbols: extractSymbols3,
      extractImports: extractImports3,
      extractCalls: extractCalls3,
      resolveImport: resolveImport3,
      getModulePath: getModulePath3
    };
  }
});

// ../src/languages/cpp.mjs
function loadGrammar4(require3) {
  return require3("tree-sitter-cpp");
}
function extractSymbols4(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");
  for (const node of rootNode.children) {
    const type = node.type;
    if (type === "function_definition") {
      const sym = extractFunctionDef2(node, lines);
      if (sym) symbols.push(sym);
    } else if (type === "class_specifier" || type === "struct_specifier") {
      const sym = extractClassDef(node, lines);
      if (sym) {
        symbols.push(sym);
        extractClassMembers(node, lines, sym.name, symbols);
      }
    } else if (type === "union_specifier" || type === "enum_specifier") {
      const sym = extractSimpleType(node, lines);
      if (sym) symbols.push(sym);
    } else if (type === "namespace_definition") {
      extractNamespaceSymbols(node, lines, symbols);
    } else if (type === "template_declaration") {
      const inner = node.children.find(
        (c) => c.type === "function_definition" || c.type === "class_specifier" || c.type === "struct_specifier"
      );
      if (inner) {
        if (inner.type === "function_definition") {
          const sym = extractFunctionDef2(inner, lines);
          if (sym) symbols.push(sym);
        } else {
          const sym = extractClassDef(inner, lines);
          if (sym) {
            symbols.push(sym);
            extractClassMembers(inner, lines, sym.name, symbols);
          }
        }
      }
    } else if (type === "type_definition") {
      const sym = extractTypedef2(node, lines);
      if (sym) symbols.push(sym);
    } else if (type === "declaration") {
      const sym = extractTopLevelDeclaration2(node, lines);
      if (sym) symbols.push(sym);
    }
  }
  return symbols;
}
function extractFunctionDef2(node, lines) {
  const declaratorNode = node.childForFieldName("declarator");
  if (!declaratorNode) return null;
  let nameNode = declaratorNode;
  let paramsNode = null;
  if (declaratorNode.type === "function_declarator") {
    nameNode = declaratorNode.childForFieldName("declarator");
    paramsNode = declaratorNode.childForFieldName("parameters");
  } else if (declaratorNode.type === "pointer_declarator") {
    const inner = declaratorNode.childForFieldName("declarator");
    if (inner && inner.type === "function_declarator") {
      nameNode = inner.childForFieldName("declarator");
      paramsNode = inner.childForFieldName("parameters");
    }
  } else if (declaratorNode.type === "reference_declarator") {
    const inner = declaratorNode.childForFieldName("declarator") || declaratorNode.children?.[1];
    if (inner && inner.type === "function_declarator") {
      nameNode = inner.childForFieldName("declarator");
      paramsNode = inner.childForFieldName("parameters");
    }
  }
  let name = nameNode?.text;
  if (!name) return null;
  const typeNode = node.childForFieldName("type");
  const returnType = typeNode?.text || null;
  const parameters = extractParameters3(paramsNode, { typeFirst: true });
  const exported = isExported(node, "cpp");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature2(node, lines);
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
    usedBy: []
  };
}
function extractClassDef(node, lines) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const name = nameNode.text;
  const exported = isExported(node, "cpp");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature2(node, lines);
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
    usedBy: []
  };
}
function extractClassMembers(classNode, lines, className, symbols) {
  const body = classNode.childForFieldName("body");
  if (!body) return;
  let accessLevel = classNode.type === "struct_specifier" ? "public" : "private";
  for (const member of body.children) {
    if (member.type === "access_specifier") {
      accessLevel = member.text.replace(":", "").trim();
      continue;
    }
    if (member.type === "function_definition") {
      const sym = extractMethodFromClass(member, lines, className, accessLevel);
      if (sym) symbols.push(sym);
    } else if (member.type === "declaration") {
      const declarator = findFuncDeclarator(member);
      if (declarator) {
        const sym = extractMethodDeclFromClass(member, declarator, lines, className, accessLevel);
        if (sym) symbols.push(sym);
      }
    } else if (member.type === "template_declaration") {
      const inner = member.children.find((c) => c.type === "function_definition" || c.type === "declaration");
      if (inner?.type === "function_definition") {
        const sym = extractMethodFromClass(inner, lines, className, accessLevel);
        if (sym) symbols.push(sym);
      }
    }
  }
}
function findFuncDeclarator(node) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === "function_declarator") return child;
    if (child.type === "pointer_declarator" || child.type === "reference_declarator") {
      const inner = child.childForFieldName("declarator");
      if (inner?.type === "function_declarator") return inner;
    }
  }
  return null;
}
function extractMethodFromClass(node, lines, className, accessLevel) {
  const declaratorNode = node.childForFieldName("declarator");
  if (!declaratorNode) return null;
  let nameNode = declaratorNode;
  let paramsNode = null;
  if (declaratorNode.type === "function_declarator") {
    nameNode = declaratorNode.childForFieldName("declarator");
    paramsNode = declaratorNode.childForFieldName("parameters");
  }
  const name = nameNode?.text;
  if (!name || name === className) return null;
  const typeNode = node.childForFieldName("type");
  const returnType = typeNode?.text || null;
  const parameters = extractParameters3(paramsNode, { typeFirst: true });
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature2(node, lines);
  return {
    name,
    kind: "method",
    exported: accessLevel === "public",
    className,
    signature,
    parameters,
    returnType,
    comment,
    source,
    line,
    usedBy: []
  };
}
function extractMethodDeclFromClass(declNode, funcDeclarator, lines, className, accessLevel) {
  const nameNode = funcDeclarator.childForFieldName("declarator");
  const paramsNode = funcDeclarator.childForFieldName("parameters");
  const name = nameNode?.text;
  if (!name) return null;
  const typeNode = declNode.childForFieldName("type");
  const returnType = typeNode?.text || null;
  const parameters = extractParameters3(paramsNode, { typeFirst: true });
  const comment = extractPrecedingComment(declNode);
  const { source, line } = getNodeSource(declNode, lines);
  const signature = buildSignature2(declNode, lines);
  return {
    name,
    kind: "method",
    exported: accessLevel === "public",
    className,
    signature,
    parameters,
    returnType,
    comment,
    source,
    line,
    usedBy: []
  };
}
function extractNamespaceSymbols(nsNode, lines, symbols) {
  const nameNode = nsNode.childForFieldName("name");
  const nsName = nameNode?.text || "";
  const body = nsNode.childForFieldName("body");
  if (!body) return;
  for (const child of body.children) {
    if (child.type === "function_definition") {
      const sym = extractFunctionDef2(child, lines);
      if (sym) {
        sym.name = nsName ? `${nsName}::${sym.name}` : sym.name;
        symbols.push(sym);
      }
    } else if (child.type === "class_specifier" || child.type === "struct_specifier") {
      const sym = extractClassDef(child, lines);
      if (sym) {
        const fullName = nsName ? `${nsName}::${sym.name}` : sym.name;
        sym.name = fullName;
        symbols.push(sym);
        extractClassMembers(child, lines, fullName, symbols);
      }
    } else if (child.type === "namespace_definition") {
      extractNamespaceSymbols(child, lines, symbols);
    }
  }
}
function extractSimpleType(node, lines) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;
  const name = nameNode.text;
  const exported = isExported(node, "cpp");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature2(node, lines);
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
    usedBy: []
  };
}
function extractTypedef2(node, lines) {
  let name = null;
  for (let i = node.childCount - 1; i >= 0; i--) {
    const child = node.child(i);
    if (child.type === "type_identifier" || child.type === "identifier") {
      name = child.text;
      break;
    }
    if (child.type === "pointer_declarator") {
      const inner = child.childForFieldName("declarator");
      if (inner) {
        name = inner.text;
        break;
      }
    }
  }
  if (!name) return null;
  const exported = isExported(node, "cpp");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature2(node, lines);
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
    usedBy: []
  };
}
function extractTopLevelDeclaration2(node, lines) {
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
  let isConst = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === "type_qualifier" && child.text === "const") {
      isConst = true;
      break;
    }
  }
  const exported = isExported(node, "cpp");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const sig = lines[node.startPosition.row]?.trim() || "";
  return {
    name: nameText,
    kind: "const",
    exported,
    signature: sig.length > 150 ? sig.slice(0, 147) + "..." : sig,
    parameters: [],
    returnType: null,
    comment,
    source,
    line,
    usedBy: []
  };
}
function extractImports4(rootNode, _source) {
  const imports = [];
  for (const node of rootNode.children) {
    if (node.type === "preproc_include") {
      const pathNode = node.childForFieldName("path");
      if (!pathNode) continue;
      if (pathNode.type === "string_literal") {
        const raw = pathNode.text.replace(/^"|"$/g, "");
        imports.push({ source: raw, symbols: [], typeOnly: false });
      } else if (pathNode.type === "system_lib_string") {
        const raw = pathNode.text.replace(/^<|>$/g, "");
        imports.push({ source: raw, symbols: [], typeOnly: false, isSystem: true });
      }
    } else if (node.type === "using_declaration") {
      const text = node.text.replace(/^using\s+/, "").replace(/;$/, "").trim();
      const lastColon = text.lastIndexOf("::");
      if (lastColon !== -1) {
        const name = text.slice(lastColon + 2);
        imports.push({ source: text, symbols: [name], typeOnly: false });
      }
    }
  }
  return imports;
}
function extractCalls4(rootNode, symbols, fileImports) {
  const callMap = /* @__PURE__ */ new Map();
  const importLookup = /* @__PURE__ */ new Map();
  for (const imp of fileImports) {
    for (const sym of imp.symbols) {
      importLookup.set(sym, {
        source: imp.source,
        resolvedPath: imp.resolvedPath,
        resolvedModule: imp.resolvedModule
      });
    }
  }
  const localSymbols = new Set(symbols.map((s) => s.name));
  for (const sym of symbols) {
    if (sym.kind !== "function" && sym.kind !== "method") continue;
    const bodyNode = findSymbolBody3(rootNode, sym);
    if (!bodyNode) continue;
    const calls = walkBodyForCalls(bodyNode, importLookup, localSymbols, sym.name, CPP_BUILTINS, resolveCppCallee);
    if (calls.length > 0) {
      callMap.set(sym.name, calls);
    }
  }
  return callMap;
}
function findSymbolBody3(rootNode, sym) {
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
function resolveCppCallee(node, importLookup, localSymbols, builtins) {
  if (node.type === "identifier") {
    const name = node.text;
    if (builtins.has(name)) return null;
    const imp = importLookup.get(name);
    if (imp) {
      return {
        name,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === "external"
      };
    }
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    return null;
  }
  if (node.type === "qualified_identifier" || node.type === "scoped_identifier") {
    const name = node.text;
    if (builtins.has(name)) return null;
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    const lastPart = name.split("::").pop();
    if (builtins.has(lastPart)) return null;
    if (localSymbols.has(lastPart)) {
      return { name: lastPart, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    return null;
  }
  if (node.type === "field_expression") {
    const obj = node.childForFieldName("argument");
    const field = node.childForFieldName("field");
    if (!field) return null;
    const methodName = field.text;
    if (obj?.text === "this") {
      return { name: methodName, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    if (obj?.type === "identifier") {
      const imp = importLookup.get(obj.text);
      if (imp) {
        return {
          name: `${obj.text}.${methodName}`,
          resolvedFile: imp.resolvedPath,
          resolvedModule: imp.resolvedModule,
          isExternal: imp.resolvedModule === "external"
        };
      }
    }
    return null;
  }
  if (node.type === "template_function") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      return resolveCppCallee(nameNode, importLookup, localSymbols, builtins);
    }
    return null;
  }
  return null;
}
function resolveImport4(importPath, fromFile, projectRoot, fileIndex) {
  return c_default.resolveImport(importPath, fromFile, projectRoot, fileIndex);
}
function getModulePath4(filePath, projectRoot) {
  return getModuleName(filePath, projectRoot);
}
var CPP_BUILTINS, cpp_default;
var init_cpp = __esm({
  "../src/languages/cpp.mjs"() {
    init_modules();
    init_helpers();
    init_c();
    CPP_BUILTINS = /* @__PURE__ */ new Set([
      "printf",
      "fprintf",
      "sprintf",
      "snprintf",
      "scanf",
      "malloc",
      "calloc",
      "realloc",
      "free",
      "memcpy",
      "memset",
      "memmove",
      "strlen",
      "strcmp",
      "strncmp",
      "strcpy",
      "strcat",
      "exit",
      "abort",
      "assert",
      // C++ specific
      "cout",
      "cerr",
      "endl",
      "cin",
      "make_shared",
      "make_unique",
      "make_pair",
      "make_tuple",
      "move",
      "forward",
      "swap",
      "static_cast",
      "dynamic_cast",
      "reinterpret_cast",
      "const_cast"
    ]);
    cpp_default = {
      id: "cpp",
      loadGrammar: loadGrammar4,
      extractSymbols: extractSymbols4,
      extractImports: extractImports4,
      extractCalls: extractCalls4,
      resolveImport: resolveImport4,
      getModulePath: getModulePath4
    };
  }
});

// ../src/languages/java.mjs
function loadGrammar5(require3) {
  return require3("tree-sitter-java");
}
function extractSymbols5(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");
  for (const node of rootNode.children) {
    if (node.type === "class_declaration") {
      pushTypeSymbol(node, "class", lines, symbols);
      extractClassMembers2(node, lines, symbols);
    } else if (node.type === "interface_declaration") {
      pushTypeSymbol(node, "interface", lines, symbols);
      extractClassMembers2(node, lines, symbols);
    } else if (node.type === "enum_declaration") {
      pushTypeSymbol(node, "enum", lines, symbols);
      extractClassMembers2(node, lines, symbols);
    } else if (node.type === "annotation_type_declaration") {
      pushTypeSymbol(node, "type", lines, symbols);
    }
  }
  return symbols;
}
function pushTypeSymbol(node, kind, lines, symbols) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return;
  const name = nameNode.text;
  const exported = isExported(node, "java");
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature2(node, lines);
  symbols.push({
    name,
    kind,
    exported,
    signature,
    parameters: [],
    returnType: null,
    comment,
    source,
    line,
    usedBy: []
  });
}
function extractClassMembers2(classNode, lines, symbols) {
  const nameNode = classNode.childForFieldName("name");
  if (!nameNode) return;
  const className = nameNode.text;
  const body = classNode.childForFieldName("body");
  if (!body) return;
  for (const member of body.children) {
    if (member.type === "method_declaration") {
      const methodName = member.childForFieldName("name");
      if (!methodName) continue;
      const params = extractParameters3(member.childForFieldName("parameters"), { typeFirst: true });
      const typeNode = member.childForFieldName("type");
      const returnType = typeNode?.text || null;
      const comment = extractPrecedingComment(member);
      const { source, line } = getNodeSource(member, lines);
      const signature = buildSignature2(member, lines);
      const exported = isExported(member, "java");
      symbols.push({
        name: methodName.text,
        kind: "method",
        exported,
        className,
        signature,
        parameters: params,
        returnType,
        comment,
        source,
        line,
        usedBy: []
      });
    } else if (member.type === "constructor_declaration") {
      const methodName = member.childForFieldName("name");
      if (!methodName) continue;
      const params = extractParameters3(member.childForFieldName("parameters"), { typeFirst: true });
      const comment = extractPrecedingComment(member);
      const { source, line } = getNodeSource(member, lines);
      const signature = buildSignature2(member, lines);
      const exported = isExported(member, "java");
      symbols.push({
        name: methodName.text,
        kind: "method",
        exported,
        className,
        signature,
        parameters: params,
        returnType: null,
        comment,
        source,
        line,
        usedBy: []
      });
    } else if (member.type === "field_declaration") {
      const modifiers = member.childForFieldName("modifiers") || member.children?.find((c) => c.type === "modifiers");
      if (!modifiers) continue;
      const modTexts = modifiers.children.map((c) => c.text);
      if (!modTexts.includes("static") || !modTexts.includes("final")) continue;
      const declarator = member.childForFieldName("declarator") || member.children.find((c) => c.type === "variable_declarator");
      if (!declarator) continue;
      const fieldName = declarator.childForFieldName("name");
      if (!fieldName) continue;
      const comment = extractPrecedingComment(member);
      const { source, line } = getNodeSource(member, lines);
      const exported = isExported(member, "java");
      symbols.push({
        name: fieldName.text,
        kind: "const",
        exported,
        className,
        signature: lines[member.startPosition.row]?.trim() || "",
        parameters: [],
        returnType: null,
        comment,
        source,
        line,
        usedBy: []
      });
    }
  }
}
function extractImports5(rootNode, _source) {
  const imports = [];
  for (const node of rootNode.children) {
    if (node.type !== "import_declaration") continue;
    const text = node.text;
    const isStatic = text.includes("import static ");
    let pathNode = null;
    for (const child of node.children) {
      if (child.type === "scoped_identifier" || child.type === "identifier") {
        pathNode = child;
      }
    }
    if (!pathNode) continue;
    const fullPath = pathNode.text;
    if (fullPath.endsWith(".*")) {
      const packagePath = fullPath.slice(0, -2);
      imports.push({
        source: packagePath,
        symbols: ["*"],
        typeOnly: false
      });
    } else if (isStatic) {
      const lastDot = fullPath.lastIndexOf(".");
      if (lastDot !== -1) {
        const classPath = fullPath.slice(0, lastDot);
        const memberName = fullPath.slice(lastDot + 1);
        imports.push({
          source: classPath,
          symbols: [memberName],
          typeOnly: false
        });
      } else {
        imports.push({
          source: fullPath,
          symbols: [fullPath],
          typeOnly: false
        });
      }
    } else {
      const lastDot = fullPath.lastIndexOf(".");
      const simpleName = lastDot !== -1 ? fullPath.slice(lastDot + 1) : fullPath;
      imports.push({
        source: fullPath,
        symbols: [simpleName],
        typeOnly: false
      });
    }
  }
  return imports;
}
function extractCalls5(rootNode, symbols, fileImports) {
  const callMap = /* @__PURE__ */ new Map();
  const importLookup = /* @__PURE__ */ new Map();
  for (const imp of fileImports) {
    for (const sym of imp.symbols) {
      importLookup.set(sym, {
        source: imp.source,
        resolvedPath: imp.resolvedPath,
        resolvedModule: imp.resolvedModule
      });
    }
  }
  const localSymbols = new Set(symbols.map((s) => s.name));
  for (const sym of symbols) {
    if (sym.kind !== "method") continue;
    const bodyNode = findSymbolBody4(rootNode, sym);
    if (!bodyNode) continue;
    const calls = [];
    const seen = /* @__PURE__ */ new Set();
    walkForCalls2(bodyNode, calls, seen, importLookup, localSymbols, sym.name);
    if (calls.length > 0) {
      callMap.set(sym.name, calls);
    }
  }
  return callMap;
}
function findSymbolBody4(rootNode, sym) {
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
function walkForCalls2(node, calls, seen, importLookup, localSymbols, callerName) {
  if (node.type === "method_invocation") {
    const nameNode = node.childForFieldName("name");
    const objNode = node.childForFieldName("object");
    if (nameNode) {
      const callInfo = resolveMethodInvocation(nameNode, objNode, importLookup, localSymbols);
      if (callInfo && callInfo.name !== callerName) {
        const key = `${callInfo.name}:${node.startPosition.row}`;
        if (!seen.has(key)) {
          seen.add(key);
          calls.push({
            name: callInfo.name,
            resolvedFile: callInfo.resolvedFile,
            resolvedModule: callInfo.resolvedModule,
            line: node.startPosition.row + 1,
            isExternal: callInfo.isExternal
          });
        }
      }
    }
  } else if (node.type === "object_creation_expression") {
    const typeNode = node.childForFieldName("type");
    if (typeNode) {
      const typeName = typeNode.text;
      if (!JAVA_BUILTINS.has(typeName)) {
        const imp = importLookup.get(typeName);
        const callInfo = imp ? { name: typeName, resolvedFile: imp.resolvedPath, resolvedModule: imp.resolvedModule, isExternal: imp.resolvedModule === "external" } : localSymbols.has(typeName) ? { name: typeName, resolvedFile: null, resolvedModule: null, isExternal: false } : null;
        if (callInfo && callInfo.name !== callerName) {
          const key = `${callInfo.name}:${node.startPosition.row}`;
          if (!seen.has(key)) {
            seen.add(key);
            calls.push({
              name: callInfo.name,
              resolvedFile: callInfo.resolvedFile,
              resolvedModule: callInfo.resolvedModule,
              line: node.startPosition.row + 1,
              isExternal: callInfo.isExternal
            });
          }
        }
      }
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    walkForCalls2(node.child(i), calls, seen, importLookup, localSymbols, callerName);
  }
}
function resolveMethodInvocation(nameNode, objNode, importLookup, localSymbols) {
  const methodName = nameNode.text;
  if (!objNode) {
    if (JAVA_BUILTINS.has(methodName)) return null;
    const imp = importLookup.get(methodName);
    if (imp) {
      return {
        name: methodName,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === "external"
      };
    }
    if (localSymbols.has(methodName)) {
      return { name: methodName, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    return null;
  }
  if (objNode.type === "this" || objNode.type === "super") {
    return { name: methodName, resolvedFile: null, resolvedModule: null, isExternal: false };
  }
  if (objNode.type === "identifier") {
    const objName = objNode.text;
    if (JAVA_BUILTINS.has(objName)) return null;
    const imp = importLookup.get(objName);
    if (imp) {
      return {
        name: `${objName}.${methodName}`,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === "external"
      };
    }
    if (localSymbols.has(objName)) {
      return { name: `${objName}.${methodName}`, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
  }
  return null;
}
function resolveImport5(importPath, fromFile, projectRoot, fileIndex) {
  const filePart = importPath.replace(/\./g, "/") + ".java";
  for (const root of JAVA_SOURCE_ROOTS) {
    const rel = root + filePart;
    if (fileIndex) {
      const exact = fileIndex.resolve(rel);
      if (exact) {
        return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
      }
    }
    const dirPart = importPath.replace(/\./g, "/");
    const dirRel = root + dirPart;
    if (fileIndex) {
      const exact = fileIndex.resolve(dirRel);
      if (exact) {
        return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
      }
    }
  }
  return { resolvedPath: null, resolvedModule: "external" };
}
function getModulePath5(filePath, projectRoot) {
  return getModuleName(filePath, projectRoot);
}
var JAVA_BUILTINS, JAVA_SOURCE_ROOTS, java_default;
var init_java = __esm({
  "../src/languages/java.mjs"() {
    init_modules();
    init_helpers();
    JAVA_BUILTINS = /* @__PURE__ */ new Set([
      "System",
      "String",
      "Integer",
      "Long",
      "Double",
      "Float",
      "Boolean",
      "Character",
      "Byte",
      "Short",
      "Arrays",
      "Collections",
      "Objects",
      "Optional",
      "Math",
      "Thread"
    ]);
    JAVA_SOURCE_ROOTS = ["src/main/java/", "src/", "app/", ""];
    java_default = {
      id: "java",
      loadGrammar: loadGrammar5,
      extractSymbols: extractSymbols5,
      extractImports: extractImports5,
      extractCalls: extractCalls5,
      resolveImport: resolveImport5,
      getModulePath: getModulePath5
    };
  }
});

// ../src/languages/index.mjs
function getLanguage(langId) {
  return languages[langId] || null;
}
var languages;
var init_languages = __esm({
  "../src/languages/index.mjs"() {
    init_typescript();
    init_python();
    init_c();
    init_cpp();
    init_java();
    languages = {
      typescript: typescript_default,
      javascript: {
        ...typescript_default,
        id: "javascript"
      },
      python: python_default,
      c: c_default,
      cpp: cpp_default,
      java: java_default
    };
  }
});

// ../src/analyzer/callgraph.mjs
var callgraph_exports = {};
__export(callgraph_exports, {
  buildCallGraph: () => buildCallGraph
});
function buildCallGraph(modules, rootFiles, projectRoot, warnings = []) {
  const allFiles = [...rootFiles, ...modules.flatMap((m) => m.files)];
  const fileByPath = /* @__PURE__ */ new Map();
  const fileByPathNoExt = /* @__PURE__ */ new Map();
  for (const file of allFiles) {
    fileByPath.set(file.path, file);
    fileByPathNoExt.set(file.path.replace(/\.[^.]+$/, ""), file);
  }
  function findFileByPath(path5) {
    return fileByPath.get(path5) || fileByPathNoExt.get(path5) || null;
  }
  const symbolIndex = /* @__PURE__ */ new Map();
  for (const file of allFiles) {
    for (const sym of file.symbols) {
      if (!symbolIndex.has(sym.name)) symbolIndex.set(sym.name, []);
      symbolIndex.get(sym.name).push({ filePath: file.path, symbol: sym });
    }
  }
  const callGraphEdges = [];
  let processed = 0;
  let unresolvedCount = 0;
  const importedFilesMap = /* @__PURE__ */ new Map();
  for (const file of allFiles) {
    const importedFiles = /* @__PURE__ */ new Set();
    for (const imp of file.imports) {
      if (imp.resolvedPath) importedFiles.add(imp.resolvedPath);
      if (imp.resolvedPath) importedFiles.add(imp.resolvedPath.replace(/\.[^./]+$/, ""));
    }
    importedFilesMap.set(file.path, importedFiles);
  }
  for (const file of allFiles) {
    const lang = getLanguage(file.language);
    if (!lang?.extractCalls) continue;
    try {
      if (!file._rootNode) continue;
      const callMap = lang.extractCalls(file._rootNode, file.symbols, file.imports);
      const importedFiles = importedFilesMap.get(file.path) || /* @__PURE__ */ new Set();
      for (const [callerName, calls] of callMap) {
        const callerSym = file.symbols.find((s) => s.name === callerName);
        if (!callerSym) continue;
        const resolvedCalls = [];
        for (const call of calls) {
          const callName = call.name.split(".").pop();
          let targetFile = null;
          let targetSymbol = callName;
          let confidence = "exact";
          if (call.resolvedFile && !call.isExternal) {
            targetFile = call.resolvedFile;
            confidence = "exact";
          } else if (!call.resolvedFile && !call.isExternal) {
            targetFile = file.path;
            confidence = "exact";
          } else {
            const candidates = symbolIndex.get(callName);
            if (candidates) {
              const exported = candidates.filter((c) => c.symbol.exported && c.filePath !== file.path);
              if (exported.length === 1) {
                targetFile = exported[0].filePath;
                confidence = "inferred";
              } else if (exported.length > 1) {
                const fromImported = exported.filter(
                  (c) => importedFiles.has(c.filePath) || importedFiles.has(c.filePath.replace(/\.[^./]+$/, ""))
                );
                if (fromImported.length === 1) {
                  targetFile = fromImported[0].filePath;
                  confidence = "inferred";
                } else {
                  const imp = file.imports.find((i) => i.symbols.includes(callName));
                  if (imp?.source) {
                    const hint = imp.source.replace(/^@\//, "").replace(/\./g, "/");
                    const best = exported.find((c) => c.filePath.includes(hint));
                    if (best) {
                      targetFile = best.filePath;
                      confidence = "inferred";
                    }
                  }
                  if (!targetFile) {
                    targetFile = (fromImported[0] || exported[0]).filePath;
                    confidence = "ambiguous";
                  }
                }
              } else {
                const any = candidates.filter((c) => c.filePath !== file.path);
                if (any.length === 1) {
                  targetFile = any[0].filePath;
                  confidence = "inferred";
                } else if (any.length > 1) {
                  const fromImported = any.filter(
                    (c) => importedFiles.has(c.filePath) || importedFiles.has(c.filePath.replace(/\.[^./]+$/, ""))
                  );
                  targetFile = (fromImported[0] || any[0]).filePath;
                  confidence = fromImported.length === 1 ? "inferred" : "ambiguous";
                }
              }
            }
            if (!targetFile) {
              const localSym = file.symbols.find((s) => s.name === callName && s.name !== callerName);
              if (localSym) {
                targetFile = file.path;
                confidence = "inferred";
              }
            }
          }
          if (!targetFile) {
            unresolvedCount++;
            continue;
          }
          resolvedCalls.push({
            name: callName,
            resolvedFile: targetFile,
            line: call.line
          });
          callGraphEdges.push({
            source: `${file.path}::${callerName}`,
            target: `${targetFile}::${targetSymbol}`,
            line: call.line,
            confidence
          });
        }
        if (resolvedCalls.length > 0) {
          callerSym.calls = resolvedCalls;
        }
      }
    } catch (err) {
      warnings.push({ type: "callgraph", file: file.path, message: err.message });
    }
    processed++;
    if (processed % 50 === 0) {
      process.stdout.write(`\r  Call graph: ${processed}/${allFiles.length} files`);
    }
  }
  if (unresolvedCount > 0) {
    warnings.push({ type: "callgraph", message: `${unresolvedCount} calls could not be resolved to known symbols` });
  }
  if (allFiles.length > 50) console.log(`\r  Call graph: ${allFiles.length}/${allFiles.length} files`);
  for (const edge of callGraphEdges) {
    const targetSep = edge.target.indexOf("::");
    const sourceSep = edge.source.indexOf("::");
    if (targetSep === -1 || sourceSep === -1) continue;
    const targetFile = edge.target.substring(0, targetSep);
    const targetName = edge.target.substring(targetSep + 2);
    const sourceFile = edge.source.substring(0, sourceSep);
    const sourceName = edge.source.substring(sourceSep + 2);
    const file = findFileByPath(targetFile);
    if (file) {
      const sym = file.symbols.find((s) => s.name === targetName);
      if (sym) {
        if (!sym.calledBy) sym.calledBy = [];
        sym.calledBy.push({ symbol: sourceName, file: sourceFile, line: edge.line });
      }
    }
  }
  const nodes = [];
  const nodeSet = /* @__PURE__ */ new Set();
  for (const edge of callGraphEdges) {
    for (const id of [edge.source, edge.target]) {
      if (!nodeSet.has(id)) {
        nodeSet.add(id);
        const sep = id.indexOf("::");
        const filePath = sep !== -1 ? id.substring(0, sep) : id;
        const symName = sep !== -1 ? id.substring(sep + 2) : id;
        const file = findFileByPath(filePath);
        const sym = file?.symbols.find((s) => s.name === symName);
        nodes.push({
          id,
          symbol: symName,
          file: file?.path || filePath,
          kind: sym?.kind || "unknown"
        });
      }
    }
  }
  return {
    nodes,
    edges: callGraphEdges,
    stats: {
      totalCalls: callGraphEdges.length,
      filesWithCalls: new Set(callGraphEdges.map((e) => {
        const i = e.source.indexOf("::");
        return i !== -1 ? e.source.substring(0, i) : e.source;
      })).size,
      uniqueCallers: new Set(callGraphEdges.map((e) => e.source)).size,
      uniqueCallees: new Set(callGraphEdges.map((e) => e.target)).size,
      exact: callGraphEdges.filter((e) => e.confidence === "exact").length,
      inferred: callGraphEdges.filter((e) => e.confidence === "inferred").length,
      ambiguous: callGraphEdges.filter((e) => e.confidence === "ambiguous").length,
      unresolved: unresolvedCount
    }
  };
}
var init_callgraph = __esm({
  "../src/analyzer/callgraph.mjs"() {
    init_languages();
  }
});

// ../src/analyzer/impact.mjs
var impact_exports = {};
__export(impact_exports, {
  computeImpact: () => computeImpact
});
function computeImpact(modules, rootFiles, callGraph) {
  const allFiles = [...rootFiles, ...modules.flatMap((m) => m.files)];
  const fileByPath = /* @__PURE__ */ new Map();
  const fileByPathNoExt = /* @__PURE__ */ new Map();
  for (const file of allFiles) {
    fileByPath.set(file.path, file);
    fileByPathNoExt.set(file.path.replace(/\.[^.]+$/, ""), file);
  }
  function findFile(path5) {
    return fileByPath.get(path5) || fileByPathNoExt.get(path5) || null;
  }
  const fileDepMap = /* @__PURE__ */ new Map();
  for (const file of allFiles) {
    for (const imp of file.imports) {
      if (imp.resolvedModule === "external" || !imp.resolvedPath) continue;
      const target = findFile(imp.resolvedPath);
      if (target) {
        if (!fileDepMap.has(target.path)) fileDepMap.set(target.path, /* @__PURE__ */ new Set());
        fileDepMap.get(target.path).add(file.path);
      }
    }
  }
  const symbolCallers = /* @__PURE__ */ new Map();
  if (callGraph?.edges) {
    for (const edge of callGraph.edges) {
      if (!symbolCallers.has(edge.target)) symbolCallers.set(edge.target, /* @__PURE__ */ new Set());
      symbolCallers.get(edge.target).add(edge.source);
    }
  }
  const impactMap = {};
  for (const file of allFiles) {
    const directDeps = fileDepMap.get(file.path);
    if (!directDeps || directDeps.size === 0) continue;
    const transitive = /* @__PURE__ */ new Set();
    const queue = [...directDeps];
    while (queue.length > 0) {
      const dep = queue.shift();
      if (transitive.has(dep)) continue;
      transitive.add(dep);
      const next = fileDepMap.get(dep);
      if (next) {
        for (const n of next) {
          if (!transitive.has(n)) queue.push(n);
        }
      }
    }
    const riskLevel = transitive.size > 10 ? "high" : transitive.size > 3 ? "medium" : "low";
    impactMap[file.path] = {
      directDependents: [...directDeps],
      transitiveDependents: [...transitive],
      transitiveCount: transitive.size,
      riskLevel
    };
  }
  for (const file of allFiles) {
    for (const sym of file.symbols) {
      const symId = `${file.path}::${sym.name}`;
      const callers = symbolCallers.get(symId);
      const directCount = callers?.size || 0;
      const usedByCount = sym.usedBy?.length || 0;
      let transitiveDepth = 0;
      const transitiveFiles = /* @__PURE__ */ new Set();
      if (callers) {
        const visited = /* @__PURE__ */ new Set();
        const queue = [...callers].map((c) => ({ id: c, depth: 1 }));
        while (queue.length > 0) {
          const { id, depth } = queue.shift();
          if (visited.has(id)) continue;
          visited.add(id);
          transitiveDepth = Math.max(transitiveDepth, depth);
          const [callerFile] = id.split("::");
          transitiveFiles.add(callerFile);
          const nextCallers = symbolCallers.get(id);
          if (nextCallers) {
            for (const nc of nextCallers) {
              if (!visited.has(nc)) queue.push({ id: nc, depth: depth + 1 });
            }
          }
        }
      }
      const totalImpact = Math.max(directCount, usedByCount);
      if (totalImpact > 0) {
        sym.impact = {
          directCallers: directCount,
          fileImporters: usedByCount,
          transitiveDepth,
          impactedFiles: transitiveFiles.size,
          riskLevel: totalImpact > 10 ? "high" : totalImpact > 3 ? "medium" : "low"
        };
      }
    }
  }
  return impactMap;
}
var init_impact = __esm({
  "../src/analyzer/impact.mjs"() {
  }
});

// ../src/llm/tours.mjs
var tours_exports = {};
__export(tours_exports, {
  generateTours: () => generateTours
});
async function generateTours(result, client) {
  const { modules, rootFiles, callGraph, keyFiles } = result;
  if (!callGraph?.edges?.length) return [];
  const allFiles = [...rootFiles || [], ...modules.flatMap((m) => m.files)];
  const adj = /* @__PURE__ */ new Map();
  for (const edge of callGraph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source).push({ target: edge.target, line: edge.line });
  }
  const startPoints = findTourStartPoints(allFiles, keyFiles, callGraph);
  const rawTours = [];
  for (const start of startPoints.slice(0, 6)) {
    const path5 = buildTourPath(start, adj, allFiles);
    if (path5.length >= 3) {
      rawTours.push({ start, path: path5 });
    }
  }
  if (rawTours.length === 0) return [];
  if (client) {
    console.log(`  Generating ${rawTours.length} guided tours...`);
    const tours = [];
    const archTour2 = buildArchitectureTour(modules, result.edges, keyFiles, allFiles);
    if (archTour2) {
      try {
        const enhanced = await enhanceArchTourWithLLM(archTour2, result, client);
        tours.push(enhanced || archTour2);
      } catch {
        tours.push(archTour2);
      }
    }
    for (const raw of rawTours) {
      try {
        const tour = await enhanceTourWithLLM(raw, result, client);
        if (tour) tours.push(tour);
      } catch (err) {
        tours.push(buildBasicTour(raw, allFiles));
      }
    }
    return tours;
  }
  const basicTours = rawTours.map((raw) => buildBasicTour(raw, allFiles));
  const archTour = buildArchitectureTour(modules, result.edges, keyFiles, allFiles);
  if (archTour) basicTours.unshift(archTour);
  return basicTours;
}
function findTourStartPoints(allFiles, keyFiles, callGraph) {
  const points = [];
  for (const file of allFiles) {
    if (!file.isEntryPoint) continue;
    for (const sym of file.symbols) {
      if (sym.kind === "function" && sym.calls?.length > 0) {
        points.push({ file: file.path, symbol: sym.name, reason: "entry point" });
      }
    }
  }
  const callOutCount = /* @__PURE__ */ new Map();
  for (const edge of callGraph.edges) {
    const src = edge.source;
    callOutCount.set(src, (callOutCount.get(src) || 0) + 1);
  }
  const sorted = [...callOutCount.entries()].sort((a, b) => b[1] - a[1]);
  for (const [symId, count] of sorted.slice(0, 10)) {
    if (count < 3) break;
    const [filePath, symName] = symId.split("::");
    if (points.some((p) => p.file === filePath && p.symbol === symName)) continue;
    points.push({ file: filePath, symbol: symName, reason: `${count} calls (orchestrator)` });
  }
  for (const kf of (keyFiles || []).slice(0, 5)) {
    const file = allFiles.find((f) => f.path === kf.path);
    if (!file) continue;
    const mainSym = file.symbols.find((s) => s.exported && s.kind === "function" && s.calls?.length > 0);
    if (mainSym && !points.some((p) => p.file === file.path && p.symbol === mainSym.name)) {
      points.push({ file: file.path, symbol: mainSym.name, reason: "key file" });
    }
  }
  return points;
}
function buildTourPath(start, adj, allFiles, maxDepth = 8) {
  const startId = `${start.file}::${start.symbol}`;
  const path5 = [];
  const visited = /* @__PURE__ */ new Set();
  function dfs(nodeId, depth) {
    if (depth > maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);
    const [filePath, symName] = nodeId.split("::");
    const file = allFiles.find((f) => f.path === filePath || f.path.replace(/\.[^.]+$/, "") === filePath);
    const sym = file?.symbols.find((s) => s.name === symName);
    path5.push({
      file: file?.path || filePath,
      symbol: symName,
      kind: sym?.kind || "unknown",
      line: sym?.line || 0,
      signature: sym?.signature || "",
      comment: sym?.comment || "",
      source: sym?.source?.slice(0, 500) || "",
      callCount: sym?.calls?.length || 0
    });
    const edges = adj.get(nodeId) || [];
    const sorted = edges.filter((e) => !visited.has(e.target)).sort((a, b) => {
      const aFile = a.target.split("::")[0];
      const bFile = b.target.split("::")[0];
      if (aFile !== filePath && bFile === filePath) return -1;
      if (bFile !== filePath && aFile === filePath) return 1;
      return 0;
    });
    for (const edge of sorted.slice(0, 2)) {
      dfs(edge.target, depth + 1);
    }
  }
  dfs(startId, 0);
  return path5;
}
function buildBasicTour(raw, allFiles) {
  const startSym = raw.path[0];
  return {
    id: `tour:${startSym.symbol}`,
    title: `${startSym.symbol} flow`,
    description: `Follow the call chain starting from ${startSym.symbol} in ${startSym.file}`,
    steps: raw.path.map((step, i) => ({
      file: step.file,
      symbol: step.symbol,
      kind: step.kind,
      line: step.line,
      explanation: step.comment || `Step ${i + 1}: ${step.symbol}`,
      callsNext: raw.path[i + 1]?.symbol || null
    }))
  };
}
async function enhanceTourWithLLM(raw, result, client) {
  const stepsContext = raw.path.map((step, i) => {
    let desc = `${i + 1}. ${step.kind} ${step.symbol} in ${step.file} (line ${step.line})`;
    if (step.signature) desc += `
   Signature: ${step.signature.slice(0, 150)}`;
    if (step.comment) desc += `
   Comment: ${step.comment.slice(0, 150)}`;
    if (step.source) desc += `
   Source:
${step.source.slice(0, 300)}`;
    return desc;
  }).join("\n\n");
  const prompt = [
    {
      role: "system",
      content: "You are a code documentation expert. Generate a guided tour explanation for a sequence of function calls. Be concise and factual. Only describe what is present in the code."
    },
    {
      role: "user",
      content: `Generate a guided reading tour for this call chain in the "${result.projectName}" project:

${stepsContext}

Respond in JSON:
{
  "title": "Short descriptive title (5-8 words)",
  "description": "1-2 sentence overview of what this flow does",
  "steps": [
    { "explanation": "1-2 sentences: what this function does and WHY it calls the next step" }
  ]
}

The steps array must have exactly ${raw.path.length} entries, one per step above. Focus on transitions \u2014 explain why each function delegates to the next.`
    }
  ];
  const response = await client.complete(prompt);
  const parsed = parseJSON(response);
  if (!parsed || !parsed.steps || parsed.steps.length !== raw.path.length) {
    return buildBasicTour(raw, []);
  }
  return {
    id: `tour:${raw.path[0].symbol}`,
    title: parsed.title || `${raw.path[0].symbol} flow`,
    description: parsed.description || "",
    steps: raw.path.map((step, i) => ({
      file: step.file,
      symbol: step.symbol,
      kind: step.kind,
      line: step.line,
      explanation: parsed.steps[i]?.explanation || step.comment || `Step ${i + 1}`,
      callsNext: raw.path[i + 1]?.symbol || null
    }))
  };
}
function buildArchitectureTour(modules, edges, keyFiles, allFiles) {
  if (modules.length < 2) return null;
  const steps = [];
  const visited = /* @__PURE__ */ new Set();
  const entryModules = modules.filter((m) => m.files.some((f) => f.isEntryPoint));
  let startModules;
  if (entryModules.length > 0) {
    startModules = entryModules;
  } else {
    const incomingWeight = /* @__PURE__ */ new Map();
    for (const e of edges) {
      const mod = modules.find((m) => m.name === e.target);
      if (mod) incomingWeight.set(e.target, (incomingWeight.get(e.target) || 0) + e.weight);
    }
    const sorted = modules.slice().sort((a, b) => (incomingWeight.get(b.name) || 0) - (incomingWeight.get(a.name) || 0));
    startModules = [sorted[0]];
  }
  const queue = [...startModules.map((m) => m.name)];
  while (queue.length > 0 && steps.length < 12) {
    const modName = queue.shift();
    if (visited.has(modName)) continue;
    visited.add(modName);
    const mod = modules.find((m) => m.name === modName);
    if (!mod) continue;
    const representativeFile = mod.files.find((f) => f.isEntryPoint) || mod.files.find((f) => f.importedByCount > 0) || mod.files[0];
    const mainSymbol = representativeFile?.symbols.find((s) => s.exported && (s.kind === "function" || s.kind === "class")) || representativeFile?.symbols[0];
    steps.push({
      file: representativeFile?.path || mod.path || mod.name,
      symbol: mainSymbol?.name || mod.name,
      kind: "module",
      line: mainSymbol?.line || 0,
      explanation: mod.explanation || `${mod.name}: ${mod.description}`,
      callsNext: null
    });
    const outgoing = edges.filter((e) => e.source === modName).sort((a, b) => b.weight - a.weight);
    const incoming = edges.filter((e) => e.target === modName).sort((a, b) => b.weight - a.weight);
    for (const edge of outgoing) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
    for (const edge of incoming) {
      if (!visited.has(edge.source)) queue.push(edge.source);
    }
  }
  if (steps.length < 2) return null;
  return {
    id: "tour:architecture",
    title: "Architecture Overview",
    description: `Walk through the ${steps.length} main modules and how they connect`,
    steps
  };
}
async function enhanceArchTourWithLLM(tour, result, client) {
  const stepsContext = tour.steps.map((step, i) => {
    const mod = result.modules.find((m) => m.files.some((f) => f.path === step.file));
    return `${i + 1}. Module "${mod?.name || step.symbol}" (${mod?.fileCount || "?"} files, ${mod?.lineCount || "?"} lines)
   Key file: ${step.file}
   Description: ${step.explanation}`;
  }).join("\n\n");
  const edgesSummary = result.edges.slice(0, 20).map((e) => `  ${e.source} \u2192 ${e.target} (${e.weight} imports)`).join("\n");
  const prompt = [
    {
      role: "system",
      content: "You are a software architect giving a guided tour of a codebase. Write clear, engaging explanations that help a new developer understand the architecture."
    },
    {
      role: "user",
      content: `Write an architecture tour for the "${result.projectName}" project.

Modules in tour order:
${stepsContext}

Module dependencies:
${edgesSummary}

Respond in JSON:
{
  "title": "Short descriptive title (5-8 words)",
  "description": "2-3 sentence overview of the project architecture",
  "steps": [
    { "explanation": "1-2 sentences: what this module does, why it matters, and how it connects to the next" }
  ]
}

The steps array must have exactly ${tour.steps.length} entries. Focus on transitions \u2014 explain WHY control/data flows from one module to the next.`
    }
  ];
  const response = await client.complete(prompt);
  const parsed = parseJSON(response);
  if (!parsed?.steps || parsed.steps.length !== tour.steps.length) return null;
  return {
    ...tour,
    title: parsed.title || tour.title,
    description: parsed.description || tour.description,
    steps: tour.steps.map((step, i) => ({
      ...step,
      explanation: parsed.steps[i]?.explanation || step.explanation
    }))
  };
}
function parseJSON(text) {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
      }
    }
    return null;
  }
}
var init_tours = __esm({
  "../src/llm/tours.mjs"() {
  }
});

// ../src/llm/prompts.mjs
function buildModuleExplanationPrompt(mod, edges, extraContext = {}) {
  const { callGraph, impactMap } = extraContext;
  const incomingEdges = edges.filter((e) => e.target === mod.name);
  const outgoingEdges = edges.filter((e) => e.source === mod.name);
  const fileList = mod.files.map((f) => {
    const syms = f.symbols.filter((s) => s.exported).slice(0, 15).map((s) => {
      let desc = `    - ${s.kind} ${s.name}${s.signature ? `: ${s.signature.slice(0, 120)}` : ""}`;
      if (s.calledBy?.length) desc += ` [called by ${s.calledBy.length} other functions]`;
      if (s.calls?.length) desc += ` [calls ${s.calls.length} functions]`;
      return desc;
    }).join("\n");
    const imps = f.imports.slice(0, 10).map((i) => `    - from ${i.source}${i.symbols.length ? ` (${i.symbols.join(", ")})` : ""}`).join("\n");
    let impactInfo = "";
    if (impactMap?.[f.path]) {
      const impact = impactMap[f.path];
      if (impact.riskLevel === "high") {
        impactInfo = `
    \u26A0 HIGH IMPACT: ${impact.transitiveDependents} files depend on this transitively`;
      } else if (impact.riskLevel === "medium") {
        impactInfo = `
    Impact: ${impact.transitiveDependents} transitive dependents`;
      }
    }
    return `  ${f.path} (${f.language}, ${f.lineCount} lines)${impactInfo}${syms ? "\n    Exports:\n" + syms : ""}${imps ? "\n    Imports:\n" + imps : ""}`;
  }).join("\n\n");
  const depsIn = incomingEdges.map((e) => `  \u2190 ${e.source} (${e.weight} imports)`).join("\n") || "  (none)";
  const depsOut = outgoingEdges.map((e) => `  \u2192 ${e.target} (${e.weight} imports)`).join("\n") || "  (none)";
  let callFlowSection = "";
  if (callGraph?.edges?.length) {
    const moduleFiles = new Set(mod.files.map((f) => f.path));
    const inbound = callGraph.edges.filter((e) => {
      const targetFile = e.target.split("::")[0];
      const sourceFile = e.source.split("::")[0];
      return moduleFiles.has(targetFile) && !moduleFiles.has(sourceFile);
    });
    const outbound = callGraph.edges.filter((e) => {
      const sourceFile = e.source.split("::")[0];
      const targetFile = e.target.split("::")[0];
      return moduleFiles.has(sourceFile) && !moduleFiles.has(targetFile);
    });
    if (inbound.length > 0 || outbound.length > 0) {
      callFlowSection = `
Call flow:
  Inbound calls (other modules \u2192 this module): ${inbound.length}
  Outbound calls (this module \u2192 other modules): ${outbound.length}`;
      if (inbound.length > 0) {
        const topInbound = inbound.slice(0, 5).map((e) => `  ${e.source} \u2192 ${e.target}`).join("\n");
        callFlowSection += `
  Top inbound:
${topInbound}`;
      }
    }
  }
  return [
    {
      role: "system",
      content: `You are a code documentation expert. You explain code structure clearly and concisely. Only describe what is present in the provided data. Do not invent files, functions, or structures that are not listed. Be factual and precise.`
    },
    {
      role: "user",
      content: `Analyze this module and provide explanations.

Module: "${mod.name}" (${mod.fileCount} files, ${mod.lineCount} lines)
Languages: ${mod.languages.join(", ")}

Files:
${fileList}

Dependencies from other modules:
${depsIn}

Dependencies to other modules:
${depsOut}
${callFlowSection}

Respond in JSON format:
{
  "moduleExplanation": "1-2 sentence summary of what this module does and its role in the project",
  "files": {
    "<file_path>": "1 sentence summary of what this file does"
  }
}

Only include files listed above. Keep explanations concise and factual.`
    }
  ];
}
function buildArchitecturePrompt(projectData) {
  const { projectName, modules, edges, keyFiles, callGraph, impactMap, languages: languages2 } = projectData;
  const modulesSummary = modules.map((m) => {
    const desc = m.explanation || m.description;
    const impact = m.files.filter((f) => impactMap?.[f.path]?.riskLevel === "high").length;
    let line = `  ${m.name} (${m.fileCount} files, ${m.lineCount} lines): ${desc}`;
    if (impact > 0) line += ` [${impact} high-impact files]`;
    return line;
  }).join("\n");
  const edgesSummary = edges.filter((e) => e.target !== "external").slice(0, 30).map((e) => `  ${e.source} \u2192 ${e.target} (${e.weight} imports)`).join("\n");
  const keyFilesSummary = keyFiles.slice(0, 15).map((f) => {
    const impact = impactMap?.[f.path];
    let line = `  ${f.path} (imported by ${f.importedByCount} files${f.isEntryPoint ? ", entry point" : ""})`;
    if (impact?.riskLevel === "high") line += ` [HIGH RISK: ${impact.transitiveDependents} transitive deps]`;
    return line;
  }).join("\n");
  let callStats = "";
  if (callGraph?.stats) {
    callStats = `
Call graph: ${callGraph.stats.totalCalls} calls, ${callGraph.stats.uniqueCallers} unique callers, ${callGraph.stats.uniqueCallees} unique callees`;
    if (callGraph.stats.ambiguous > 0) callStats += `, ${callGraph.stats.ambiguous} ambiguous`;
  }
  return [
    {
      role: "system",
      content: `You are a senior software architect. You write concise, insightful architecture descriptions that help developers understand a codebase quickly. Focus on data flow, key abstractions, and design decisions \u2014 not just listing files.`
    },
    {
      role: "user",
      content: `Write an architecture overview for this project.

Project: ${projectName}
Languages: ${languages2.join(", ")}
${callStats}

Modules:
${modulesSummary}

Module dependencies:
${edgesSummary}

Key files:
${keyFilesSummary}

Respond in JSON format:
{
  "overview": "3-5 sentence high-level architecture description covering what the system does and how it's organized",
  "dataFlow": "2-3 sentences describing how data flows through the system from entry points to outputs",
  "keyDecisions": ["1 sentence each describing notable architecture/design decisions"],
  "riskAreas": ["1 sentence each identifying areas with high coupling or complexity"]
}

Be factual \u2014 only reference modules and files that exist in the data above.`
    }
  ];
}
function buildSymbolExplanationPrompt(symbols) {
  const symList = symbols.map((s) => {
    let desc = `- ${s.kind} ${s.name} in ${s._filePath} (line ${s.line})`;
    if (s.signature) desc += `
  Signature: ${s.signature.slice(0, 200)}`;
    if (s.comment) desc += `
  Comment: ${s.comment.slice(0, 200)}`;
    if (s.source) desc += `
  Source:
${s.source.slice(0, 500)}`;
    if (s.usedBy?.length) desc += `
  Used by: ${s.usedBy.slice(0, 5).join(", ")}${s.usedBy.length > 5 ? ` (+${s.usedBy.length - 5} more)` : ""}`;
    return desc;
  }).join("\n\n");
  return [
    {
      role: "system",
      content: `You are a code documentation expert. Explain what each symbol does based on its source code, signature, and context. Be concise and factual. Do not invent behavior not evident from the code.`
    },
    {
      role: "user",
      content: `Explain these key symbols:

${symList}

Respond in JSON format:
{
  "<filePath>::<symbolName>": "1 sentence explanation of what this symbol does"
}

Keep explanations concise.`
    }
  ];
}
function buildIdeaStructurePrompt(projectData) {
  const { projectName, modules, edges, keyFiles, languages: languages2 } = projectData;
  const modulesSummary = modules.map((m) => {
    const desc = m.explanation || m.description;
    const files = m.files.slice(0, 8).map(
      (f) => `    ${f.path}${f.explanation ? ": " + f.explanation : ""}`
    ).join("\n");
    return `  ${m.name} (${m.fileCount} files, ${m.lineCount} lines): ${desc}
${files}`;
  }).join("\n\n");
  const edgesSummary = edges.filter((e) => e.target !== "external").slice(0, 30).map((e) => `  ${e.source} \u2192 ${e.target} (${e.weight} imports)`).join("\n");
  const keyFilesSummary = keyFiles.slice(0, 15).map(
    (f) => `  ${f.path} (imported by ${f.importedByCount} files${f.isEntryPoint ? ", entry point" : ""})`
  ).join("\n");
  const validModules = modules.map((m) => m.name);
  const validFiles = modules.flatMap((m) => m.files.map((f) => f.path));
  const validSymbols = modules.flatMap(
    (m) => m.files.flatMap(
      (f) => f.symbols.filter((s) => s.exported).map((s) => `${f.path}::${s.name}`)
    )
  );
  return [
    {
      role: "system",
      content: `You are a software architect who explains projects conceptually. Your job is to create an "idea structure" \u2014 a conceptual map of what a project does, organized by concepts and purposes rather than file paths.

Each idea node represents a concept, feature, or responsibility. Map each idea to actual code (modules, files, symbols) that implements it.

IMPORTANT:
- Only reference code that exists in the provided data
- Valid module names: ${JSON.stringify(validModules)}
- Create 5-15 idea nodes depending on project complexity
- Create edges between ideas that have relationships (e.g., "feeds into", "depends on", "protects")
- All ideas should be at the same level \u2014 no parent-child nesting, no hierarchy
- The idea structure should help someone understand WHAT the project does before HOW it's implemented`
    },
    {
      role: "user",
      content: `Create an idea structure for this project.

Project: ${projectName}
Languages: ${languages2.join(", ")}

Modules:
${modulesSummary}

Dependencies:
${edgesSummary}

Key files:
${keyFilesSummary}

Respond in JSON format:
{
  "projectSummary": "2-3 sentence high-level description of what this project does and its purpose",
  "nodes": [
    {
      "id": "idea:<kebab-case-id>",
      "label": "Human Readable Concept Name",
      "description": "1-2 sentence description of this concept/feature",
      "codeRefs": [
        { "type": "module", "name": "<module-name>" },
        { "type": "file", "path": "<file-path>" },
        { "type": "symbol", "path": "<file-path>", "name": "<symbol-name>" }
      ]
    }
  ],
  "edges": [
    { "source": "idea:<id>", "target": "idea:<id>", "label": "relationship description" }
  ]
}

Only use module names and file paths from the data above. Keep it conceptual \u2014 group by purpose, not by file structure.`
    }
  ];
}
var init_prompts = __esm({
  "../src/llm/prompts.mjs"() {
  }
});

// ../src/llm/explain.mjs
var explain_exports = {};
__export(explain_exports, {
  generateExplanations: () => generateExplanations
});
async function generateExplanations(result, client, options = {}) {
  const { maxConcurrent = 3, symbolThreshold = 2 } = options;
  console.log(`  Explaining ${result.modules.length} modules...`);
  const moduleQueue = [...result.modules];
  let completed = 0;
  async function processModule(mod) {
    try {
      const prompt = buildModuleExplanationPrompt(mod, result.edges, {
        callGraph: result.callGraph,
        impactMap: result.impactMap
      });
      const response = await client.complete(prompt);
      const parsed = parseJSON2(response);
      if (parsed) {
        mod.explanation = parsed.moduleExplanation || "";
        if (parsed.files) {
          for (const file of mod.files) {
            if (parsed.files[file.path]) {
              file.explanation = parsed.files[file.path];
            }
          }
        }
      }
    } catch (err) {
      console.warn(`  Warning: Failed to explain module "${mod.name}": ${err.message}`);
    }
    completed++;
    process.stdout.write(`\r  Modules: ${completed}/${result.modules.length}`);
  }
  await runWithConcurrency(moduleQueue, processModule, maxConcurrent);
  console.log("");
  const keySymbols = collectKeySymbols(result, symbolThreshold);
  if (keySymbols.length > 0) {
    console.log(`  Explaining ${keySymbols.length} key symbols...`);
    const batches = chunk(keySymbols, 15);
    let symCompleted = 0;
    for (const batch of batches) {
      try {
        const prompt = buildSymbolExplanationPrompt(batch);
        const response = await client.complete(prompt);
        const parsed = parseJSON2(response);
        if (parsed) {
          for (const sym of batch) {
            const key = `${sym._filePath}::${sym.name}`;
            if (parsed[key]) {
              sym.explanation = parsed[key];
            }
          }
        }
      } catch (err) {
        console.warn(`  Warning: Failed to explain symbol batch: ${err.message}`);
      }
      symCompleted += batch.length;
      process.stdout.write(`\r  Symbols: ${symCompleted}/${keySymbols.length}`);
    }
    console.log("");
  }
  for (const sym of keySymbols) {
    delete sym._filePath;
    delete sym._moduleName;
  }
  console.log("  Generating architecture overview...");
  try {
    const prompt = buildArchitecturePrompt(result);
    const response = await client.complete(prompt);
    const parsed = parseJSON2(response);
    if (parsed) {
      result.architecture = parsed;
    }
  } catch (err) {
    console.warn(`  Warning: Failed to generate architecture overview: ${err.message}`);
  }
}
function collectKeySymbols(result, threshold) {
  const symbols = [];
  for (const mod of result.modules) {
    for (const file of mod.files) {
      for (const sym of file.symbols) {
        if (sym.exported && (sym.usedBy?.length || 0) >= threshold) {
          sym._filePath = file.path;
          sym._moduleName = mod.name;
          symbols.push(sym);
        }
      }
    }
  }
  return symbols;
}
async function runWithConcurrency(items, fn, limit) {
  const queue = [...items];
  const running = [];
  while (queue.length > 0 || running.length > 0) {
    while (running.length < limit && queue.length > 0) {
      const item = queue.shift();
      const promise = fn(item).then(() => {
        running.splice(running.indexOf(promise), 1);
      });
      running.push(promise);
    }
    if (running.length > 0) {
      await Promise.race(running);
    }
  }
}
function parseJSON2(text) {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        console.warn("  Warning: Could not parse LLM JSON response");
      }
    }
    return null;
  }
}
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
var init_explain = __esm({
  "../src/llm/explain.mjs"() {
    init_prompts();
  }
});

// ../src/llm/ideas.mjs
var ideas_exports = {};
__export(ideas_exports, {
  generateIdeaStructure: () => generateIdeaStructure
});
async function generateIdeaStructure(result, client) {
  try {
    const prompt = buildIdeaStructurePrompt(result);
    const response = await client.complete(prompt, { maxTokens: 8192 });
    const parsed = parseJSON3(response);
    if (!parsed || !parsed.nodes) {
      console.warn("  Warning: LLM returned invalid idea structure");
      return null;
    }
    const { validated, removedRefs, totalRefs } = validateIdeaStructure(parsed, result);
    if (totalRefs > 0 && removedRefs / totalRefs > 0.4) {
      console.log(`  Retrying idea structure (${removedRefs}/${totalRefs} refs were invalid)...`);
      try {
        const retryPrompt = buildRetryPrompt(validated, result, removedRefs);
        const retryResponse = await client.complete(retryPrompt, { maxTokens: 8192 });
        const retryParsed = parseJSON3(retryResponse);
        if (retryParsed?.nodes) {
          const retry = validateIdeaStructure(retryParsed, result);
          return addConfidenceWeights(retry.validated, result);
        }
      } catch {
      }
    }
    return addConfidenceWeights(validated, result);
  } catch (err) {
    console.warn(`  Warning: Failed to generate idea structure: ${err.message}`);
    return null;
  }
}
function buildRetryPrompt(validated, result, removedCount) {
  const validModules = result.modules.map((m) => m.name);
  const validFiles = result.modules.flatMap((m) => m.files.map((f) => f.path));
  return [
    {
      role: "system",
      content: `You are a software architect. Your previous idea structure had ${removedCount} invalid code references that were removed. Please regenerate with ONLY valid references.

VALID module names: ${JSON.stringify(validModules)}
VALID file paths (first 50): ${JSON.stringify(validFiles.slice(0, 50))}

Only use module names and file paths from these lists.`
    },
    {
      role: "user",
      content: `Here is your previous idea structure with invalid refs stripped. Please regenerate it with corrected code references. Keep the same conceptual structure but fix the references.

${JSON.stringify(validated, null, 2)}

Respond in the same JSON format with nodes and edges.`
    }
  ];
}
function addConfidenceWeights(idea, result) {
  if (!idea?.nodes) return idea;
  const importCounts = /* @__PURE__ */ new Map();
  for (const kf of result.keyFiles || []) {
    importCounts.set(kf.path, kf.importedByCount);
  }
  for (const node of idea.nodes) {
    if (!node.codeRefs) continue;
    for (const ref of node.codeRefs) {
      if (ref.type === "symbol") {
        ref.confidence = 1;
      } else if (ref.type === "file") {
        const imports = importCounts.get(ref.path) || 0;
        ref.confidence = 0.6 + Math.min(0.3, imports * 0.03);
      } else if (ref.type === "module") {
        ref.confidence = 0.4;
      }
    }
    node.codeRefs.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  }
  return idea;
}
function validateIdeaStructure(idea, result) {
  const validModules = new Set(result.modules.map((m) => m.name));
  const validFiles = new Set(result.modules.flatMap((m) => m.files.map((f) => f.path)));
  const validSymbols = new Set(result.modules.flatMap(
    (m) => m.files.flatMap((f) => f.symbols.filter((s) => s.exported).map((s) => `${f.path}::${s.name}`))
  ));
  if (result.rootFiles) {
    for (const f of result.rootFiles) {
      validFiles.add(f.path);
      for (const s of f.symbols.filter((s2) => s2.exported)) {
        validSymbols.add(`${f.path}::${s.name}`);
      }
    }
  }
  const nodeIds = new Set(idea.nodes.map((n) => n.id));
  let removedRefs = 0;
  let totalRefs = 0;
  for (const node of idea.nodes) {
    delete node.parentId;
    if (node.codeRefs) {
      totalRefs += node.codeRefs.length;
      const validRefs = [];
      for (const ref of node.codeRefs) {
        if (ref.type === "module" && validModules.has(ref.name)) {
          validRefs.push(ref);
        } else if (ref.type === "file" && validFiles.has(ref.path)) {
          validRefs.push(ref);
        } else if (ref.type === "symbol" && validSymbols.has(`${ref.path}::${ref.name}`)) {
          validRefs.push(ref);
        } else {
          removedRefs++;
        }
      }
      node.codeRefs = validRefs;
    }
  }
  if (idea.edges) {
    idea.edges = idea.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  }
  if (removedRefs > 0) {
    console.warn(`  Removed ${removedRefs}/${totalRefs} hallucinated code references from idea structure`);
  }
  return { validated: idea, removedRefs, totalRefs };
}
function parseJSON3(text) {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
      }
    }
    return null;
  }
}
var init_ideas = __esm({
  "../src/llm/ideas.mjs"() {
    init_prompts();
  }
});

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode6 = __toESM(require("vscode"));

// src/analyzer.ts
var path = __toESM(require("path"));

// ../src/analyzer/index.mjs
var import_promises3 = require("fs/promises");
var import_path8 = require("path");

// ../src/analyzer/walker.mjs
var import_promises = require("fs/promises");
var import_path = require("path");
var DEFAULT_IGNORE = /* @__PURE__ */ new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "dist",
  "build",
  "out",
  ".next",
  ".cache",
  "vendor",
  "coverage",
  ".mypy_cache",
  ".pytest_cache",
  "env",
  ".tox",
  ".eggs",
  ".cargo",
  ".gradle",
  "bin",
  "obj",
  ".idea",
  ".vscode",
  ".DS_Store"
]);
function parseGitignorePatterns(content) {
  const patterns = [];
  for (let line of content.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    if (negated) line = line.slice(1);
    const dirOnly = line.endsWith("/");
    if (dirOnly) line = line.slice(0, -1);
    patterns.push({ raw: line, negated, dirOnly });
  }
  return patterns;
}
function matchesPattern(relPath, name, isDir, pattern) {
  const { raw, dirOnly } = pattern;
  if (dirOnly && !isDir) return false;
  if (raw.includes("/")) {
    const pat = raw.startsWith("/") ? raw.slice(1) : raw;
    return globMatch(relPath, pat);
  }
  return globMatch(name, raw);
}
function globMatch(str, pattern) {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += 2;
      if (pattern[i] === "/") i++;
    } else if (pattern[i] === "*") {
      re += "[^/]*";
      i++;
    } else if (pattern[i] === "?") {
      re += "[^/]";
      i++;
    } else if (".+^${}()|[]\\".includes(pattern[i])) {
      re += "\\" + pattern[i];
      i++;
    } else {
      re += pattern[i];
      i++;
    }
  }
  return new RegExp("^" + re + "$").test(str);
}
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
    const content = await (0, import_promises.readFile)((0, import_path.join)(dir, ".gitignore"), "utf-8");
    return parseGitignorePatterns(content);
  } catch {
    return [];
  }
}
async function walkDir(dir, extraIgnore = []) {
  const ignore = /* @__PURE__ */ new Set([...DEFAULT_IGNORE, ...extraIgnore]);
  const gitignorePatterns = await loadGitignore(dir);
  const results = [];
  const visitedDirs = /* @__PURE__ */ new Set();
  async function recurse(current) {
    let realDir;
    try {
      realDir = await (0, import_promises.realpath)(current);
    } catch {
      return;
    }
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);
    const entries = await (0, import_promises.readdir)(current, { withFileTypes: true });
    const promises = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") {
        if (ignore.has(entry.name)) continue;
      }
      if (ignore.has(entry.name)) continue;
      const fullPath = (0, import_path.join)(current, entry.name);
      const relPath = (0, import_path.relative)(dir, fullPath);
      const isDir = entry.isDirectory();
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

// ../src/analyzer/detector.mjs
var EXTENSION_MAP = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".hxx": "cpp",
  ".java": "java"
};
function detectLanguage(filePath) {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filePath.slice(dot).toLowerCase();
  return EXTENSION_MAP[ext] || null;
}

// ../src/analyzer/parser.mjs
var import_module = require("module");
init_languages();
var require2 = (0, import_module.createRequire)(importMetaUrl);
var Parser = require2("tree-sitter");
var parserCache = /* @__PURE__ */ new Map();
function getParser(langId) {
  if (parserCache.has(langId)) return parserCache.get(langId);
  const lang = getLanguage(langId);
  if (!lang) return null;
  const parser = new Parser();
  const grammar = lang.loadGrammar(require2);
  parser.setLanguage(grammar);
  parserCache.set(langId, { parser, lang });
  return { parser, lang };
}
function parseFile(content, langId) {
  const cached = getParser(langId);
  if (!cached) return null;
  const { parser, lang } = cached;
  const tree = parser.parse((index) => content.slice(index, index + 4096));
  const rootNode = tree.rootNode;
  const symbols = lang.extractSymbols(rootNode, content);
  const imports = lang.extractImports(rootNode, content);
  return { symbols, imports, rootNode, content };
}

// ../src/analyzer/index.mjs
init_languages();

// ../src/analyzer/references.mjs
function buildCrossReferences(modules, rootFiles) {
  const symbolMap = /* @__PURE__ */ new Map();
  const allFiles = [...rootFiles, ...modules.flatMap((m) => m.files)];
  for (const file of allFiles) {
    for (const sym of file.symbols) {
      if (!sym.exported) continue;
      if (!symbolMap.has(sym.name)) symbolMap.set(sym.name, []);
      symbolMap.get(sym.name).push({ filePath: file.path, symbol: sym });
    }
  }
  for (const file of allFiles) {
    for (const imp of file.imports) {
      if (imp.resolvedModule === "external") continue;
      for (const symName of imp.symbols) {
        const defs = symbolMap.get(symName);
        if (!defs) continue;
        const match = defs.find(
          (d) => imp.resolvedPath && (d.filePath === imp.resolvedPath || d.filePath.replace(/\.[^./]+$/, "") === imp.resolvedPath.replace(/\.[^./]+$/, ""))
        ) || defs[0];
        if (match && !match.symbol.usedBy.includes(file.path)) {
          match.symbol.usedBy.push(file.path);
        }
      }
    }
  }
}

// ../src/analyzer/file-index.mjs
var import_path6 = require("path");
var INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs"];
var PY_INIT_FILES = ["__init__.py"];
function buildFileIndex(absolutePaths, projectRoot) {
  const byPathNoExt = /* @__PURE__ */ new Map();
  const byExactPath = /* @__PURE__ */ new Map();
  const byDirIndex = /* @__PURE__ */ new Map();
  for (const absPath of absolutePaths) {
    const rel = (0, import_path6.relative)(projectRoot, absPath);
    byExactPath.set(rel, rel);
    const noExt = rel.replace(/\.[^./]+$/, "");
    if (!byPathNoExt.has(noExt)) {
      byPathNoExt.set(noExt, rel);
    }
    const fileName = rel.split("/").pop();
    if (INDEX_FILES.includes(fileName) || PY_INIT_FILES.includes(fileName)) {
      const dir = (0, import_path6.dirname)(rel);
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
      if (byExactPath.has(pathNoExt)) return pathNoExt;
      if (byPathNoExt.has(pathNoExt)) return byPathNoExt.get(pathNoExt);
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
    }
  };
}

// ../src/analyzer/index.mjs
init_modules();

// ../src/analyzer/cache.mjs
var import_promises2 = require("fs/promises");
var import_path7 = require("path");
var import_crypto = require("crypto");
var CACHE_FILE = ".codesight-cache.json";
var CACHE_VERSION = 1;
async function loadCache(projectRoot) {
  try {
    const raw = await (0, import_promises2.readFile)((0, import_path7.resolve)(projectRoot, CACHE_FILE), "utf-8");
    const data = JSON.parse(raw);
    if (data.version !== CACHE_VERSION) return createEmptyCache();
    return data;
  } catch {
    return createEmptyCache();
  }
}
async function checkTsconfigHash(cache, projectRoot) {
  try {
    const raw = await (0, import_promises2.readFile)((0, import_path7.resolve)(projectRoot, "tsconfig.json"), "utf-8");
    const hash = hashContent(raw);
    if (cache.tsconfigHash && cache.tsconfigHash !== hash) {
      cache.files = {};
    }
    cache.tsconfigHash = hash;
  } catch {
    if (cache.tsconfigHash) {
      cache.files = {};
      delete cache.tsconfigHash;
    }
  }
}
async function saveCache(projectRoot, cache) {
  try {
    const path5 = (0, import_path7.resolve)(projectRoot, CACHE_FILE);
    await (0, import_promises2.writeFile)(path5, JSON.stringify(cache), "utf-8");
  } catch (err) {
    console.warn(`  Warning: Could not write cache: ${err.message}`);
  }
}
function hashContent(content) {
  return (0, import_crypto.createHash)("sha1").update(content).digest("hex").slice(0, 16);
}
function getCachedParse(cache, relPath, contentHash) {
  const entry = cache.files?.[relPath];
  if (entry && entry.hash === contentHash) {
    return entry.result;
  }
  return null;
}
function setCachedParse(cache, relPath, contentHash, result) {
  if (!cache.files) cache.files = {};
  cache.files[relPath] = {
    hash: contentHash,
    result
  };
}
function pruneCache(cache, currentRelPaths) {
  if (!cache.files) return;
  const validPaths = new Set(currentRelPaths);
  for (const path5 of Object.keys(cache.files)) {
    if (!validPaths.has(path5)) {
      delete cache.files[path5];
    }
  }
}
function createEmptyCache() {
  return { version: CACHE_VERSION, files: {} };
}

// ../src/analyzer/index.mjs
var BATCH_SIZE = 30;
function detectSourceRoot(files, projectRoot) {
  const srcDirs = ["src", "lib", "app", "source"];
  for (const dir of srcDirs) {
    const prefix = dir + "/";
    const count = files.filter((f) => {
      const rel = (0, import_path8.relative)(projectRoot, f);
      return rel.startsWith(prefix);
    }).length;
    if (count > files.length * 0.3) {
      return (0, import_path8.resolve)(projectRoot, dir);
    }
  }
  return projectRoot;
}
async function detectProjectName(projectRoot) {
  const checks = [
    { file: "package.json", extract: (c) => JSON.parse(c).name },
    { file: "pyproject.toml", extract: (c) => c.match(/name\s*=\s*"([^"]+)"/)?.[1] },
    { file: "Cargo.toml", extract: (c) => c.match(/name\s*=\s*"([^"]+)"/)?.[1] },
    { file: "go.mod", extract: (c) => c.match(/module\s+(\S+)/)?.[1]?.split("/").pop() }
  ];
  for (const { file, extract } of checks) {
    try {
      const content = await (0, import_promises3.readFile)((0, import_path8.resolve)(projectRoot, file), "utf-8");
      const name = extract(content);
      if (name) return name;
    } catch {
    }
  }
  return (0, import_path8.basename)(projectRoot);
}
async function detectEntryPoints(projectRoot, allFiles) {
  const entryPoints = /* @__PURE__ */ new Set();
  const allPaths = allFiles.map((f) => f.path);
  try {
    const pkg = JSON.parse(await (0, import_promises3.readFile)((0, import_path8.resolve)(projectRoot, "package.json"), "utf-8"));
    const candidates = [];
    if (pkg.main) candidates.push(pkg.main);
    if (pkg.bin) {
      if (typeof pkg.bin === "string") candidates.push(pkg.bin);
      else for (const v of Object.values(pkg.bin)) candidates.push(v);
    }
    if (pkg.exports) {
      const walk = (obj) => {
        if (typeof obj === "string") candidates.push(obj);
        else if (obj && typeof obj === "object") Object.values(obj).forEach(walk);
      };
      walk(pkg.exports);
    }
    for (const c of candidates) {
      const rel = c.replace(/^\.\//, "");
      const match = allPaths.find((p) => p === rel || p.replace(/\.[^.]+$/, "") === rel.replace(/\.[^.]+$/, ""));
      if (match) entryPoints.add(match);
    }
  } catch {
  }
  try {
    const toml = await (0, import_promises3.readFile)((0, import_path8.resolve)(projectRoot, "pyproject.toml"), "utf-8");
    const scriptSection = toml.match(/\[(?:project\.scripts|tool\.poetry\.scripts)\]([\s\S]*?)(?:\n\[|$)/);
    if (scriptSection) {
      const entries = scriptSection[1].matchAll(/=\s*"([^"]+)"/g);
      for (const m of entries) {
        const modulePath = m[1].split(":")[0].replace(/\./g, "/");
        const match = allPaths.find((p) => p.includes(modulePath));
        if (match) entryPoints.add(match);
      }
    }
  } catch {
  }
  const entryNames = /^(main|index|app|cli|server|__main__)\.[^.]+$/;
  for (const p of allPaths) {
    const name = (0, import_path8.basename)(p);
    if (entryNames.test(name)) {
      const depth = p.split("/").length;
      if (depth <= 2 || p.includes("entrypoint") || p.includes("bin/")) {
        entryPoints.add(p);
      }
    }
  }
  return entryPoints;
}
async function analyze(projectRoot, options = {}) {
  const startTime = Date.now();
  const { extraIgnore = [], maxFiles = 5e3 } = options;
  const warnings = [];
  console.log(`Scanning ${projectRoot}...`);
  const allPaths = await walkDir(projectRoot, extraIgnore);
  const supportedFiles = [];
  const langCounts = {};
  for (const filePath of allPaths) {
    const langId = detectLanguage(filePath);
    if (!langId) continue;
    supportedFiles.push({ path: filePath, langId });
    langCounts[langId] = (langCounts[langId] || 0) + 1;
  }
  if (supportedFiles.length > maxFiles) {
    console.warn(`Warning: ${supportedFiles.length} files found, limiting to ${maxFiles}`);
    supportedFiles.length = maxFiles;
  }
  console.log(`Found ${supportedFiles.length} files (${Object.entries(langCounts).map(([k, v]) => `${v} ${k}`).join(", ")})`);
  const sourceRoot = detectSourceRoot(supportedFiles.map((f) => f.path), projectRoot);
  const projectName = await detectProjectName(projectRoot);
  const languages2 = Object.keys(langCounts);
  const fileIndex = buildFileIndex(supportedFiles.map((f) => f.path), projectRoot);
  try {
    const tsconfigPath = (0, import_path8.resolve)(projectRoot, "tsconfig.json");
    const tsconfigRaw = await (0, import_promises3.readFile)(tsconfigPath, "utf-8");
    const stripped = tsconfigRaw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/,\s*([\]}])/g, "$1");
    const tsconfig = JSON.parse(stripped);
    const co = tsconfig.compilerOptions || {};
    if (co.paths || co.baseUrl) {
      fileIndex.tsconfig = { paths: co.paths || {}, baseUrl: co.baseUrl || "." };
      console.log(`  tsconfig.json: ${Object.keys(co.paths || {}).length} path aliases, baseUrl="${co.baseUrl || "."}"`);
    }
  } catch {
  }
  const cache = await loadCache(projectRoot);
  await checkTsconfigHash(cache, projectRoot);
  const moduleMap = /* @__PURE__ */ new Map();
  let cacheHits = 0;
  for (let i = 0; i < supportedFiles.length; i += BATCH_SIZE) {
    const batch = supportedFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ({ path: filePath, langId }) => {
        try {
          const content = await (0, import_promises3.readFile)(filePath, "utf-8");
          const lineCount = content.split("\n").length;
          const lang = getLanguage(langId);
          const relPath = (0, import_path8.relative)(projectRoot, filePath);
          const contentHash = hashContent(content);
          const cached = getCachedParse(cache, relPath, contentHash);
          let symbols, imports, rootNode;
          if (cached) {
            symbols = cached.symbols;
            rootNode = null;
            cacheHits++;
            const hasFunctions = symbols.some((s) => s.kind === "function" || s.kind === "method");
            if (hasFunctions) {
              const parsed = parseFile(content, langId);
              if (parsed) rootNode = parsed.rootNode;
            }
            imports = cached.rawImports;
          } else {
            const parsed = parseFile(content, langId);
            if (!parsed) return null;
            symbols = parsed.symbols;
            rootNode = parsed.rootNode;
            imports = parsed.imports;
            setCachedParse(cache, relPath, contentHash, {
              symbols: symbols.map((s) => ({ ...s, usedBy: [] })),
              // strip transient fields
              rawImports: imports
            });
          }
          const resolvedImports = imports.map((imp) => {
            const resolved = lang.resolveImport(imp.source, filePath, projectRoot, fileIndex);
            return {
              source: imp.source,
              resolvedPath: resolved.resolvedPath,
              resolvedModule: resolved.resolvedModule,
              symbols: imp.symbols,
              typeOnly: imp.typeOnly || false
            };
          });
          const moduleName = lang.getModulePath(filePath, projectRoot);
          return {
            moduleName,
            fileInfo: {
              name: (0, import_path8.basename)(filePath),
              path: relPath,
              language: langId,
              lineCount,
              symbols,
              imports: resolvedImports,
              _rootNode: rootNode
              // transient: used by callgraph, stripped before serialization
            }
          };
        } catch (err) {
          console.warn(`  Warning: failed to parse ${(0, import_path8.relative)(projectRoot, filePath)}: ${err.message}`);
          return null;
        }
      })
    );
    for (const result2 of results) {
      if (!result2) continue;
      const { moduleName, fileInfo } = result2;
      if (!moduleMap.has(moduleName)) {
        moduleMap.set(moduleName, { files: [], lineCount: 0, languages: /* @__PURE__ */ new Set() });
      }
      const mod = moduleMap.get(moduleName);
      mod.files.push(fileInfo);
      mod.lineCount += fileInfo.lineCount;
      mod.languages.add(fileInfo.language);
    }
    if (i + BATCH_SIZE < supportedFiles.length) {
      process.stdout.write(`  Parsed ${Math.min(i + BATCH_SIZE, supportedFiles.length)}/${supportedFiles.length} files\r`);
    }
  }
  console.log(`  Parsed ${supportedFiles.length}/${supportedFiles.length} files${cacheHits > 0 ? ` (${cacheHits} cached)` : ""}`);
  pruneCache(cache, supportedFiles.map((f) => (0, import_path8.relative)(projectRoot, f.path)));
  await saveCache(projectRoot, cache);
  const refinedModuleMap = refineModuleGrouping(moduleMap, projectRoot);
  const modules = [];
  const rootFiles = [];
  for (const [name, data] of refinedModuleMap.entries()) {
    const totalSymbols = data.files.reduce((s, f) => s + f.symbols.length, 0);
    const totalFunctions = data.files.reduce((s, f) => s + f.symbols.filter((sym) => sym.kind === "function").length, 0);
    const totalClasses = data.files.reduce((s, f) => s + f.symbols.filter((sym) => sym.kind === "class").length, 0);
    const totalTypes = data.files.reduce((s, f) => s + f.symbols.filter((sym) => ["type", "interface"].includes(sym.kind)).length, 0);
    const descParts = [`${data.files.length} files`];
    if (totalFunctions) descParts.push(`${totalFunctions} functions`);
    if (totalClasses) descParts.push(`${totalClasses} classes`);
    if (totalTypes) descParts.push(`${totalTypes} types`);
    const entry = {
      name,
      path: name === "root" ? "" : name,
      description: descParts.join(", "),
      fileCount: data.files.length,
      lineCount: data.lineCount,
      languages: [...data.languages],
      files: data.files.sort((a, b) => b.lineCount - a.lineCount)
    };
    if (name === "root") {
      rootFiles.push(...entry.files);
    } else {
      modules.push(entry);
    }
  }
  modules.sort((a, b) => b.lineCount - a.lineCount);
  const edgeMap = /* @__PURE__ */ new Map();
  const allFileInfos = [...rootFiles, ...modules.flatMap((m) => m.files)];
  const fileToModule = /* @__PURE__ */ new Map();
  for (const [name, data] of refinedModuleMap.entries()) {
    for (const f of data.files) {
      fileToModule.set(f.path, name);
    }
  }
  for (const file of allFileInfos) {
    for (const imp of file.imports) {
      if (imp.resolvedPath && imp.resolvedModule !== "external") {
        imp.resolvedModule = fileToModule.get(imp.resolvedPath) || imp.resolvedModule;
      }
    }
  }
  for (const file of allFileInfos) {
    const srcMod = fileToModule.get(file.path) || "root";
    for (const imp of file.imports) {
      if (imp.resolvedModule === "external" || !imp.resolvedPath) continue;
      const targetModule = fileToModule.get(imp.resolvedPath) || imp.resolvedModule;
      if (targetModule === "external" || targetModule === srcMod) continue;
      const key = `${srcMod}\u2192${targetModule}`;
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
    }
  }
  const edges = [];
  for (const [key, weight] of edgeMap.entries()) {
    const [source, target] = key.split("\u2192");
    edges.push({ source, target, weight });
  }
  edges.sort((a, b) => b.weight - a.weight);
  buildCrossReferences(modules, rootFiles);
  const entryPointPaths = await detectEntryPoints(projectRoot, allFileInfos);
  for (const file of allFileInfos) {
    file.isEntryPoint = entryPointPaths.has(file.path);
  }
  const importedByCount = /* @__PURE__ */ new Map();
  for (const file of allFileInfos) {
    for (const imp of file.imports) {
      if (imp.resolvedModule === "external" || !imp.resolvedPath) continue;
      if (fileIndex.has(imp.resolvedPath)) {
        importedByCount.set(imp.resolvedPath, (importedByCount.get(imp.resolvedPath) || 0) + 1);
      }
    }
  }
  for (const file of allFileInfos) {
    file.importedByCount = importedByCount.get(file.path) || 0;
  }
  const keyFiles = allFileInfos.filter((f) => f.importedByCount > 0).sort((a, b) => b.importedByCount - a.importedByCount).slice(0, 20).map((f) => ({ path: f.path, name: f.name, importedByCount: f.importedByCount, isEntryPoint: f.isEntryPoint }));
  console.log("  Building call graph...");
  const { buildCallGraph: buildCallGraph2 } = await Promise.resolve().then(() => (init_callgraph(), callgraph_exports));
  const callGraph = buildCallGraph2(modules, rootFiles, projectRoot, warnings);
  console.log(`  Call graph: ${callGraph.stats.totalCalls} calls (${callGraph.stats.exact} exact, ${callGraph.stats.inferred} inferred, ${callGraph.stats.ambiguous} ambiguous, ${callGraph.stats.unresolved} unresolved)`);
  for (const file of allFileInfos) {
    delete file._rootNode;
  }
  const { computeImpact: computeImpact2 } = await Promise.resolve().then(() => (init_impact(), impact_exports));
  const impactMap = computeImpact2(modules, rootFiles, callGraph);
  const impactedFileCount = Object.keys(impactMap).length;
  const elapsed = Date.now() - startTime;
  console.log(`Done in ${elapsed}ms`);
  console.log(`  ${modules.length} modules, ${rootFiles.length} root files`);
  console.log(`  ${edges.length} module-to-module edges`);
  console.log(`  ${allFileInfos.reduce((s, f) => s + f.symbols.length, 0)} symbols extracted`);
  console.log(`  ${entryPointPaths.size} entry points, ${keyFiles.length} key files`);
  console.log(`  ${impactedFileCount} files with dependents`);
  if (warnings.length > 0) {
    console.warn(`  ${warnings.length} warning(s) during analysis`);
  }
  const result = {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    projectName,
    languages: languages2,
    modules,
    rootFiles,
    edges,
    keyFiles,
    callGraph,
    impactMap,
    warnings
  };
  if (callGraph.edges.length > 0) {
    const { generateTours: generateTours2 } = await Promise.resolve().then(() => (init_tours(), tours_exports));
    const basicTours = await generateTours2(result, null);
    if (basicTours.length > 0) {
      result.tours = basicTours;
    }
  }
  if (options.llm) {
    const { generateExplanations: generateExplanations2 } = await Promise.resolve().then(() => (init_explain(), explain_exports));
    const { generateIdeaStructure: generateIdeaStructure2 } = await Promise.resolve().then(() => (init_ideas(), ideas_exports));
    console.log("\nGenerating LLM explanations...");
    await generateExplanations2(result, options.llm);
    console.log("Generating idea structure...");
    const ideaStructure = await generateIdeaStructure2(result, options.llm);
    if (ideaStructure) {
      result.ideaStructure = ideaStructure;
    }
    console.log("Generating guided tours...");
    const { generateTours: generateTours2 } = await Promise.resolve().then(() => (init_tours(), tours_exports));
    const tours = await generateTours2(result, options.llm);
    if (tours.length > 0) {
      result.tours = tours;
      console.log(`  ${tours.length} tours generated`);
    }
    result.llmGenerated = true;
    result.llmProvider = options.llm.provider;
    result.llmModel = options.llm.model;
    const usage = options.llm.getUsage();
    console.log(`
LLM usage: ~${usage.inputTokens} input tokens, ~${usage.outputTokens} output tokens`);
  }
  return result;
}

// src/analyzer.ts
var AnalyzerWrapper = class {
  constructor(workspaceRoot) {
    this.result = null;
    this.workspaceRoot = workspaceRoot;
  }
  async runFullAnalysis() {
    try {
      console.log("[codesight] Running analysis on:", this.workspaceRoot);
      this.result = await analyze(this.workspaceRoot, { llm: false, cache: true });
      console.log("[codesight] Analysis complete. Modules:", this.result?.modules?.length);
      return this.result;
    } catch (err) {
      console.error("[codesight] Analysis failed:", err.message, err.stack);
      return null;
    }
  }
  async runIncrementalUpdate(filePath) {
    return this.runFullAnalysis();
  }
  getResult() {
    return this.result;
  }
  getImpactMap() {
    return this.result?.impactMap || {};
  }
  getCallGraph() {
    return this.result?.callGraph || null;
  }
  getModules() {
    return this.result?.modules || [];
  }
  findSymbolAtLine(filePath, line) {
    if (!this.result) return null;
    const relPath = path.relative(this.workspaceRoot, filePath);
    for (const mod of this.result.modules) {
      for (const file of mod.files || []) {
        if (file.path === relPath || file.path === filePath) {
          let closest = null;
          let minDist = Infinity;
          for (const sym of file.symbols || []) {
            const dist = Math.abs(sym.line - line);
            if (dist < minDist) {
              minDist = dist;
              closest = sym;
            }
          }
          return closest;
        }
      }
    }
    return null;
  }
};

// src/webview.ts
var vscode = __toESM(require("vscode"));
var crypto = __toESM(require("crypto"));
function getNonce() {
  return crypto.randomBytes(16).toString("base64");
}
var WebviewManager = class {
  constructor(extensionUri) {
    this.panel = null;
    this.messageHandlers = [];
    this.extensionUri = extensionUri;
  }
  createOrShow(context) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return this.panel;
    }
    this.panel = vscode.window.createWebviewPanel(
      "codesightGraph",
      "Codesight Graph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "web"),
          vscode.Uri.joinPath(this.extensionUri, "media")
        ]
      }
    );
    this.panel.webview.html = this.getWebviewContent(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg) => {
      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    }, null, context.subscriptions);
    this.panel.onDidDispose(() => {
      this.panel = null;
    }, null, context.subscriptions);
    return this.panel;
  }
  postMessage(msg) {
    this.panel?.webview.postMessage(msg);
  }
  onMessage(handler) {
    this.messageHandlers.push(handler);
  }
  getWebviewContent(webview) {
    const webDir = vscode.Uri.joinPath(this.extensionUri, "web");
    const webSrcUri = webview.asWebviewUri(vscode.Uri.joinPath(webDir, "src"));
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src ${webview.cspSource} https://esm.run https://cdn.jsdelivr.net https://cdnjs.cloudflare.com 'nonce-${nonce}';
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} https: data:;
    font-src ${webview.cspSource};
    connect-src https://esm.run https://cdn.jsdelivr.net;
  ">
  <title>Codesight Graph</title>
  <script nonce="${nonce}" src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.4/cytoscape.min.js"></script>
  <script nonce="${nonce}" type="importmap">
  {
    "imports": {
      "lit": "https://esm.run/lit@3.2.1",
      "lit/": "https://esm.run/lit@3.2.1/",
      "@lit/reactive-element": "https://esm.run/@lit/reactive-element@2.1.0",
      "@lit/reactive-element/": "https://esm.run/@lit/reactive-element@2.1.0/",
      "lit-html": "https://esm.run/lit-html@3.2.1",
      "lit-html/": "https://esm.run/lit-html@3.2.1/",
      "lit-element/": "https://esm.run/lit-element@4.1.1/"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1e1e2e; height: 100vh; overflow: hidden; }
  </style>
</head>
<body>
  <cs-app>
    <cs-sidebar slot="sidebar">
      <cs-explorer slot="explorer"></cs-explorer>
      <cs-search-panel slot="search"></cs-search-panel>
      <cs-tour-panel slot="tours"></cs-tour-panel>
    </cs-sidebar>
    <cs-graph slot="graph"></cs-graph>
    <cs-chat slot="chat"></cs-chat>
  </cs-app>
  <cs-global-search></cs-global-search>
  <cs-code-popup></cs-code-popup>
  <script nonce="${nonce}">
    // Set flags SYNCHRONOUSLY before any modules load
    window.__CODESIGHT_VSCODE__ = acquireVsCodeApi();
    window.__CODESIGHT_WEBVIEW__ = true;
  </script>
  <script nonce="${nonce}" type="module">
    // Import all components
    import '${webSrcUri}/components/cs-app.js';
    import '${webSrcUri}/components/cs-graph.js';
    import '${webSrcUri}/components/cs-sidebar.js';
    import '${webSrcUri}/components/cs-chat.js';
    import '${webSrcUri}/components/cs-global-search.js';
    import '${webSrcUri}/components/cs-code-popup.js';
    import '${webSrcUri}/panels/cs-explorer.js';
    import '${webSrcUri}/panels/cs-search-panel.js';
    import '${webSrcUri}/panels/cs-tour-panel.js';
  </script>
</body>
</html>`;
  }
};

// src/navigation.ts
var vscode2 = __toESM(require("vscode"));
var path2 = __toESM(require("path"));
var setupNavigation = {
  /**
   * Graph → Editor: Open a file at a specific line in VS Code.
   */
  openFile(filePath, line, workspaceRoot) {
    const absPath = path2.isAbsolute(filePath) ? filePath : path2.join(workspaceRoot, filePath);
    const uri = vscode2.Uri.file(absPath);
    const position = new vscode2.Position(Math.max(0, line - 1), 0);
    const range = new vscode2.Range(position, position);
    vscode2.window.showTextDocument(uri, {
      selection: range,
      viewColumn: vscode2.ViewColumn.One
    });
  },
  /**
   * Editor → Graph: Reveal a symbol from the editor in the graph.
   */
  revealInGraph(filePath, line, analyzer2, webviewManager2, workspaceRoot) {
    const symbol = analyzer2.findSymbolAtLine(filePath, line);
    if (!symbol) {
      vscode2.window.showInformationMessage("Codesight: No symbol found at cursor position.");
      return;
    }
    const relPath = path2.relative(workspaceRoot, filePath);
    const nodeId = `${relPath}:${symbol.name}`;
    webviewManager2.postMessage({ type: "highlightNode", nodeId });
  }
};

// src/chat-participant.ts
var vscode3 = __toESM(require("vscode"));
function registerChatParticipant(context, analyzer2) {
  const participant = vscode3.chat.createChatParticipant("codesight", async (request, chatContext, stream, token) => {
    const result = analyzer2.getResult();
    if (!result) {
      stream.markdown("Codesight analysis has not been run yet. Open the graph first with **Codesight: Open Graph** command.");
      return;
    }
    const prompt = request.prompt.toLowerCase();
    let contextText = buildBaselineContext(result);
    if (isModuleQuestion(prompt)) {
      contextText += buildModuleContext(prompt, result);
    } else if (isImpactQuestion(prompt)) {
      contextText += buildImpactContext(prompt, result);
    } else if (isCallChainQuestion(prompt)) {
      contextText += buildCallChainContext(prompt, result);
    } else {
      contextText += buildOverviewContext(result);
    }
    const messages = [
      vscode3.LanguageModelChatMessage.User(
        `You are a code structure expert. Use the following structural analysis data to answer the user's question about their codebase.

${contextText}

User question: ${request.prompt}`
      )
    ];
    try {
      const models = await vscode3.lm.selectChatModels({ family: "gpt-4o" });
      const model = models[0] ?? (await vscode3.lm.selectChatModels())[0];
      if (!model) {
        stream.markdown("No language model available. Please ensure you have GitHub Copilot or another LLM extension installed.");
        return;
      }
      const chatResponse = await model.sendRequest(messages, {}, token);
      for await (const fragment of chatResponse.text) {
        stream.markdown(fragment);
      }
    } catch (err) {
      if (err.code === "NoPermissions") {
        stream.markdown("Codesight needs permission to access the language model. Please allow access when prompted.");
      } else {
        stream.markdown(`Error: ${err.message || "Failed to get response from language model."}`);
      }
    }
  });
  context.subscriptions.push(participant);
}
function buildBaselineContext(result) {
  const modules = result.modules || [];
  const languages2 = result.languages || [];
  const totalFiles = modules.reduce((sum, m) => sum + (m.files?.length || 0), 0);
  const totalSymbols = modules.reduce((sum, m) => sum + (m.files || []).reduce((s, f) => s + (f.symbols?.length || 0), 0), 0);
  return `## Project: ${result.projectName || "Unknown"}
- Languages: ${languages2.join(", ")}
- Modules: ${modules.length}
- Files: ${totalFiles}
- Symbols: ${totalSymbols}
- Entry points: ${(result.keyFiles || []).map((f) => f.path).join(", ") || "none detected"}

`;
}
function buildModuleContext(prompt, result) {
  const modules = result.modules || [];
  let context = "## Module Details\n\n";
  const matchedModule = modules.find(
    (m) => prompt.includes(m.name.toLowerCase())
  );
  if (matchedModule) {
    context += `### Module: ${matchedModule.name}
`;
    context += `- Path: ${matchedModule.path}
`;
    context += `- Description: ${matchedModule.description || "N/A"}
`;
    context += `- Files: ${matchedModule.files?.length || 0}
`;
    context += `- Lines: ${matchedModule.lineCount || 0}

`;
    context += `**Files:**
`;
    for (const file of (matchedModule.files || []).slice(0, 20)) {
      context += `- ${file.path} (${file.symbols?.length || 0} symbols)
`;
      for (const sym of (file.symbols || []).slice(0, 10)) {
        context += `  - ${sym.kind}: ${sym.name}${sym.exported ? " (exported)" : ""}
`;
      }
    }
  } else {
    context += "Available modules:\n";
    for (const mod of modules) {
      context += `- **${mod.name}** (${mod.files?.length || 0} files, ${mod.lineCount || 0} lines): ${mod.description || ""}
`;
    }
  }
  return context + "\n";
}
function buildImpactContext(prompt, result) {
  const impactMap = result.impactMap || {};
  let context = "## Impact Analysis\n\n";
  const keys = Object.keys(impactMap);
  const matched = keys.find((k) => prompt.includes(k.toLowerCase().split("/").pop().replace(/\.\w+$/, "")));
  if (matched) {
    const impact = impactMap[matched];
    context += `### Impact of ${matched}
`;
    context += `- Direct dependents: ${impact.directDependents?.length || 0}
`;
    for (const dep of (impact.directDependents || []).slice(0, 15)) {
      context += `  - ${dep}
`;
    }
    context += `- Transitive dependents: ${impact.transitiveDependents?.length || 0}
`;
    for (const dep of (impact.transitiveDependents || []).slice(0, 15)) {
      context += `  - ${dep}
`;
    }
    context += `- Risk level: ${impact.riskLevel || "N/A"}
`;
  } else {
    const sorted = keys.map((k) => ({ path: k, count: impactMap[k].transitiveDependents?.length || 0 })).sort((a, b) => b.count - a.count).slice(0, 10);
    context += "Highest-impact files:\n";
    for (const item of sorted) {
      context += `- ${item.path} (${item.count} transitive dependents)
`;
    }
  }
  return context + "\n";
}
function buildCallChainContext(prompt, result) {
  const callGraph = result.callGraph || { edges: [] };
  let context = `## Call Graph

Total edges: ${callGraph.edges?.length || 0}

`;
  const edges = callGraph.edges || [];
  const relevantEdges = edges.filter(
    (e) => prompt.includes(e.source?.toLowerCase()) || prompt.includes(e.target?.toLowerCase())
  );
  if (relevantEdges.length > 0) {
    context += "Relevant call relationships:\n";
    for (const edge of relevantEdges.slice(0, 30)) {
      context += `- ${edge.source} \u2192 ${edge.target} (${edge.confidence || "unknown"} confidence)
`;
    }
  } else {
    context += "Sample call relationships:\n";
    for (const edge of edges.slice(0, 20)) {
      context += `- ${edge.source} \u2192 ${edge.target}
`;
    }
  }
  return context + "\n";
}
function buildOverviewContext(result) {
  const modules = result.modules || [];
  let context = "## Project Overview\n\n";
  context += "Modules:\n";
  for (const mod of modules.slice(0, 15)) {
    context += `- **${mod.name}** (${mod.files?.length || 0} files): ${mod.description || ""}
`;
  }
  const edges = result.edges || [];
  if (edges.length > 0) {
    context += "\nModule dependencies:\n";
    for (const edge of edges.slice(0, 20)) {
      context += `- ${edge.source} \u2192 ${edge.target} (weight: ${edge.weight})
`;
    }
  }
  return context + "\n";
}
function isModuleQuestion(prompt) {
  return /\b(module|package|folder|directory|component)\b/.test(prompt);
}
function isImpactQuestion(prompt) {
  return /\b(impact|break|change|affect|depend|risk)\b/.test(prompt);
}
function isCallChainQuestion(prompt) {
  return /\b(call|chain|invoke|flow|trace|path)\b/.test(prompt);
}

// src/watcher.ts
var vscode4 = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var SUPPORTED_EXTENSIONS = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".hh",
  ".hxx",
  ".java"
]);
function setupFileWatcher(context, analyzer2, webviewManager2) {
  let debounceTimer = null;
  const disposables = [];
  const workspaceRoot = vscode4.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const mergeIdeaStructure2 = (result) => {
    if (!workspaceRoot || !result) return;
    const ideaFile = path3.join(workspaceRoot, ".codesight", "idea-structure.json");
    try {
      if (fs.existsSync(ideaFile)) {
        const ideaStructure = JSON.parse(fs.readFileSync(ideaFile, "utf-8"));
        if (ideaStructure.nodes) {
          result.ideaStructure = ideaStructure;
        }
      }
    } catch (_) {
    }
  };
  const saveDisposable = vscode4.workspace.onDidSaveTextDocument((document) => {
    const ext = "." + document.fileName.split(".").pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const result = await analyzer2.runIncrementalUpdate(document.fileName);
      if (result) {
        mergeIdeaStructure2(result);
        webviewManager2.postMessage({ type: "updateData", data: result });
      }
    }, 500);
  });
  disposables.push(saveDisposable);
  if (workspaceRoot) {
    const ideaFile = path3.join(workspaceRoot, ".codesight", "idea-structure.json");
    const pattern = new vscode4.RelativePattern(workspaceRoot, ".codesight/idea-structure.json");
    const ideaWatcher = vscode4.workspace.createFileSystemWatcher(pattern);
    const loadIdeaStructure = () => {
      try {
        if (!fs.existsSync(ideaFile)) return;
        const content = fs.readFileSync(ideaFile, "utf-8");
        const ideaStructure = JSON.parse(content);
        if (!ideaStructure.nodes) return;
        const result = analyzer2.getResult();
        if (result) {
          result.ideaStructure = ideaStructure;
          webviewManager2.postMessage({ type: "updateData", data: result });
          console.log(`[codesight] Loaded idea layer: ${ideaStructure.nodes.length} concepts`);
        }
      } catch (err) {
        console.error("[codesight] Failed to load idea structure:", err.message);
      }
    };
    disposables.push(
      ideaWatcher.onDidCreate(loadIdeaStructure),
      ideaWatcher.onDidChange(loadIdeaStructure),
      ideaWatcher
    );
    loadIdeaStructure();
  }
  const disposable = vscode4.Disposable.from(...disposables);
  context.subscriptions.push(disposable);
  return disposable;
}

// src/idea-layer.ts
var vscode5 = __toESM(require("vscode"));
var output;
function getOutput() {
  if (!output) output = vscode5.window.createOutputChannel("Codesight");
  return output;
}
async function generateIdeaLayer(analyzer2, webviewManager2) {
  const log = getOutput();
  log.show(true);
  log.appendLine("[idea-layer] Starting idea layer generation...");
  const result = analyzer2.getResult();
  if (!result) {
    vscode5.window.showWarningMessage("Codesight: Run analysis first (Open Graph).");
    return;
  }
  let model;
  try {
    if (!vscode5.lm) {
      vscode5.window.showErrorMessage(
        "Codesight: Language Model API not available. Requires VS Code 1.90+ with a language model extension (Copilot, Claude, etc.)."
      );
      return;
    }
    log.appendLine("[idea-layer] Querying available models...");
    const timeout = new Promise((resolve7) => setTimeout(() => resolve7(null), 5e3));
    const allModels = await Promise.race([vscode5.lm.selectChatModels(), timeout]);
    if (!allModels || allModels.length === 0) {
      log.appendLine("[idea-layer] No models found (timed out or none registered)");
      log.show();
      vscode5.window.showErrorMessage(
        "Codesight: No language model found. Install and sign into GitHub Copilot (github.copilot) \u2014 it provides the vscode.lm API. Copilot Chat alone is not sufficient."
      );
      return;
    }
    log.appendLine(`[idea-layer] Found ${allModels.length} models: ${allModels.map((m) => `${m.name} (${m.vendor || "?"})`).join(", ")}`);
    model = pickBestModel(allModels);
    log.appendLine(`[idea-layer] Using model: ${model.name} (${model.vendor || "?"}, family: ${model.family || "?"})`);
  } catch (err) {
    log.appendLine(`[idea-layer] LM API error: ${err.message}
${err.stack || ""}`);
    vscode5.window.showErrorMessage(`Codesight: LM API error: ${err.message}`);
    return;
  }
  const prompt = buildIdeaStructurePrompt2(result);
  await vscode5.window.withProgress(
    { location: vscode5.ProgressLocation.Notification, title: "Codesight: Generating idea layer...", cancellable: true },
    async (progress, token) => {
      try {
        const messages = [
          vscode5.LanguageModelChatMessage.User(
            prompt.system + "\n\n" + prompt.user
          )
        ];
        log.appendLine("[idea-layer] Sending request to model...");
        const response = await model.sendRequest(messages, {}, token);
        let fullText = "";
        for await (const fragment of response.text) {
          fullText += fragment;
        }
        log.appendLine(`[idea-layer] Response received (${fullText.length} chars)`);
        const parsed = parseJSON4(fullText);
        if (!parsed || !parsed.nodes) {
          log.appendLine("[idea-layer] Failed to parse response:\n" + fullText.slice(0, 1e3));
          log.show();
          vscode5.window.showErrorMessage("Codesight: LLM returned an invalid idea structure. Check Output panel (Codesight) for details.");
          return;
        }
        const validated = validateIdeaStructure2(parsed, result);
        result.ideaStructure = validated;
        webviewManager2.postMessage({ type: "updateData", data: { ...result } });
        vscode5.window.showInformationMessage("Codesight: Idea layer generated successfully.");
      } catch (err) {
        log.appendLine(`[idea-layer] Error: ${err?.code} ${err?.message}
${err?.stack || ""}`);
        log.show();
        if (err.code === "NoPermissions") {
          const action = await vscode5.window.showWarningMessage(
            "Codesight: Language model access was denied. Please allow access when prompted.",
            "Try Again"
          );
          if (action === "Try Again") {
            vscode5.commands.executeCommand("codesight.generateIdeaLayer");
          }
        } else if (token.isCancellationRequested) {
        } else {
          vscode5.window.showErrorMessage(`Codesight: Idea layer generation failed: ${err.message}. Check Output panel (Codesight).`);
        }
      }
    }
  );
}
function pickBestModel(models) {
  const tierPatterns = [
    // Top tier — large frontier models
    { pattern: /claude.*opus|opus/i, score: 100 },
    { pattern: /gpt-?5(?!.*mini)/i, score: 95 },
    { pattern: /claude.*sonnet|sonnet/i, score: 90 },
    { pattern: /gpt-?4\.?1(?!.*mini|.*nano)/i, score: 85 },
    { pattern: /gpt-?4o(?!.*mini)/i, score: 80 },
    { pattern: /claude.*haiku|haiku/i, score: 60 },
    // Mid tier — smaller / mini models
    { pattern: /gpt-?5.*mini/i, score: 55 },
    { pattern: /gpt-?4o.*mini/i, score: 50 },
    { pattern: /gpt-?4\.?1.*mini/i, score: 48 },
    { pattern: /gpt-?4\.?1.*nano/i, score: 40 },
    // Low tier — preview / unknown
    { pattern: /raptor/i, score: 30 },
    { pattern: /preview/i, score: -5 }
    // penalty
  ];
  function scoreModel(m) {
    const text = `${m.name} ${m.id} ${m.family || ""} ${m.vendor || ""}`;
    let score = 0;
    for (const { pattern, score: s } of tierPatterns) {
      if (pattern.test(text)) score += s;
    }
    if (m.maxInputTokens) {
      score += Math.min(10, Math.floor(m.maxInputTokens / 2e4));
    }
    return score;
  }
  const scored = models.map((m) => ({ model: m, score: scoreModel(m) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].model;
}
function buildIdeaStructurePrompt2(result) {
  const { projectName, modules, edges, keyFiles, languages: languages2 } = result;
  const modulesSummary = (modules || []).map((m) => {
    const desc = m.explanation || m.description || "";
    const files = (m.files || []).slice(0, 8).map(
      (f) => `    ${f.path}${f.explanation ? ": " + f.explanation : ""}`
    ).join("\n");
    return `  ${m.name} (${m.files?.length || 0} files, ${m.lineCount || 0} lines): ${desc}
${files}`;
  }).join("\n\n");
  const edgesSummary = (edges || []).filter((e) => e.target !== "external").slice(0, 30).map((e) => `  ${e.source} \u2192 ${e.target} (${e.weight} imports)`).join("\n");
  const keyFilesSummary = (keyFiles || []).slice(0, 15).map(
    (f) => `  ${f.path} (imported by ${f.importedByCount} files${f.isEntryPoint ? ", entry point" : ""})`
  ).join("\n");
  const validModules = (modules || []).map((m) => m.name);
  const system = `You are a software architect who explains projects conceptually. Your job is to create an "idea structure" \u2014 a conceptual map of what a project does, organized by concepts and purposes rather than file paths.

Each idea node represents a concept, feature, or responsibility. Map each idea to actual code (modules, files, symbols) that implements it.

IMPORTANT:
- Only reference code that exists in the provided data
- Valid module names: ${JSON.stringify(validModules)}
- Create 5-15 idea nodes depending on project complexity
- Create edges between ideas that have relationships (e.g., "feeds into", "depends on", "protects")
- All ideas should be at the same level \u2014 no parent-child nesting, no hierarchy
- The idea structure should help someone understand WHAT the project does before HOW it's implemented`;
  const user = `Create an idea structure for this project.

Project: ${projectName || "Unknown"}
Languages: ${(languages2 || []).join(", ")}

Modules:
${modulesSummary}

Dependencies:
${edgesSummary}

Key files:
${keyFilesSummary}

Respond in JSON format:
{
  "projectSummary": "2-3 sentence high-level description of what this project does and its purpose",
  "nodes": [
    {
      "id": "idea:<kebab-case-id>",
      "label": "Human Readable Concept Name",
      "description": "1-2 sentence description of this concept/feature",
      "codeRefs": [
        { "type": "module", "name": "<module-name>" },
        { "type": "file", "path": "<file-path>" },
        { "type": "symbol", "path": "<file-path>", "name": "<symbol-name>" }
      ]
    }
  ],
  "edges": [
    { "source": "idea:<id>", "target": "idea:<id>", "label": "relationship description" }
  ]
}

Only use module names and file paths from the data above. Keep it conceptual \u2014 group by purpose, not by file structure.`;
  return { system, user };
}
function validateIdeaStructure2(idea, result) {
  const validModules = new Set((result.modules || []).map((m) => m.name));
  const validFiles = new Set((result.modules || []).flatMap((m) => (m.files || []).map((f) => f.path)));
  const validSymbols = new Set((result.modules || []).flatMap(
    (m) => (m.files || []).flatMap(
      (f) => (f.symbols || []).filter((s) => s.exported).map((s) => `${f.path}::${s.name}`)
    )
  ));
  if (result.rootFiles) {
    for (const f of result.rootFiles) {
      validFiles.add(f.path);
      for (const s of (f.symbols || []).filter((s2) => s2.exported)) {
        validSymbols.add(`${f.path}::${s.name}`);
      }
    }
  }
  const nodeIds = new Set(idea.nodes.map((n) => n.id));
  let removedRefs = 0;
  let totalRefs = 0;
  for (const node of idea.nodes) {
    delete node.parentId;
    if (node.codeRefs) {
      totalRefs += node.codeRefs.length;
      node.codeRefs = node.codeRefs.filter((ref) => {
        if (ref.type === "module" && validModules.has(ref.name)) return true;
        if (ref.type === "file" && validFiles.has(ref.path)) return true;
        if (ref.type === "symbol" && validSymbols.has(`${ref.path}::${ref.name}`)) return true;
        removedRefs++;
        return false;
      });
    }
  }
  if (idea.edges) {
    idea.edges = idea.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  }
  if (removedRefs > 0) {
    console.log(`[codesight] Removed ${removedRefs}/${totalRefs} hallucinated code references from idea structure`);
  }
  return idea;
}
function parseJSON4(text) {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
      }
    }
    return null;
  }
}

// src/extension.ts
var fs2 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var analyzer = null;
var webviewManager;
var fileWatcherDisposable = null;
function getWorkspaceRoot() {
  return vscode6.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}
function mergeIdeaStructure(result) {
  const root = getWorkspaceRoot();
  if (!root || !result) return;
  try {
    const ideaFile = path4.join(root, ".codesight", "idea-structure.json");
    if (fs2.existsSync(ideaFile)) {
      const ideaStructure = JSON.parse(fs2.readFileSync(ideaFile, "utf-8"));
      if (ideaStructure.nodes) {
        result.ideaStructure = ideaStructure;
      }
    }
  } catch (err) {
    console.warn("[codesight] Failed to merge idea structure:", err);
  }
}
function ensureAnalyzer() {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode6.window.showWarningMessage("Codesight: Please open a folder first.");
    return null;
  }
  if (!analyzer) {
    analyzer = new AnalyzerWrapper(root);
  }
  return analyzer;
}
function activate(context) {
  console.log("[codesight] Extension activating...");
  webviewManager = new WebviewManager(context.extensionUri);
  context.subscriptions.push(
    vscode6.commands.registerCommand("codesight.openGraph", async () => {
      const a = ensureAnalyzer();
      if (!a) return;
      const panel = webviewManager.createOrShow(context);
      if (!a.getResult()) {
        await vscode6.window.withProgress(
          { location: vscode6.ProgressLocation.Notification, title: "Codesight: Analyzing project..." },
          async () => {
            await a.runFullAnalysis();
          }
        );
      }
      const result = a.getResult();
      if (result) {
        mergeIdeaStructure(result);
        webviewManager.postMessage({ type: "updateData", data: result });
      } else {
        vscode6.window.showErrorMessage("Codesight: Analysis failed. Check the Output panel for details.");
      }
    }),
    vscode6.commands.registerCommand("codesight.refresh", async () => {
      const a = ensureAnalyzer();
      if (!a) return;
      await vscode6.window.withProgress(
        { location: vscode6.ProgressLocation.Notification, title: "Codesight: Refreshing analysis..." },
        async () => {
          await a.runFullAnalysis();
        }
      );
      const result = a.getResult();
      if (result) {
        mergeIdeaStructure(result);
        webviewManager.postMessage({ type: "updateData", data: result });
      }
    }),
    vscode6.commands.registerCommand("codesight.generateIdeaLayer", async () => {
      vscode6.window.showInformationMessage("Codesight: Starting idea layer generation...");
      const a = ensureAnalyzer();
      if (!a) {
        vscode6.window.showErrorMessage("Codesight: No analyzer available.");
        return;
      }
      if (!a.getResult()) {
        vscode6.window.showWarningMessage('Codesight: Run "Open Graph" first to analyze the project.');
        return;
      }
      await generateIdeaLayer(a, webviewManager);
    }),
    vscode6.commands.registerCommand("codesight.revealInGraph", () => {
      const root2 = getWorkspaceRoot();
      if (!root2 || !analyzer) return;
      const editor = vscode6.window.activeTextEditor;
      if (!editor) return;
      const filePath = editor.document.uri.fsPath;
      const line = editor.selection.active.line + 1;
      setupNavigation.revealInGraph(filePath, line, analyzer, webviewManager, root2);
    })
  );
  webviewManager.onMessage((msg) => {
    const root2 = getWorkspaceRoot();
    if (msg.type === "openFile" && root2) {
      setupNavigation.openFile(msg.path, msg.line, root2);
    } else if (msg.type === "ready" && analyzer) {
      const result = analyzer.getResult();
      if (result) {
        mergeIdeaStructure(result);
        webviewManager.postMessage({ type: "updateData", data: result });
      }
    } else if (msg.type === "chatRequest") {
      handleChatRequest(msg, analyzer, webviewManager);
    } else if (msg.type === "requestRefresh") {
      vscode6.commands.executeCommand("codesight.refresh");
    }
  });
  const root = getWorkspaceRoot();
  if (root) {
    analyzer = new AnalyzerWrapper(root);
    fileWatcherDisposable = setupFileWatcher(context, analyzer, webviewManager);
    try {
      if (vscode6.chat?.createChatParticipant) {
        registerChatParticipant(context, analyzer);
      }
    } catch (err) {
      console.warn("[codesight] Failed to register chat participant:", err);
    }
  }
  context.subscriptions.push(
    vscode6.workspace.onDidChangeWorkspaceFolders(() => {
      const newRoot = getWorkspaceRoot();
      if (fileWatcherDisposable) {
        fileWatcherDisposable.dispose();
        fileWatcherDisposable = null;
      }
      if (newRoot) {
        analyzer = new AnalyzerWrapper(newRoot);
        fileWatcherDisposable = setupFileWatcher(context, analyzer, webviewManager);
      } else {
        analyzer = null;
      }
    })
  );
  console.log("[codesight] Extension activated successfully");
}
function deactivate() {
  analyzer = null;
}
async function handleChatRequest(msg, analyzer2, webviewManager2) {
  const { message, context, history } = msg;
  let contextText = "";
  if (context?.ideaNode) {
    contextText += `Concept: ${context.ideaNode.label}
Description: ${context.ideaNode.description}
`;
    if (context.ideaNode.codeRefs?.length) {
      contextText += `Code refs: ${context.ideaNode.codeRefs.map((r) => r.type === "module" ? r.name : r.path).join(", ")}
`;
    }
  }
  if (context?.focusedNode) {
    const fn = context.focusedNode;
    contextText += `Focused ${fn.type}: ${fn.data?.name || fn.data?.path || ""}
`;
    if (fn.data?.description) contextText += `Description: ${fn.data.description}
`;
    if (fn.data?.signature) contextText += `Signature: ${fn.data.signature}
`;
  }
  if (context?.currentFile) contextText += `Current file: ${context.currentFile}
`;
  if (context?.currentModule) contextText += `Current module: ${context.currentModule}
`;
  const result = analyzer2?.getResult();
  if (result) {
    contextText += `
Project: ${result.projectName} (${result.modules?.length || 0} modules, ${result.languages?.join(", ")})
`;
    contextText += `Modules: ${result.modules?.map((m) => m.name).join(", ")}
`;
  }
  try {
    const models = await vscode6.lm.selectChatModels();
    if (models && models.length > 0) {
      const model = models[0];
      const messages = [
        vscode6.LanguageModelChatMessage.User(
          `You are a code assistant for the "${result?.projectName || "unknown"}" project.

Context:
${contextText}

${history?.slice(-6).map((h) => `${h.role}: ${h.content}`).join("\n") || ""}

User: ${message}`
        )
      ];
      const response = await model.sendRequest(messages);
      let text = "";
      for await (const chunk2 of response.text) {
        text += chunk2;
      }
      webviewManager2.postMessage({
        type: "chatResponse",
        text,
        model: model.name || model.id,
        originalMessage: message
      });
      return;
    }
  } catch (_) {
  }
  webviewManager2.postMessage({
    type: "chatResponse",
    error: "No language model available. Install GitHub Copilot (or another vscode.lm extension) to use chat, or use Claude Code with MCP for AI features."
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
