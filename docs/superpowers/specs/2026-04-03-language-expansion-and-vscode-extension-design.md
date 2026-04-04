# Codesight: Language Expansion & VS Code Extension

**Date:** 2026-04-03  
**Status:** Draft  
**Scope:** Add C/C++ and Java language support; build a VS Code extension with webview graph, bidirectional navigation, and chat participant integration.

---

## Context

Codesight is a static analysis tool that visualizes code structure as interactive graphs. It currently supports TypeScript/JavaScript and Python. AI coding agents (Claude, Codex, Copilot) generate large amounts of code quickly, and developers lose track of project structure. Two gaps need to be closed:

1. **Language breadth** — C/C++ and Java are widely used in enterprise and systems programming but unsupported.
2. **Platform reach** — Codesight is a standalone CLI + browser tool. Developers need it inside VS Code where they already work, especially alongside AI agents.

The goal is to make codesight the tool developers reach for when AI agents have changed their codebase faster than they can follow.

---

## Part 1: Language Expansion

### Architecture

Each language implements 6 functions conforming to the existing plugin interface in `src/languages/index.mjs`:

- `loadGrammar(require)` — returns tree-sitter grammar
- `extractSymbols(rootNode, source)` — returns Symbol[]
- `extractImports(rootNode, source)` — returns Import[]
- `extractCalls(rootNode, symbols, fileImports)` — returns Map<name, Call[]>
- `resolveImport(importPath, fromFile, projectRoot, fileIndex)` — returns { resolvedPath, resolvedModule }
- `getModulePath(filePath, projectRoot)` — returns module name

A new shared helpers module reduces duplication across language implementations.

### Shared Helpers (`src/languages/helpers.mjs`)

| Helper | Purpose |
|--------|---------|
| `extractPrecedingComment(node)` | Finds doc comment immediately above a declaration |
| `walkForNodeTypes(rootNode, types)` | Generator that yields all descendant nodes matching given types |
| `extractParameters(paramListNode)` | Parses parameter lists into `[{name, type}]` — similar syntax across C/C++/Java |
| `getNodeSource(node, source)` | Extracts source text with line number |
| `isExported(node, language)` | Language-aware visibility check (not-static for C, public for Java, etc.) |
| `findFunctionBody(node)` | Locates the body/block child of a function/method node |

### C Language (`src/languages/c.mjs`)

**Grammar:** `tree-sitter-c`  
**Extensions:** `.c`, `.h`

**Symbol extraction:**
- `function_definition` → functions (name, parameters, return type)
- `struct_specifier`, `union_specifier`, `enum_specifier` → type declarations
- `declaration` with `init_declarator` → global variables/constants
- `type_definition` → typedefs
- Visibility: exported = not `static` keyword

**Import extraction:**
- `preproc_include` nodes
- `#include "file.h"` → local (resolvable)
- `#include <stdlib.h>` → system (external)

**Import resolution:**
- Search relative to source file directory
- Search project root
- Search common include directories: `include/`, `src/`, `lib/`
- Map `.h` ↔ `.c` pairs for header/implementation association

**Call extraction:**
- Walk function bodies for `call_expression` nodes
- Resolve against local symbols and symbols from included files
- Handle function pointers where identifiable

### C++ Language (`src/languages/cpp.mjs`)

**Grammar:** `tree-sitter-cpp`  
**Extensions:** `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`

**Extends C with:**
- `class_specifier` → classes with methods and access specifiers (public/private/protected)
- `namespace_definition` → namespace grouping
- `template_declaration` → template functions/classes
- `using_declaration`, `using_directive` → namespace imports
- Method extraction from class bodies with visibility tracking
- Constructor/destructor extraction

**Import resolution:** Same as C, plus namespace-aware resolution.

**Implementation note:** C++ module imports the C module and extends it. Shared extraction logic is not duplicated.

### Java Language (`src/languages/java.mjs`)

**Grammar:** `tree-sitter-java`  
**Extensions:** `.java`

