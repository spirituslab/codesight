import { resolve, dirname, relative } from "path";

function loadGrammar(require) {
  return require("tree-sitter-python");
}

function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");

  for (const node of rootNode.children) {
    if (node.type === "decorated_definition") {
      const inner = node.children.find(
        c => c.type === "function_definition" || c.type === "class_definition"
      );
      if (inner) {
        const sym = extractDef(inner, lines, node);
        if (sym) symbols.push(sym);
      }
    } else {
      const sym = extractDef(node, lines, null);
      if (sym) symbols.push(sym);
    }
  }

  return symbols;
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

function resolveImport(importPath, fromFile, projectRoot) {
  // Python imports: dots = relative
  if (importPath.startsWith(".")) {
    const dots = importPath.match(/^\.+/)[0].length;
    let base = dirname(fromFile);
    for (let i = 1; i < dots; i++) base = dirname(base);
    const modulePart = importPath.slice(dots).replace(/\./g, "/");
    const resolved = resolve(base, modulePart);
    const rel = relative(projectRoot, resolved);
    if (rel.startsWith("..")) return { resolvedPath: null, resolvedModule: "external" };
    return { resolvedPath: rel, resolvedModule: getModuleName(rel) };
  }

  // Absolute imports — check if it maps to a local directory
  const parts = importPath.split(".");
  const localPath = resolve(projectRoot, parts.join("/"));
  const rel = relative(projectRoot, localPath);
  if (!rel.startsWith("..")) {
    return { resolvedPath: rel, resolvedModule: getModuleName(rel) };
  }

  return { resolvedPath: null, resolvedModule: "external" };
}

function getModuleName(relPath) {
  const parts = relPath.split("/");
  const skipDirs = new Set(["src", "lib", "app", "source"]);
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
  id: "python",
  loadGrammar,
  extractSymbols,
  extractImports,
  resolveImport,
  getModulePath,
};
