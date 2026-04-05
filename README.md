# Codesight

Visualize any codebase as an interactive, drillable graph. No LLM required.

Codesight parses your code with tree-sitter, extracts symbols, resolves imports, builds call graphs, and renders everything as a navigable map — from high-level modules down to individual functions.

Optionally, add an AI-powered **Idea Layer** that maps *what* your project does (features, concepts, architecture) to *where* it's implemented.

Supports **TypeScript, JavaScript, Python, C, C++, and Java**.

---

## Quick Start (VS Code)

**Prerequisites:** Node.js 18+, VS Code 1.90+, Git

```bash
git clone https://github.com/spirituslab/codesight.git
cd codesight
npm install
cd vscode
npm install
npm run build
npx @vscode/vsce package --allow-missing-repository
code --install-extension codesight-0.1.0.vsix
```

Then in VS Code:

1. Open any project
2. `Cmd+Shift+P` (or `Ctrl+Shift+P`) → **Codesight: Open Graph**

That's it. The graph appears with your project's module structure.

---

## Using the Graph

The graph has **4 drill-down levels**:

**Modules** → **Folders** → **Files** → **Symbols**

Click any node to drill in. Each level shows relationships (imports, dependencies, call edges) between items at that level.

### Navigation

| Action | What it does |
|--------|-------------|
| **Click** node | Drill down into it |
| **Click** symbol node | Opens the file at that line in VS Code |
| **Right-click** any node | Open chat panel with that node as context |
| **← button** | Go back one level |
| **Breadcrumb path** | Click any segment to jump back to that level |
| **Ctrl+/** | Toggle chat panel |

### Commands

| Command | Description |
|---------|-------------|
| **Codesight: Open Graph** | Analyze and open the graph |
| **Codesight: Refresh Analysis** | Re-analyze after code changes |
| **Codesight: Generate Idea Layer** | Generate AI conceptual overlay (needs Copilot) |
| **Reveal in Codesight Graph** | Right-click in editor → find symbol in graph |

---

## Idea Layer (Optional)

The idea layer is a second graph that shows *what* your project does — features, responsibilities, architectural patterns — with lines connecting each concept to the code that implements it.

### How to generate it

**Option A — GitHub Copilot (in VS Code):**

1. Install the **GitHub Copilot** extension and sign in
2. `Cmd+Shift+P` → **Codesight: Generate Idea Layer**

> Requires the `github.copilot` extension (not just Copilot Chat). This is what provides the `vscode.lm` language model API.

**Option B — Claude Code (in terminal):**

```
> use codesight to generate the idea layer for this project
```

### Interacting with the idea layer

| Action | What it does |
|--------|-------------|
| **Left-click** idea node | Highlights mapping lines to the code layer |
| **Right-click** idea node | Opens chat panel with that concept as context |
| **Click** background | Clears all highlights |

The idea layer **persists across code refreshes**. When you refresh the analysis, the code layer updates but the idea layer stays — mappings to renamed or deleted code silently fade out.

---

## Chat Panel

Right-click any node (code or idea) to ask questions about it. The chat routes automatically:

| Your setup | What happens |
|---|---|
| **GitHub Copilot** installed | Answered instantly via Copilot's LLM |
| **Any vscode.lm extension** | Same — uses that model |
| **Claude Code** (terminal) | Saved to `.codesight/chat-request.json`, answered via MCP |

---

## MCP Integration (Claude Code)

Codesight exposes code analysis as MCP tools for Claude Code and other MCP-compatible assistants.

### Setup

The `.mcp.json` in the repo root auto-registers when you start Claude Code in the project directory.

To use on **another project**, add to that project's `.mcp.json`:

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

### Tools

| Tool | Description |
|------|-------------|
| `codesight_list_modules` | List all modules with file counts and dependencies |
| `codesight_get_module` | Detailed info about a specific module |
| `codesight_explain_file` | File's symbols, imports, and module membership |
| `codesight_search_symbols` | Search for functions/classes/types by name |
| `codesight_impact_analysis` | What would be affected by changing a file |
| `codesight_call_graph` | Function call relationships |
| `codesight_generate_idea_structure` | Get project data for generating the idea layer |
| `codesight_set_idea_layer` | Push an idea structure to the VS Code graph |
| `codesight_chat_respond` | Read a pending chat question from the graph UI |
| `codesight_chat_send_response` | Send an answer back to the chat panel |
| `codesight_refresh` | Re-run analysis to pick up file changes |

### Example

```
> What modules does this project have?
> What would break if I change src/auth/service.ts?
> Generate the idea layer for this project
```

---

## CLI

Export analysis as JSON for CI or scripting:

```bash
node analyze.mjs /path/to/project --json > analysis.json
node analyze.mjs /path/to/project -o analysis.json
node analyze.mjs /path/to/project --max-files 1000
```

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON to stdout |
| `-o, --output <file>` | Write analysis JSON to a file |
| `--max-files N` | Maximum files to analyze (default: 5000) |

---

## Supported Languages

| Language | Symbols | Imports | Call Graph |
|----------|---------|---------|------------|
| TypeScript / JavaScript | Functions, classes, interfaces, types, enums, constants | ES imports, re-exports, path aliases | Full with confidence scoring |
| Python | Functions, classes, constants | import, from...import, relative imports | Full |
| C | Functions, structs, unions, enums, typedefs | #include (local and system) | Full |
| C++ | Classes, namespaces, templates + all C | #include, using declarations | Full |
| Java | Classes, interfaces, enums, methods | Package imports, wildcards, static imports | Full |

---

## Development

```bash
npm test              # Run tests
npm run test:watch    # Watch mode

cd vscode
npm run build         # Build extension
npm run watch         # Watch mode for extension
```

**Extension Development Host** (for debugging):

1. Open the `vscode/` folder in VS Code
2. Press **F5** — launches a new VS Code window with the extension loaded
3. Open any project in that window and run **Codesight: Open Graph**

---

## License

[MIT](LICENSE)
