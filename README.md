# Codesight

Visualize any codebase as an interactive, drillable graph — from high-level directories down to individual functions.

Codesight uses tree-sitter to parse your code, extract symbols, resolve imports, and build call graphs. Everything renders as a navigable map inside VS Code. No LLM required for the core experience.

Supports **TypeScript, JavaScript, Python, C, C++, and Java**.

---

## Install

**Prerequisites:** [Node.js 18+](https://nodejs.org/), [VS Code 1.90+](https://code.visualstudio.com/), [Git](https://git-scm.com/)

```bash
git clone https://github.com/spirituslab/codesight.git
cd codesight
npm install
cd vscode
npm install
npm run build
npx @vscode/vsce package --allow-missing-repository
code --install-extension codesight-0.1.1.vsix
```

That's it. Now open any project in VS Code and run:

`Ctrl+Shift+P` → **Codesight: Open Graph**

The graph appears with your project's structure.

---

## The Graph

The graph works like a file explorer — click to drill in, breadcrumbs to go back:

**Directories** → **Folders** (as deep as your project goes) → **Files** → **Symbols**

Each level shows import relationships and call edges between items. Deeply nested projects work fine — folder drill-down is recursive.

### Node Shapes

| Shape | Meaning |
|-------|---------|
| **Rounded rectangle** | Directory / module (L1) |
| **Barrel** | Subfolder (L2) |
| **Cut rectangle** | File (L2/L3) |
| **Rounded rectangle** | Function / method (L4) |
| **Hexagon** | Class / struct (L4) |
| **Diamond** | Interface / type (L4) |
| **Octagon** | Enum (L4) |
| **Tag** | Constant (L4) |

### Navigation

| Action | What it does |
|--------|-------------|
| **Click** node | Drill down into it |
| **Click** symbol node | Opens the file at that line in VS Code |
| **← button** | Go back one level |
| **Breadcrumb path** | Click any segment to jump to that level |
| **Ctrl+K** | Global search across all nodes |

### Commands

| Command | Description |
|---------|-------------|
| **Codesight: Open Graph** | Analyze and show the graph |
| **Codesight: Refresh Analysis** | Re-analyze after code changes |
| **Codesight: Generate Idea Layer** | Generate AI conceptual overlay (needs Copilot or Claude Code) |
| **Reveal in Codesight Graph** | Right-click a file in the editor → find it in the graph |

---

## Idea Layer

The idea layer is a second graph that shows *what* your project does — features, responsibilities, architecture — with lines connecting each concept to the code that implements it.

### How to generate it

You need either GitHub Copilot or Claude Code. Pick whichever you have:

**Option A — GitHub Copilot:**

1. Install the [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) extension and sign in
2. `Ctrl+Shift+P` → **Codesight: Generate Idea Layer**

**Option B — Claude Code:**

1. Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and add codesight to your project's MCP config (see [MCP Setup](#setup) below)
2. In your terminal, ask:

```
> Generate the idea layer for this project
```

### Using the idea layer

| Action | What it does |
|--------|-------------|
| **Click** idea node | Highlights mapping lines to the code layer |
| **Click** background | Clears highlights |

The idea layer **persists across refreshes** — when you refresh the code analysis, the idea layer stays. Mappings to renamed or deleted code silently fade out.

---

## MCP Integration (Claude Code)

Codesight exposes structural intelligence as MCP tools for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). These give Claude access to call graphs, impact analysis, and code structure that it can't get from reading files alone.

### Setup

Add this to your project's `.mcp.json` (create the file in your project root if it doesn't exist):

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

Replace `/path/to/codesight` with wherever you cloned the repo. Then start Claude Code in your project — the tools are available immediately.

### Tools

| Tool | Description |
|------|-------------|
| `codesight_explore` | Navigate the code structure — project overview, module details, file symbols, or symbol callers/callees |
| `codesight_impact` | What breaks if you change a file or symbol — direct and transitive dependents with risk levels |
| `codesight_trace` | Find the call path between two functions |
| `codesight_search` | Search for functions, classes, or types by name across the project |
| `codesight_idea_layer` | Generate or push a conceptual idea layer overlay to the VS Code graph |
| `codesight_refresh` | Re-run analysis to pick up file changes |

### Example prompts

```
> Explore the src module
> What would break if I change src/auth/service.ts?
> Trace the call path from handleRequest to saveToDatabase
> Search for all classes in the project
> Generate the idea layer for this project
```

You don't need to name the tools — just ask naturally and Claude will use the right one.

---

## CLI

Export analysis as JSON for CI or scripting (no VS Code required):

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

**Debug the extension:**

1. Open the `vscode/` folder in VS Code
2. Press **F5** — launches a new VS Code window with the extension loaded
3. Open any project in that window and run **Codesight: Open Graph**

---

## License

[MIT](LICENSE)
