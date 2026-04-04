import { resolve, dirname, relative } from "path";
import { getModuleName as sharedGetModuleName, getModuleFromRelPath } from "../analyzer/modules.mjs";

function loadGrammar(require) {
  return require("tree-sitter-python");
}

function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");

  for (const node of rootNode.children) {
    let defNode = node;
    let decoratedNode = null;
    if (node.type === "decorated_definition") {
      defNode = node.children.find(
        c => c.type === "function_definition" || c.type === "class_definition"
      );
      decoratedNode = node;
      if (!defNode) continue;
    }

    const sym = extractDef(defNode, lines, decoratedNode);
    if (sym) {
      symbols.push(sym);
      // Extract class methods as separate symbols for call graph resolution
      if (sym.kind === "class") {
        const methods = extractClassMethods(defNode, lines, sym.name);
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

  for (const child of body.children) {
    let methodNode = child;
    let decoratedNode = null;
    if (child.type === "decorated_definition") {
      methodNode = child.children.find(c => c.type === "function_definition");
      decoratedNode = child;
      if (!methodNode) continue;
    }
    if (methodNode.type !== "function_definition") continue;

    const name = methodNode.childForFieldName("name")?.text;
    if (!name || name === "__init__" || name.startsWith("_")) continue;

    const parameters = extractParameters(methodNode.childForFieldName("parameters"));
    const returnType = methodNode.childForFieldName("return_type")?.text?.replace(/^\s*->\s*/, "") || null;
    const comment = extractDocstring(methodNode) || extractComment(decoratedNode || methodNode, lines);
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
      usedBy: [],
    });
  }
  return methods;
}

function extractDef(node, lines, decoratedNode) {
  const type = node.type;
  const commentNode = decoratedNode || node;

  // Helper to extract source preview
  function getSource(n) {
    const dn = decoratedNode || n;
    const startLine = dn.startPosition.row;
    const endLine = n.endPosition.row;
    return lines.slice(startLine, endLine + 1).join("\n");
  }

  if (type === "function_definition") {
    const name = node.childForFieldName("name")?.text;
    if (!name) return null;
    const parameters = extractParameters(node.childForFieldName("parameters"));
    const returnType = node.childForFieldName("return_type")?.text?.replace(/^\s*->\s*/, "") || null;
    const signature = buildFnSignature(node, lines, decoratedNode);
    const comment = extractDocstring(node) || extractComment(commentNode, lines);
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
      usedBy: [],
    };
  }

  if (type === "class_definition") {
    const name = node.childForFieldName("name")?.text;
    if (!name) return null;
    const signature = lines[node.startPosition.row]?.trim()?.replace(/:\s*$/, "") || "";
    const comment = extractDocstring(node) || extractComment(commentNode, lines);
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
      usedBy: [],
    };
  }

  // Top-level assignments (constants): UPPER_CASE = ...
  if (type === "expression_statement") {
    const assignment = node.children.find(c => c.type === "assignment");
    if (!assignment) return null;
    const left = assignment.childForFieldName("left");
    if (!left || left.type !== "identifier") return null;
    const name = left.text;
    // Only capture UPPER_CASE constants
    if (name !== name.toUpperCase() || name.length < 2) return null;
    const typeNode = assignment.childForFieldName("type");
    return {
      name,
      kind: "const",
      exported: !name.startsWith("_"),
      signature: lines[node.startPosition.row]?.trim() || "",
      parameters: [],
      returnType: typeNode?.text?.replace(/^:\s*/, "") || null,
      comment: extractComment(node, lines),
      source: lines[node.startPosition.row] || "",
      line: node.startPosition.row + 1,
      usedBy: [],
    };
  }

  return null;
}

