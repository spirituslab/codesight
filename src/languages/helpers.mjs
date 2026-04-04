/**
 * Shared helpers for language extraction modules.
 * These provide common patterns used across C, C++, Java, and future languages.
 */

// Find the doc comment immediately preceding a declaration node.
// Handles //, block comments, JSDoc/Javadoc, and # Python comments.
export function extractPrecedingComment(node) {
  const prev = node.previousNamedSibling;
  if (!prev) return "";

  if (prev.type === "comment") {
    return prev.text
      .replace(/^\/\*\*?\s*/, "")
      .replace(/\*\/\s*$/, "")
      .replace(/^\s*\*\s?/gm, "")
      .replace(/^\/\/\s*/, "")
      .replace(/^#\s*/, "")
      .trim();
  }
  return "";
}

/**
 * Generator that yields all descendant nodes matching any of the given type strings.
 * @param {object} rootNode - tree-sitter node to walk
 * @param {Set<string>|string[]} types - node types to match
 * @yields {object} matching nodes
 */
export function* walkForNodeTypes(rootNode, types) {
  const typeSet = types instanceof Set ? types : new Set(types);
  const stack = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeSet.has(node.type)) {
      yield node;
    }
    // Push children in reverse so we visit left-to-right
    for (let i = node.childCount - 1; i >= 0; i--) {
      stack.push(node.child(i));
    }
  }
}

/**
 * Extract parameters from a parameter list node.
 * @param {object} paramListNode - the parameter_list / formal_parameters node
 * @param {object} opts
 * @param {boolean} opts.typeFirst - true for C/C++/Java where type precedes name
 * @param {boolean} opts.skipSelf - true for Python to skip self/cls
 * @returns {Array<{name: string, type: string|null}>}
 */
export function extractParameters(paramListNode, opts = {}) {
  if (!paramListNode) return [];
  const params = [];

  for (const child of paramListNode.children) {
    // C/C++/Java: parameter_declaration with type + declarator
    if (child.type === "parameter_declaration") {
      const typeNode = child.childForFieldName("type");
      const declarator = child.childForFieldName("declarator");
      const name = declarator?.text?.replace(/^\*+/, "") || child.text;
      params.push({
        name,
        type: typeNode?.text || null,
      });
      continue;
    }

    // Java: formal_parameter with type and name fields
    if (child.type === "formal_parameter" || child.type === "spread_parameter") {
      const typeNode = child.childForFieldName("type");
      const nameNode = child.childForFieldName("name");
      const prefix = child.type === "spread_parameter" ? "..." : "";
      params.push({
        name: prefix + (nameNode?.text || child.text),
        type: typeNode?.text || null,
      });
      continue;
    }
  }

  return params;
}

/**
 * Extract source text and line number from a tree-sitter node.
 * @param {object} node - tree-sitter node
 * @param {string[]} lines - source split by newline
 * @returns {{ source: string, line: number }}
 */
export function getNodeSource(node, lines) {
  const startLine = node.startPosition.row;
  const endLine = node.endPosition.row;
  const source = lines.slice(startLine, endLine + 1).join("\n");
  return { source, line: startLine + 1 };
}

/**
 * Check if a declaration node is exported/public based on language rules.
 * @param {object} node - the declaration node
 * @param {string} language - "c", "cpp", or "java"
 * @returns {boolean}
 */
export function isExported(node, language) {
  if (language === "c" || language === "cpp") {
    // In C/C++, non-static declarations at file scope are exported
    // Check if any child is a 'storage_class_specifier' with text 'static'
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "storage_class_specifier" && child.text === "static") {
        return false;
      }
    }
    return true;
  }

  if (language === "java") {
    // Check modifiers for 'public'
    const modifiers = node.childForFieldName("modifiers") || node.children?.find(c => c.type === "modifiers");
    if (!modifiers) return false;
    for (const child of modifiers.children) {
      if (child.text === "public") return true;
    }
    return false;
  }

  return true;
}

/**
 * Find the body/block node of a function or method declaration.
 * Works for C/C++/Java where the body is a compound_statement or block.
 * @param {object} node - function/method declaration node
 * @returns {object|null} the body node
 */
export function findFunctionBody(node) {
  // Direct body field (most common)
  const body = node.childForFieldName("body");
  if (body) return body;

  // Look for compound_statement or block child directly
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === "compound_statement" || child.type === "block") {
      return child;
    }
  }
  return null;
}

/**
 * Build a signature string from a declaration node, taking lines up to the opening brace.
 * @param {object} node - declaration node
 * @param {string[]} lines - source lines
 * @param {number} maxLines - max lines to scan (default 10)
 * @returns {string}
 */
export function buildSignature(node, lines, maxLines = 10) {
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

/**
 * Walk a function body for call_expression nodes and collect call info.
 * Shared call-walking logic for C-family languages.
 * @param {object} bodyNode - the function body AST node
 * @param {Map} importLookup - imported symbol → { source, resolvedPath, resolvedModule }
 * @param {Set} localSymbols - set of local symbol names
 * @param {string} callerName - name of the calling function (to skip self-calls)
 * @param {Set<string>} builtins - set of built-in names to skip
 * @param {function} resolveCallee - language-specific callee resolution function
 * @returns {Array} calls
 */
export function walkBodyForCalls(bodyNode, importLookup, localSymbols, callerName, builtins, resolveCallee) {
  const calls = [];
  const seen = new Set();

  function walk(node) {
    if (node.type === "call_expression" || node.type === "new_expression") {
      const callee = node.type === "new_expression"
        ? node.children.find(c => c.type === "identifier" || c.type === "qualified_identifier" || c.type === "type_identifier")
        : node.childForFieldName("function") || node.children[0];

      if (callee) {
        const callInfo = resolveCallee(callee, importLookup, localSymbols, builtins);
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
      walk(node.child(i));
    }
  }

  walk(bodyNode);
  return calls;
}
