import { resolve, dirname, relative } from "path";

function loadGrammar(require) {
  return require("tree-sitter-typescript").typescript;
}

function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");

  for (const node of rootNode.children) {
    if (node.type === "export_statement") {
      const decl = node.childForFieldName("declaration");
      if (decl) {
        const sym = extractDeclaration(decl, lines, true);
        if (sym) symbols.push(sym);
      }
      // export { ... } re-exports — skip, handled as imports
    } else {
      const sym = extractDeclaration(node, lines, false);
      if (sym) symbols.push(sym);
    }
  }

  return symbols;
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
  const endLine = Math.min(node.endPosition.row, startLine + 20);
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

function resolveImport(importPath, fromFile, projectRoot) {
  if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
    return { resolvedPath: null, resolvedModule: "external" };
  }
  const resolved = resolve(dirname(fromFile), importPath)
    .replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "");
  const rel = relative(projectRoot, resolved);
  if (rel.startsWith("..")) {
    return { resolvedPath: null, resolvedModule: "external" };
  }
  return { resolvedPath: rel, resolvedModule: getModuleName(rel) };
}

function getModuleName(relPath) {
  // Find the first meaningful directory
  const parts = relPath.split("/");
  // Skip src/lib/app prefixes
  const skipDirs = new Set(["src", "lib", "app", "source", "packages"]);
  let start = 0;
  while (start < parts.length - 1 && skipDirs.has(parts[start])) {
    start++;
  }
  if (start >= parts.length - 1) return "root";
  return parts[start];
}

function getModulePath(filePath, projectRoot) {
  const rel = relative(projectRoot, filePath);
  return getModuleName(rel);
}

export default {
  id: "typescript",
  loadGrammar,
  extractSymbols,
  extractImports,
  resolveImport,
  getModulePath,
};
