import { resolve, dirname, relative } from "path";
import { getModuleName as sharedGetModuleName, getModuleFromRelPath } from "../analyzer/modules.mjs";
import * as helpers from "./helpers.mjs";

function loadGrammar(require) {
  return require("tree-sitter-java");
}

function extractSymbols(rootNode, source) {
  const symbols = [];
  const lines = source.split("\n");

  for (const node of rootNode.children) {
    if (node.type === "class_declaration") {
      pushTypeSymbol(node, "class", lines, symbols);
      extractClassMembers(node, lines, symbols);
    } else if (node.type === "interface_declaration") {
      pushTypeSymbol(node, "interface", lines, symbols);
      extractClassMembers(node, lines, symbols);
    } else if (node.type === "enum_declaration") {
      pushTypeSymbol(node, "enum", lines, symbols);
      extractClassMembers(node, lines, symbols);
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
  const exported = helpers.isExported(node, "java");
  const comment = helpers.extractPrecedingComment(node);
  const { source, line } = helpers.getNodeSource(node, lines);
  const signature = helpers.buildSignature(node, lines);

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
    usedBy: [],
  });
}

function extractClassMembers(classNode, lines, symbols) {
  const nameNode = classNode.childForFieldName("name");
  if (!nameNode) return;
  const className = nameNode.text;

  const body = classNode.childForFieldName("body");
  if (!body) return;

  for (const member of body.children) {
    if (member.type === "method_declaration") {
      const methodName = member.childForFieldName("name");
      if (!methodName) continue;

      const params = helpers.extractParameters(member.childForFieldName("parameters"), { typeFirst: true });
      const typeNode = member.childForFieldName("type");
      const returnType = typeNode?.text || null;
      const comment = helpers.extractPrecedingComment(member);
      const { source, line } = helpers.getNodeSource(member, lines);
      const signature = helpers.buildSignature(member, lines);
      const exported = helpers.isExported(member, "java");

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
        usedBy: [],
      });
    } else if (member.type === "constructor_declaration") {
      const methodName = member.childForFieldName("name");
      if (!methodName) continue;

      const params = helpers.extractParameters(member.childForFieldName("parameters"), { typeFirst: true });
      const comment = helpers.extractPrecedingComment(member);
      const { source, line } = helpers.getNodeSource(member, lines);
      const signature = helpers.buildSignature(member, lines);
      const exported = helpers.isExported(member, "java");

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
        usedBy: [],
      });
    } else if (member.type === "field_declaration") {
      // Only extract static final fields as constants
      const modifiers = member.childForFieldName("modifiers") || member.children?.find(c => c.type === "modifiers");
      if (!modifiers) continue;
      const modTexts = modifiers.children.map(c => c.text);
      if (!modTexts.includes("static") || !modTexts.includes("final")) continue;

      // Find the declarator to get the field name
      const declarator = member.childForFieldName("declarator")
        || member.children.find(c => c.type === "variable_declarator");
      if (!declarator) continue;
      const fieldName = declarator.childForFieldName("name");
      if (!fieldName) continue;

      const comment = helpers.extractPrecedingComment(member);
      const { source, line } = helpers.getNodeSource(member, lines);
      const exported = helpers.isExported(member, "java");

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
        usedBy: [],
      });
    }
  }
}

function extractImports(rootNode, _source) {
  const imports = [];

  for (const node of rootNode.children) {
    if (node.type !== "import_declaration") continue;

    const text = node.text;
    const isStatic = text.includes("import static ");

    // Get the scoped_identifier or identifier child (skip "import", "static", ";")
    let pathNode = null;
    for (const child of node.children) {
      if (child.type === "scoped_identifier" || child.type === "identifier") {
        pathNode = child;
      }
    }

    if (!pathNode) continue;
    const fullPath = pathNode.text;

    if (fullPath.endsWith(".*")) {
      // Wildcard import: import com.example.*
      const packagePath = fullPath.slice(0, -2);
      imports.push({
        source: packagePath,
        symbols: ["*"],
        typeOnly: false,
      });
    } else if (isStatic) {
      // Static import: import static com.example.Foo.bar
      // The last segment is the member, everything before is the class
      const lastDot = fullPath.lastIndexOf(".");
      if (lastDot !== -1) {
        const classPath = fullPath.slice(0, lastDot);
        const memberName = fullPath.slice(lastDot + 1);
        imports.push({
          source: classPath,
          symbols: [memberName],
          typeOnly: false,
        });
      } else {
        imports.push({
          source: fullPath,
          symbols: [fullPath],
          typeOnly: false,
        });
      }
    } else {
      // Regular import: import com.example.Foo
      const lastDot = fullPath.lastIndexOf(".");
      const simpleName = lastDot !== -1 ? fullPath.slice(lastDot + 1) : fullPath;
      imports.push({
        source: fullPath,
        symbols: [simpleName],
        typeOnly: false,
      });
    }
  }

  return imports;
}