function extractParameters(paramsNode) {
  if (!paramsNode) return [];
  const params = [];
  for (const child of paramsNode.children) {
    if (child.type === "identifier") {
      if (child.text === "self" || child.text === "cls") continue;
      params.push({ name: child.text, type: null });
    } else if (child.type === "typed_parameter") {
      const nameNode = child.children.find(c => c.type === "identifier");
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
        type: typeNode?.text || null,
      });
    } else if (child.type === "list_splat_pattern" || child.type === "dictionary_splat_pattern") {
      const nameNode = child.children.find(c => c.type === "identifier");
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
      return str.text
        .replace(/^['"]{1,3}/, "")
        .replace(/['"]{1,3}$/, "")
        .trim();
    }
  }
  return "";
}

function extractComment(node, lines) {
  const prev = node.previousNamedSibling;
  if (prev && prev.type === "comment") {
    return prev.text.replace(/^#\s*/, "").trim();
  }
  return "";
}

function extractImports(rootNode, _source) {
  const imports = [];
  for (const node of rootNode.children) {
    if (node.type === "import_statement") {
      // import foo / import foo.bar
      const nameNode = node.childForFieldName("name");
      if (nameNode) {
        const source = nameNode.text;
        imports.push({ source, symbols: [source.split(".").pop()], typeOnly: false });
      }
    } else if (node.type === "import_from_statement") {
      // from foo import bar, baz
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

const PYTHON_BUILTINS = new Set([
  'print', 'len', 'range', 'enumerate', 'zip', 'map', 'filter', 'sorted',
  'reversed', 'any', 'all', 'min', 'max', 'sum', 'abs', 'round', 'hash',
  'id', 'repr', 'dir', 'vars', 'getattr', 'setattr', 'hasattr', 'delattr',
  'callable', 'super', 'property', 'staticmethod', 'classmethod',
  'open', 'input', 'iter', 'next', 'format', 'chr', 'ord', 'hex', 'oct',
  'bin', 'pow', 'divmod', 'isinstance', 'issubclass', 'type',
  'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes',
  'bytearray', 'frozenset', 'object', 'complex', 'memoryview',
  'Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError',
  'AttributeError', 'RuntimeError', 'StopIteration', 'NotImplementedError',
  'OSError', 'IOError', 'FileNotFoundError', 'ImportError', 'NameError',
]);

/**
 * Extract function calls from symbol bodies via tree-sitter.
 */
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
    if (sym.kind !== 'function' && sym.kind !== 'method') continue;

    const bodyNode = findPythonBody(rootNode, sym);
    if (!bodyNode) continue;

    const calls = [];
    const seen = new Set();
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
    if (node.type === 'function_definition' && node.startPosition.row === targetLine) {
      return node.childForFieldName('body');
    }
    // Check decorated definitions
    if (node.type === 'decorated_definition' && node.startPosition.row === targetLine) {
      const inner = node.children.find(c => c.type === 'function_definition');
      if (inner) return inner.childForFieldName('body');
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
  if (node.type === 'call') {
    const funcNode = node.childForFieldName('function');
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
            isExternal: callInfo.isExternal,
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
  if (node.type === 'identifier') {
    const name = node.text;
    if (PYTHON_BUILTINS.has(name)) return null;
    const imp = importLookup.get(name);
    if (imp) {
      return {
        name,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === 'external',
      };
    }
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    return null;
  }

  if (node.type === 'attribute') {
    const obj = node.childForFieldName('object');
    const attr = node.childForFieldName('attribute');
    if (!attr) return null;

    if (obj?.type === 'identifier') {
      // self.method()
      if (obj.text === 'self' || obj.text === 'cls') {
        return { name: attr.text, resolvedFile: null, resolvedModule: null, isExternal: false };
      }
      // imported_module.func()
      const imp = importLookup.get(obj.text);
      if (imp) {
        return {
          name: `${obj.text}.${attr.text}`,
          resolvedFile: imp.resolvedPath,
          resolvedModule: imp.resolvedModule,
          isExternal: imp.resolvedModule === 'external',
        };
      }
    }
    return null;
  }

  return null;
}

function resolveImport(importPath, fromFile, projectRoot, fileIndex) {
  // Python imports: dots = relative
  if (importPath.startsWith(".")) {
    const dots = importPath.match(/^\.+/)[0].length;
    let base = dirname(fromFile);
    for (let i = 1; i < dots; i++) base = dirname(base);
    const modulePart = importPath.slice(dots).replace(/\./g, "/");
    const resolved = resolve(base, modulePart);
    const rel = relative(projectRoot, resolved);
    if (rel.startsWith("..")) return { resolvedPath: null, resolvedModule: "external" };

    if (fileIndex) {
      const exact = fileIndex.resolve(rel);
      if (exact) return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
    }
    return { resolvedPath: rel, resolvedModule: getModuleFromRelPath(rel) };
  }

  // Absolute imports — check if it maps to a local file/package
  // Try direct path first, then under common source root directories (src/, lib/, app/, source/)
  const parts = importPath.split(".");
  const joined = parts.join("/");
  const SOURCE_ROOTS = ["", "src/", "lib/", "app/", "source/"];

  for (const prefix of SOURCE_ROOTS) {
    const localPath = resolve(projectRoot, prefix + joined);
    const rel = relative(projectRoot, localPath);
    if (rel.startsWith("..")) continue;
    if (fileIndex) {
      const exact = fileIndex.resolve(rel);
      if (exact) return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
    }
  }

  // No match in file index — treat as external
  return { resolvedPath: null, resolvedModule: "external" };
}

function getModulePath(filePath, projectRoot) {
  return sharedGetModuleName(filePath, projectRoot);
}

export default {
  id: "python",
  loadGrammar,
  extractSymbols,
  extractImports,
  extractCalls,
  resolveImport,
  getModulePath,
};