**Symbol extraction:**
- `class_declaration`, `interface_declaration`, `enum_declaration` → types
- `method_declaration`, `constructor_declaration` → methods
- `field_declaration` with `static final` → constants
- `annotation_type_declaration` → annotations
- Visibility: `public` modifier = exported

**Import extraction:**
- `import_declaration` → `import com.example.Foo`
- Wildcard: `import com.example.*`
- Static imports: `import static com.example.Foo.bar`

**Import resolution:**
- Map package paths to file paths: `com.example.Foo` → `com/example/Foo.java`
- Search source roots: `src/main/java/`, `src/`, `app/`
- Handle Gradle and Maven project structures
- `package` declaration determines the expected directory structure

**Call extraction:**
- `method_invocation` nodes
- `object_creation_expression` for constructor calls
- Resolve `this.method()`, `ClassName.staticMethod()`, and imported method calls

### Detector Updates (`src/analyzer/detector.mjs`)

Add to `EXTENSION_MAP`:
- `.c` → `c`
- `.h` → `c` (default; if a `.cpp`/`.cc` file exists in the same directory, the detector may reclassify as `cpp` — but for v1, default to C since tree-sitter-cpp is a superset and handles both)
- `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` → `cpp`
- `.java` → `java`

### Dependencies

Add to `package.json`:
- `tree-sitter-c`
- `tree-sitter-cpp` (v0.23.4)
- `tree-sitter-java`

---

## Part 2: VS Code Extension

### Directory Structure

```
vscode/
├── package.json          # Extension manifest
├── tsconfig.json
├── src/
│   ├── extension.ts      # activate() / deactivate()
│   ├── analyzer.ts       # Wraps codesight analysis engine
│   ├── watcher.ts        # File save listener → incremental re-analysis
│   ├── webview.ts        # Creates/manages webview panel
│   ├── navigation.ts     # Bidirectional graph ↔ editor navigation
│   └── chat-participant.ts  # @codesight chat participant
└── media/                # Icons, webview CSS overrides
```

### Core Flow

1. **Activation:** Extension activates when a workspace opens. Runs initial full analysis using codesight's `src/analyzer/index.mjs`.

2. **Webview panel:** Command `codesight.openGraph` opens a webview tab containing the existing Lit + Cytoscape web UI. Analysis data is passed via `webview.postMessage()` instead of `window.CODEBASE_DATA`.

3. **File watcher:** Listens on `workspace.onDidSaveTextDocument`. On save, re-analyzes only the changed file using the existing cache system (`src/analyzer/cache.mjs`). Sends updated data to the webview.

4. **Graph → Editor:** User clicks a node in the graph. Webview posts message with file path + line number. Extension calls `vscode.window.showTextDocument()` to open file at that location.

5. **Editor → Graph:** User right-clicks a symbol in the editor, selects "Reveal in Codesight Graph". Extension sends file/symbol info to webview, which highlights and centers on that node.

### Message Protocol

**Extension → Webview:**

| Message | Purpose |
|---------|---------|
| `{ type: 'updateData', data }` | Send full or incremental analysis results |
| `{ type: 'highlightNode', nodeId }` | Highlight a specific node (for editor → graph) |
| `{ type: 'navigateToLevel', level, target }` | Navigate to a specific drill-down level |

**Webview → Extension:**

| Message | Purpose |
|---------|---------|
| `{ type: 'openFile', path, line }` | Request to open a file at a line |
| `{ type: 'ready' }` | Webview loaded, ready for data |
| `{ type: 'requestRefresh' }` | Manual refresh requested |

### Web UI Adaptations

The existing web UI (`web/src/`) needs these changes to work inside a webview:

1. **Data source:** Replace `window.CODEBASE_DATA` read with a message listener that receives data from the extension host.
2. **Navigation hooks:** Click handlers post messages to extension instead of being self-contained.
3. **Content Security Policy:** Set proper CSP with nonces for scripts. Lit and Cytoscape work under standard webview CSP.
4. **Theme:** Keep Catppuccin as branded look. Optionally read VS Code CSS variables for contrast adjustments.

