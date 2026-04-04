# Codesight

Universal code structure visualization via static analysis, built on two layers:

- **Code Layer** — Pure static analysis. Codesight parses your codebase with tree-sitter, extracts symbols, resolves imports, builds call graphs, and renders everything as an interactive explorable map with 4 levels of drill-down (modules, folders, files, symbols). No LLM required — fast, deterministic, and works offline.

- **Idea Layer** — AI-powered conceptual overlay. Using whatever LLM you already have (Copilot, Claude Code, or any VS Code LLM extension), Codesight generates a conceptual map of *what* your project does — features, responsibilities, and architectural patterns — linked to the actual code that implements them.

Supports **TypeScript, JavaScript, Python, C, C++, and Java**.

Works as a **VS Code extension**, a **CLI + browser tool**, and an **MCP server** for AI assistants like Claude Code.

---

## VS Code Extension (Recommended)

The VS Code extension gives you an interactive code graph right inside your editor, with bidirectional navigation and AI-powered explanations.

### Installation

```bash
# Clone the repository
git clone https://github.com/spirituslab/codesight.git
cd codesight

# Install dependencies
npm install

# Build the VS Code extension
cd vscode
npm install
npm run build
```

### Running in VS Code

**Option A: Extension Development Host (for development/testing)**

1. Open the `vscode/` folder in VS Code
2. Press **F5** to launch the Extension Development Host
3. In the new window, open any project folder
4. `Ctrl+Shift+P` → **"Codesight: Open Graph"**

**Option B: Install from VSIX (for regular use)**

```bash
cd vscode
npx vsce package
code --install-extension codesight-0.1.0.vsix
```

Then open any project and run `Ctrl+Shift+P` → **"Codesight: Open Graph"**.

### Commands

| Command | Description |
|---------|-------------|
| **Codesight: Open Graph** | Analyze the project and open the interactive graph |
| **Codesight: Refresh Analysis** | Re-run analysis to pick up changes |
| **Codesight: Generate Idea Layer** | Generate a conceptual map using your installed LLM extension |
| **Reveal in Codesight Graph** | Right-click in editor to highlight that symbol in the graph |

### Using the Graph

The graph has **4 levels of drill-down**:

1. **Modules** — top-level project structure (click to drill in)
2. **Folders** — subdirectories within a module
3. **Files** — individual files with import/export relationships
4. **Symbols** — functions, classes, methods, types within a file