/**
 * Extract function calls from symbol bodies using tree-sitter AST traversal.
 * @param {object} rootNode - the file's root AST node
 * @param {object[]} symbols - extracted symbols with line numbers
 * @param {object[]} fileImports - resolved imports for this file
 * @returns {Map<string, Array>} symbolName -> calls array
 */
function extractCalls(rootNode, symbols, fileImports) {
  const callMap = new Map();

  // Build import lookup: local name -> { source, resolvedPath, resolvedModule }
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

  // Build local symbol lookup
  const localSymbols = new Set(symbols.map(s => s.name));

  for (const sym of symbols) {
    if (sym.kind !== "method") continue;

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
  const targetLine = sym.line - 1; // sym.line is 1-indexed

  function search(node) {
    if (node.startPosition.row === targetLine) {
      const body = helpers.findFunctionBody(node);
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

const JAVA_BUILTINS = new Set([
  "System", "String", "Integer", "Long", "Double", "Float",
  "Boolean", "Character", "Byte", "Short", "Arrays", "Collections",
  "Objects", "Optional", "Math", "Thread",
]);

function walkForCalls(node, calls, seen, importLookup, localSymbols, callerName) {
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
            isExternal: callInfo.isExternal,
          });
        }
      }
    }
  } else if (node.type === "object_creation_expression") {
    // new Foo(...)
    const typeNode = node.childForFieldName("type");
    if (typeNode) {
      const typeName = typeNode.text;
      if (!JAVA_BUILTINS.has(typeName)) {
        const imp = importLookup.get(typeName);
        const callInfo = imp
          ? { name: typeName, resolvedFile: imp.resolvedPath, resolvedModule: imp.resolvedModule, isExternal: imp.resolvedModule === "external" }
          : localSymbols.has(typeName)
            ? { name: typeName, resolvedFile: null, resolvedModule: null, isExternal: false }
            : null;

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
  }

  for (let i = 0; i < node.childCount; i++) {
    walkForCalls(node.child(i), calls, seen, importLookup, localSymbols, callerName);
  }
}

function resolveMethodInvocation(nameNode, objNode, importLookup, localSymbols) {
  const methodName = nameNode.text;

  if (!objNode) {
    // Unqualified call: foo() — could be local or statically imported
    if (JAVA_BUILTINS.has(methodName)) return null;

    const imp = importLookup.get(methodName);
    if (imp) {
      return {
        name: methodName,
        resolvedFile: imp.resolvedPath,
        resolvedModule: imp.resolvedModule,
        isExternal: imp.resolvedModule === "external",
      };
    }

    if (localSymbols.has(methodName)) {
      return { name: methodName, resolvedFile: null, resolvedModule: null, isExternal: false };
    }

    return null;
  }

  // Qualified call: obj.method()
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
        isExternal: imp.resolvedModule === "external",
      };
    }

    // Could be a local class static call
    if (localSymbols.has(objName)) {
      return { name: `${objName}.${methodName}`, resolvedFile: null, resolvedModule: null, isExternal: false };
    }
  }

  return null;
}

const JAVA_SOURCE_ROOTS = ["src/main/java/", "src/", "app/", ""];

function resolveImport(importPath, fromFile, projectRoot, fileIndex) {
  // Convert dotted package path to file path: com.example.Foo -> com/example/Foo.java
  const filePart = importPath.replace(/\./g, "/") + ".java";

  for (const root of JAVA_SOURCE_ROOTS) {
    const rel = root + filePart;

    if (fileIndex) {
      const exact = fileIndex.resolve(rel);
      if (exact) {
        return { resolvedPath: exact, resolvedModule: getModuleFromRelPath(exact) };
      }
    }

    // Try without .java extension for wildcard/directory resolution
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

function getModulePath(filePath, projectRoot) {
  return sharedGetModuleName(filePath, projectRoot);
}

export default {
  id: "java",
  loadGrammar,
  extractSymbols,
  extractImports,
  extractCalls,
  resolveImport,
  getModulePath,
};
