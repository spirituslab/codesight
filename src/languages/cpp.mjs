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
// Import C module to reuse shared logic
import cLang from "./c.mjs";

function loadGrammar(require) {
  return require("tree-sitter-cpp");
}

function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");

  for (const node of rootNode.children) {
    const type = node.type;

    if (type === "function_definition") {
      const sym = extractFunctionDef(node, lines);
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
      const inner = node.children.find(c =>
        c.type === "function_definition" || c.type === "class_specifier" ||
        c.type === "struct_specifier"
      );
      if (inner) {
        if (inner.type === "function_definition") {
          const sym = extractFunctionDef(inner, lines);
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
  } else if (declaratorNode.type === "reference_declarator") {
    const inner = declaratorNode.childForFieldName("declarator") || declaratorNode.children?.[1];
    if (inner && inner.type === "function_declarator") {
      nameNode = inner.childForFieldName("declarator");
      paramsNode = inner.childForFieldName("parameters");
    }
  }

  // Handle qualified names like ClassName::methodName
  let name = nameNode?.text;
  if (!name) return null;

  const typeNode = node.childForFieldName("type");
  const returnType = typeNode?.text || null;
  const parameters = helpersExtractParameters(paramsNode, { typeFirst: true });
  const exported = isExported(node, "cpp");
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

function extractClassDef(node, lines) {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return null;

  const name = nameNode.text;
  const exported = isExported(node, "cpp");
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
      // Could be a method declaration or field
      const declarator = findFuncDeclarator(member);
      if (declarator) {
        const sym = extractMethodDeclFromClass(member, declarator, lines, className, accessLevel);
        if (sym) symbols.push(sym);
      }
    } else if (member.type === "template_declaration") {
      const inner = member.children.find(c => c.type === "function_definition" || c.type === "declaration");
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
  if (!name || name === className) return null; // skip constructors here, handle separately if needed

  const typeNode = node.childForFieldName("type");
  const returnType = typeNode?.text || null;
  const parameters = helpersExtractParameters(paramsNode, { typeFirst: true });
  const comment = extractPrecedingComment(node);
  const { source, line } = getNodeSource(node, lines);
  const signature = buildSignature(node, lines);

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
    usedBy: [],
  };
}

function extractMethodDeclFromClass(declNode, funcDeclarator, lines, className, accessLevel) {
  const nameNode = funcDeclarator.childForFieldName("declarator");
  const paramsNode = funcDeclarator.childForFieldName("parameters");

  const name = nameNode?.text;
  if (!name) return null;

  const typeNode = declNode.childForFieldName("type");
  const returnType = typeNode?.text || null;
  const parameters = helpersExtractParameters(paramsNode, { typeFirst: true });
  const comment = extractPrecedingComment(declNode);
  const { source, line } = getNodeSource(declNode, lines);
  const signature = buildSignature(declNode, lines);

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
    usedBy: [],
  };
}

function extractNamespaceSymbols(nsNode, lines, symbols) {
  const nameNode = nsNode.childForFieldName("name");
  const nsName = nameNode?.text || "";
  const body = nsNode.childForFieldName("body");
  if (!body) return;

  for (const child of body.children) {
    if (child.type === "function_definition") {
      const sym = extractFunctionDef(child, lines);
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
      // Nested namespace
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
  let name = null;
  for (let i = node.childCount - 1; i >= 0; i--) {
    const child = node.child(i);
    if (child.type === "type_identifier" || child.type === "identifier") {
      name = child.text;
      break;
    }
    if (child.type === "pointer_declarator") {
      const inner = child.childForFieldName("declarator");
      if (inner) { name = inner.text; break; }
    }
  }
  if (!name) return null;

  const exported = isExported(node, "cpp");
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
    usedBy: [],
  };
}

function extractImports(rootNode, _source) {
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
      // using std::cout;
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

const CPP_BUILTINS = new Set([
  "printf", "fprintf", "sprintf", "snprintf",
  "scanf",
  "malloc", "calloc", "realloc", "free",
  "memcpy", "memset", "memmove",
  "strlen", "strcmp", "strncmp", "strcpy", "strcat",
  "exit", "abort", "assert",
  // C++ specific
  "cout", "cerr", "endl", "cin",
  "make_shared", "make_unique", "make_pair", "make_tuple",
  "move", "forward", "swap",
  "static_cast", "dynamic_cast", "reinterpret_cast", "const_cast",
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

    const calls = walkBodyForCalls(bodyNode, importLookup, localSymbols, sym.name, CPP_BUILTINS, resolveCppCallee);
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
        isExternal: imp.resolvedModule === "external",
      };
    }
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
    return null;
  }

  if (node.type === "qualified_identifier" || node.type === "scoped_identifier") {
    // Namespace::function() or Class::staticMethod()
    const name = node.text;
    if (builtins.has(name)) return null;

    // Check if the full qualified name is a local symbol
    if (localSymbols.has(name)) {
      return { name, resolvedFile: null, resolvedModule: null, isExternal: false };
    }

    // Try just the last part
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

    // this->method() or obj.method()
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
          isExternal: imp.resolvedModule === "external",
        };
      }
    }

    return null;
  }

  if (node.type === "template_function") {
    // template_function has a name child which is the actual function name
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      return resolveCppCallee(nameNode, importLookup, localSymbols, builtins);
    }
    return null;
  }

  return null;
}

// Reuse C's resolveImport — same include path resolution logic
function resolveImport(importPath, fromFile, projectRoot, fileIndex) {
  return cLang.resolveImport(importPath, fromFile, projectRoot, fileIndex);
}

function getModulePath(filePath, projectRoot) {
  return sharedGetModuleName(filePath, projectRoot);
}

export default {
  id: "cpp",
  loadGrammar,
  extractSymbols,
  extractImports,
  extractCalls,
  resolveImport,
  getModulePath,
};