**Navigation:**
- **Click** a node to drill down into it
- **Click** a symbol node to open that file at the symbol's line in VS Code
- **Right-click** any node to open the chat panel with that node as context
- **Ctrl+/** to toggle the chat panel
- **Breadcrumbs** at the top show your current path — click to go back

### Chat Panel

The chat panel lets you ask questions about any module, file, or symbol. Right-click a node to set it as context, then type your question.

**How it routes your questions:**

| Your setup | What happens |
|---|---|
| **GitHub Copilot installed** | Question is answered instantly via Copilot's LLM |
| **Any vscode.lm-compatible extension** | Same — uses that extension's model |
| **Claude Code (terminal)** | Question is saved to `.codesight/chat-request.json`. Claude Code picks it up via MCP tools and writes the answer back |

For Copilot/LLM extension users, the chat is seamless — ask and get answers in seconds. For Claude Code users, see the [MCP Integration](#mcp-integration-claude-code) section below.

### Idea Layer

The idea layer is a conceptual overlay on the code graph — it shows **what** the project does (concepts, features, responsibilities) rather than **how** (files, functions). Each concept node links to the actual code that implements it.

**To generate it:**

- **With Copilot/LLM extension:** `Ctrl+Shift+P` → **"Codesight: Generate Idea Layer"**
- **With Claude Code:** In the terminal, ask: *"use codesight to generate the idea layer for this project"*

Once generated, clicking an idea node highlights the related code in the main graph and opens the chat panel with that concept as context.

### Auto-Refresh

The extension watches for file saves. When you save a source file in a supported language, the graph automatically re-analyzes and updates. The idea layer persists across refreshes.

---

## MCP Integration (Claude Code)

Codesight includes an MCP server that exposes code analysis as tools for Claude Code and other MCP-compatible AI assistants.

### Setup

The `.mcp.json` file in the project root auto-registers the server when you start a Claude Code session in the project directory:

```json
{
  "mcpServers": {
    "codesight": {
      "command": "node",
      "args": ["mcp-server.mjs", "."],
      "cwd": "/path/to/codesight"
    }
  }
}
```

To use codesight's MCP server on **another project**, add to that project's `.mcp.json`:

```json
{
  "mcpServers": {
    "codesight": {
      "command": "node",
      "args": ["/path/to/codesight/mcp-server.mjs", "."]
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `codesight_list_modules` | List all modules with file counts, symbols, and dependencies |
| `codesight_get_module` | Get detailed info about a specific module |
| `codesight_explain_file` | Get a file's symbols, imports, and module membership |
| `codesight_search_symbols` | Search for functions/classes/types by name |
| `codesight_impact_analysis` | See what would be affected by changing a file |
| `codesight_call_graph` | Get function call relationships, optionally filtered |
| `codesight_generate_idea_structure` | Get project data for generating the conceptual map |
| `codesight_set_idea_layer` | Push an idea structure to the VS Code graph |
| `codesight_chat_respond` | Read a pending chat question from the VS Code graph UI |
| `codesight_chat_send_response` | Send an answer back to the chat panel |
| `codesight_refresh` | Re-run analysis to pick up file changes |

### Example Usage in Claude Code

```
> What modules does this project have?
  (Claude calls codesight_list_modules)

> What would break if I change src/auth/service.ts?
  (Claude calls codesight_impact_analysis)

> Generate the idea layer for this project
  (Claude calls codesight_generate_idea_structure, then codesight_set_idea_layer)
```

---

## CLI + Browser

For quick one-off analysis without VS Code:

```bash
# Analyze and open in browser
node analyze.mjs /path/to/project --serve

# Analyze with LLM explanations (requires API key)
node analyze.mjs /path/to/project --llm --serve

# Just generate JSON output
node analyze.mjs /path/to/project --out analysis.json
```

Options:

```
--serve             Start web server and open browser (default port 8080)
--port <n>          Web server port
--out <file>        Write analysis JSON to file
--llm               Enable LLM explanations and idea structure
--llm-provider      LLM provider: claude or openai (default: claude)
--llm-model         Model name (default: provider-specific)
--llm-api-key       API key (or set ANTHROPIC_API_KEY / OPENAI_API_KEY env var)
```

---

## Supported Languages

| Language | Symbols | Imports | Call Graph |
|----------|---------|---------|------------|
| TypeScript / JavaScript | Functions, classes, interfaces, types, enums, constants | ES imports, re-exports, path aliases | Full with confidence scoring |
| Python | Functions, classes, constants (UPPER_CASE) | import, from...import, relative imports | Full |
| C | Functions, structs, unions, enums, typedefs | #include (local and system) | Full |
| C++ | Classes, namespaces, templates + all C features | #include, using declarations | Full |
| Java | Classes, interfaces, enums, methods, constructors | Package imports, wildcards, static imports | Full |

---

## Project Structure

```
codesight/
├── analyze.mjs              # CLI entry point
├── serve.mjs                # Web server for browser mode
├── mcp-server.mjs           # MCP server for Claude Code
├── src/
│   ├── analyzer/            # Core analysis pipeline
│   │   ├── index.mjs        # Main orchestrator
│   │   ├── parser.mjs       # Tree-sitter parsing
│   │   ├── callgraph.mjs    # Function call graph builder
│   │   ├── impact.mjs       # Dependency impact analysis
│   │   └── ...
│   ├── languages/           # Language-specific extractors
│   │   ├── typescript.mjs
│   │   ├── python.mjs
│   │   ├── c.mjs
│   │   ├── cpp.mjs
│   │   ├── java.mjs
│   │   └── helpers.mjs      # Shared extraction utilities
│   └── llm/                 # LLM integration (optional)
│       ├── ideas.mjs        # Idea structure generation
│       ├── explain.mjs      # Module/file explanations
│       └── prompts.mjs      # Prompt templates
├── web/                     # Frontend (Lit + Cytoscape.js)
│   └── src/components/      # Web components
├── vscode/                  # VS Code extension
│   └── src/
│       ├── extension.ts     # Extension entry point
│       ├── webview.ts       # Webview panel manager
│       ├── analyzer.ts      # Analysis wrapper
│       ├── watcher.ts       # File save watcher
│       ├── navigation.ts    # Bidirectional navigation
│       ├── chat-participant.ts  # @codesight for Copilot Chat
│       └── idea-layer.ts    # Idea layer via vscode.lm
└── tests/                   # Vitest test suite
```

---

## Development

```bash
# Run tests
npm test

# Watch mode
npm run test:watch

# Build VS Code extension
cd vscode && npm run build

# Watch mode for extension
cd vscode && npm run watch
```

---

## License

This project is licensed under the [MIT License](LICENSE).
