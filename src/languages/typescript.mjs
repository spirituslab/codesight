import { resolve, dirname, relative } from "path";
import { getModuleName as sharedGetModuleName, getModuleFromRelPath } from "../analyzer/modules.mjs";

function loadGrammar(require) {
  return require("tree-sitter-typescript").typescript;
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
      // Extract class methods as separate symbols for call graph resolution
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
      usedBy: [],
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
    // const/let declarations — may contain arrow functions
    const declarator = node.children.find(c => c.type === "variable_declarator");
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

  // Extract full source
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
    usedBy: [],
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
        type: typeNode?.text?.replace(/^:\s*/, "") || null,
      });
    } else if (child.type === "identifier") {
      params.push({ name: child.text, type: null });
    } else if (child.type === "rest_parameter") {
      const nameNode = child.children.find(c => c.type === "identifier");
      const typeNode = child.childForFieldName("type");
      params.push({
        name: "..." + (nameNode?.text || ""),
        type: typeNode?.text?.replace(/^:\s*/, "") || null,
      });
    }
  }
  return params;
}

function extractReturnType(node) {
  const typeAnnotation = node.children?.find(c => c.type === "type_annotation" && c.startPosition.row >= (node.childForFieldName("parameters")?.endPosition?.row || 0));
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
      if (ch === "(") { depth++; seenParen = true; }
      if (ch === ")") depth--;
    }
    if (seenParen && depth <= 0) {
      // Include possible return type after closing paren
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
    return prev.text
      .replace(/^\/\*\*?\s*/, "")
      .replace(/\*\/\s*$/, "")
      .replace(/^\s*\*\s?/gm, "")
      .trim();
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

      // Check for type-only import
      if (node.text.startsWith("import type")) typeOnly = true;

      const clause = node.children.find(c => c.type === "import_clause");
      if (clause) {
        for (const child of clause.children) {
          if (child.type === "identifier") {
            symbols.push(child.text); // default import
          } else if (child.type === "named_imports") {
            for (const spec of child.children) {
              if (spec.type === "import_specifier") {
                const alias = spec.childForFieldName("alias");
                const name = spec.childForFieldName("name");
                symbols.push(alias?.text || name?.text || spec.text);
              }
            }
          } else if (child.type === "namespace_import") {
            const nameNode = child.children.find(c => c.type === "identifier");
            symbols.push(nameNode?.text || "*");
          }
        }
      }

      imports.push({ source, symbols, typeOnly });
    } else if (node.type === "export_statement") {
      // Re-exports: export { ... } from '...'
      const sourceNode = node.childForFieldName("source");
      if (sourceNode) {
        const source = sourceNode.text.replace(/['"]/g, "");
        const symbols = [];
        const clause = node.children.find(c => c.type === "export_clause");
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

/**
 * Extract function calls from a symbol's body using tree-sitter AST traversal.
 * @param {object} rootNode - the file's root AST node
 * @param {object[]} symbols - extracted symbols with line numbers
 * @param {object[]} fileImports - resolved imports for this file
 * @returns {Map<string, Array>} symbolName → calls array
 */
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

  // Build local symbol lookup: name → true
  const localSymbols = new Set(symbols.map(s => s.name));

  // Find each symbol's AST node by matching line number, then walk its body
  for (const sym of symbols) {
    if (sym.kind !== 'function' && sym.kind !== 'method') continue;

    const bodyNode = findSymbolBody(rootNode, sym);
    if (!bodyNode) continue;

    const calls = [];
    const seen = new Set();
    walkForCalls(bodyNode, calls, seen, importLookup, localSymbols, sym.name);
    if (calls.length > 0) {
      callMap.set(sym.name, calls);
    }
  }

  return callMap;
}

function findSymbolBody(rootNode, sym) {
  // Walk the AST to find a function node at the symbol's line
  const targetLine = sym.line - 1; // sym.line is 1-indexed

  function search(node) {
    if (node.startPosition.row === targetLine) {
      // Found a node at the right line — look for body
      const body = findBody(node);
      if (body) return body;
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      // Only recurse into nodes that span our target line
      if (child.startPosition.row <= targetLine && child.endPosition.row >= targetLine) {
        const result = search(child);
        if (result) return result;
      }
    }
    return null;
  }

  function findBody(node) {
    // Direct body field
    const body = node.childForFieldName('body');
    if (body) return body;

    // For lexical_declaration → variable_declarator → value (arrow_function) → body
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'variable_declarator') {
        const value = child.childForFieldName('value');
        if (value && (value.type === 'arrow_function' || value.type === 'function')) {
          return value.childForFieldName('body') || value;
        }
      }
    }
    return null;
  }

  return search(rootNode);
}

function walkForCalls(node, calls, seen, importLookup, localSymbols, callerName) {
  if (node.type === 'call_expression' || node.type === 'new_expression') {
    const callee = node.type === 'new_expression'
      ? node.children.find(c => c.type === 'identifier' || c.type === 'member_expression')
      : node.childForFieldName('function') || node.children[0];

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
            isExternal: callInfo.isExternal,
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
  // Built-ins to skip
  const SKIP = new Set(['console', 'process', 'JSON', 'Math', 'Object', 'Array', 'Promise', 'Error', 'Date', 'Map', 'Set', 'RegExp', 'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'require']);

  if (node.type === 'identifier') {
    const name = node.text;
    if (SKIP.has(name)) return null;

    // Check if it's an imported symbol
    const imp = importLookup.get(name);
    if (imp) {
      return {
        name,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === 'external' && !imp.source?.startsWith('@/'),
      };
    }
    // Check if it's a local symbol
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    // Unknown — might be resolved by callgraph builder via symbol index
    return null;
  }

  if (node.type === 'member_expression') {
    const obj = node.childForFieldName('object');
    const prop = node.childForFieldName('property');
    if (!prop) return null;

    const methodName = prop.text;

    // Skip known built-ins
    if (obj?.type === 'identifier' && SKIP.has(obj.text)) return null;

    // this.method() or super.method()
    if (obj?.type === 'this' || obj?.type === 'super') {
      return { name: methodName, resolvedFile: null, resolvedModule: null, isExternal: false };
    }

    // imported.method() — check if object is an imported namespace
    if (obj?.type === 'identifier') {
      const imp = importLookup.get(obj.text);
      if (imp) {
        return {
          name: `${obj.text}.${methodName}`,
          resolvedFile: imp.resolvedPath,
          resolvedModule: imp.resolvedModule,
          isExternal: imp.resolvedModule === 'external' && !imp.source?.startsWith('@/'),
        };
      }
    }

    return null;
  }

  return null;
}

function resolveImport(importPath, fromFile, projectRoot, fileIndex) {
  // Try tsconfig path aliases first (e.g. @/foo, ~/bar, custom paths)
  if (!importPath.startsWith(".") && !importPath.startsWith("/") && fileIndex?.tsconfig) {
    const aliased = resolvePathAlias(importPath, projectRoot, fileIndex.tsconfig, fileIndex);
    if (aliased) return aliased;
  }

  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return { resolvedPath: null, resolvedModule: "external" };
  }
  const resolved = resolve(dirname(fromFile), importPath)
    .replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "");
  const rel = relative(projectRoot, resolved);
  if (rel.startsWith("..")) {
    return { resolvedPath: null, resolvedModule: "external" };
  }

  // Use file index for exact resolution if available
  if (fileIndex) {
    const exact = fileIndex.resolve(rel);
    if (exact) {
      return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
    }
  }

  return { resolvedPath: rel, resolvedModule: getModuleFromRelPath(rel) };
}

/**
 * Resolve a tsconfig path alias to an actual file.
 * Handles patterns like: "@/*" → ["src/*"], "~/*" → ["src/*"]
 */
function resolvePathAlias(importPath, projectRoot, tsconfig, fileIndex) {
  const { paths, baseUrl } = tsconfig;
  if (!paths) return null;

  const base = baseUrl ? resolve(projectRoot, baseUrl) : projectRoot;

  for (const [pattern, targets] of Object.entries(paths)) {
    // Convert tsconfig glob pattern to a match check
    // e.g. "@/*" matches "@/foo/bar", captures "foo/bar"
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      if (importPath.startsWith(prefix + "/")) {
        const rest = importPath.slice(prefix.length + 1);
        for (const target of targets) {
          if (target.endsWith("/*")) {
            const targetDir = target.slice(0, -2);
            const resolved = resolve(base, targetDir, rest)
              .replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "");
            const rel = relative(projectRoot, resolved);
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
      // Exact match (no wildcard)
      for (const target of targets) {
        const resolved = resolve(base, target)
          .replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "");
        const rel = relative(projectRoot, resolved);
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
  return sharedGetModuleName(filePath, projectRoot);
}

export default {
  id: "typescript",
  loadGrammar,
  extractSymbols,
  extractImports,
  extractCalls,
  resolveImport,
  getModulePath,
};