### Extension Manifest

```json
{
  "name": "codesight",
  "displayName": "Codesight",
  "description": "Interactive code structure visualization via static analysis",
  "categories": ["Visualization", "Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "codesight.openGraph",
        "title": "Codesight: Open Graph"
      },
      {
        "command": "codesight.refresh",
        "title": "Codesight: Refresh Analysis"
      },
      {
        "command": "codesight.revealInGraph",
        "title": "Reveal in Codesight Graph"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "codesight.revealInGraph",
          "group": "navigation"
        }
      ]
    },
    "chatParticipants": [
      {
        "id": "codesight",
        "name": "codesight",
        "fullName": "Codesight",
        "description": "Ask about code structure, dependencies, and impact analysis",
        "isSticky": false
      }
    ]
  }
}
```

### Chat Participant (`@codesight`)

Registered via `vscode.chat.createChatParticipant('codesight', handler)`.

**How it works:**
1. Receives user's question + conversation history
2. Gathers relevant context from current analysis (module structure, symbols, call graph, impact map)
3. Builds a context prompt with the structural data
4. Calls `request.model.sendRequest()` — uses whatever LLM the user already has (Copilot, Claude, etc.)
5. Streams the response back

**Example interactions:**
- `@codesight what does the auth module do?` → injects module files, key symbols, dependencies
- `@codesight what breaks if I change UserService?` → injects impact analysis transitive dependents
- `@codesight explain the call chain from main to database` → injects call graph path

**Context injection strategy:**
- For module questions: inject module metadata + file list + exported symbols
- For impact questions: inject impact map entries for referenced files/symbols
- For call chain questions: inject relevant subgraph of the call graph
- Always include a structural summary (module count, file count, key entry points) as baseline context

### Analyzer Integration

The extension imports codesight's analyzer as a Node.js module (not a subprocess):

```typescript
// Pseudocode
import { analyze } from '../src/analyzer/index.mjs';

const result = await analyze(workspaceRoot, { llm: false, cache: true });
webviewPanel.webview.postMessage({ type: 'updateData', data: result });
```

For incremental updates on file save:
- Re-parse the changed file only
- Update symbols, imports, and call graph entries for that file
- Recompute affected edges
- Send delta update to webview

---

## Verification Plan

### Language Expansion
1. **Unit tests:** For each new language, add test files in `tests/`:
   - `symbols-c.test.mjs`, `symbols-cpp.test.mjs`, `symbols-java.test.mjs`
   - `imports-c.test.mjs`, `imports-java.test.mjs`
   - `callgraph-c.test.mjs`, `callgraph-java.test.mjs`
2. **Integration test:** Run `codesight` against a small multi-language project containing C, C++, Java, TS, and Python files. Verify all languages appear in the output with correct symbols and cross-file edges.
3. **Manual check:** Open the web UI and verify the graph correctly shows modules/files/symbols for each language.

### VS Code Extension
1. **Extension smoke test:** Open a workspace in VS Code with the extension installed. Verify the graph opens, shows the correct structure, and responds to clicks.
2. **File watcher test:** Edit and save a file. Verify the graph updates within a few seconds.
3. **Navigation test:** Click a symbol node → verify VS Code opens the correct file at the correct line. Right-click a function in the editor → verify the graph highlights the corresponding node.
4. **Chat participant test:** Type `@codesight what does module X do?` in Copilot Chat. Verify it returns a relevant answer that references actual project structure.
5. **Performance:** Test on a medium-sized project (~500 files). Initial analysis should complete in under 30 seconds. Incremental updates on save should complete in under 2 seconds.

---

## Implementation Order

1. Shared language helpers (`src/languages/helpers.mjs`)
2. C language support
3. C++ language support (extends C)
4. Java language support
5. Tests for all new languages
6. VS Code extension scaffold (package.json, activation, webview)
7. Analyzer integration + file watcher
8. Web UI adaptations for webview
9. Bidirectional navigation
10. Chat participant
11. End-to-end testing
