"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode6 = __toESM(require("vscode"));

// src/analyzer.ts
var path = __toESM(require("path"));
var AnalyzerWrapper = class {
  constructor(workspaceRoot) {
    this.result = null;
    this.analyzeModule = null;
    this.workspaceRoot = workspaceRoot;
  }
  async loadAnalyzer() {
    if (this.analyzeModule) return this.analyzeModule;
    const analyzerPath = path.resolve(__dirname, "../../src/analyzer/index.mjs");
    this.analyzeModule = await import(analyzerPath);
    return this.analyzeModule;
  }
  async runFullAnalysis() {
    try {
      console.log("[codesight] Loading analyzer from:", path.resolve(__dirname, "../../src/analyzer/index.mjs"));
      const mod = await this.loadAnalyzer();
      console.log("[codesight] Running analysis on:", this.workspaceRoot);
      this.result = await mod.analyze(this.workspaceRoot, { llm: false, cache: true });
      console.log("[codesight] Analysis complete. Modules:", this.result?.modules?.length);
      return this.result;
    } catch (err) {
      console.error("[codesight] Analysis failed:", err.message, err.stack);
      return null;
    }
  }
  async runIncrementalUpdate(filePath) {
    return this.runFullAnalysis();
  }
  getResult() {
    return this.result;
  }
  getImpactMap() {
    return this.result?.impactMap || {};
  }
  getCallGraph() {
    return this.result?.callGraph || null;
  }
  getModules() {
    return this.result?.modules || [];
  }
  findSymbolAtLine(filePath, line) {
    if (!this.result) return null;
    const relPath = path.relative(this.workspaceRoot, filePath);
    for (const mod of this.result.modules) {
      for (const file of mod.files || []) {
        if (file.path === relPath || file.path === filePath) {
          let closest = null;
          let minDist = Infinity;
          for (const sym of file.symbols || []) {
            const dist = Math.abs(sym.line - line);
            if (dist < minDist) {
              minDist = dist;
              closest = sym;
            }
          }
          return closest;
        }
      }
    }
    return null;
  }
};

// src/webview.ts
var vscode = __toESM(require("vscode"));
var WebviewManager = class {
  constructor(extensionUri) {
    this.panel = null;
    this.messageHandlers = [];
    this.extensionUri = extensionUri;
  }
  createOrShow(context) {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return this.panel;
    }
    this.panel = vscode.window.createWebviewPanel(
      "codesightGraph",
      "Codesight Graph",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "..", "web"),
          vscode.Uri.joinPath(this.extensionUri, "media")
        ]
      }
    );
    this.panel.webview.html = this.getWebviewContent(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((msg) => {
      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    }, null, context.subscriptions);
    this.panel.onDidDispose(() => {
      this.panel = null;
    }, null, context.subscriptions);
    return this.panel;
  }
  postMessage(msg) {
    this.panel?.webview.postMessage(msg);
  }
  onMessage(handler) {
    this.messageHandlers.push(handler);
  }
  getWebviewContent(webview) {
    const webDir = vscode.Uri.joinPath(this.extensionUri, "..", "web");
    const webSrcUri = webview.asWebviewUri(vscode.Uri.joinPath(webDir, "src"));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src ${webview.cspSource} https://esm.run https://cdn.jsdelivr.net https://cdnjs.cloudflare.com 'unsafe-inline';
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} https: data:;
    font-src ${webview.cspSource};
    connect-src https://esm.run https://cdn.jsdelivr.net;
  ">
  <title>Codesight Graph</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.4/cytoscape.min.js"></script>
  <script type="importmap">
  {
    "imports": {
      "lit": "https://esm.run/lit@3",
      "lit/": "https://esm.run/lit@3/",
      "@lit/reactive-element": "https://esm.run/@lit/reactive-element@2",
      "@lit/reactive-element/": "https://esm.run/@lit/reactive-element@2/",
      "lit-html": "https://esm.run/lit-html@3",
      "lit-html/": "https://esm.run/lit-html@3/",
      "lit-element/": "https://esm.run/lit-element@4/"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1e1e2e; height: 100vh; overflow: hidden; }
  </style>
</head>
<body>
  <cs-app>
    <cs-sidebar slot="sidebar">
      <cs-explorer slot="explorer"></cs-explorer>
      <cs-search-panel slot="search"></cs-search-panel>
      <cs-tour-panel slot="tours"></cs-tour-panel>
    </cs-sidebar>
    <cs-graph slot="graph"></cs-graph>
  </cs-app>
  <cs-global-search></cs-global-search>
  <cs-code-popup></cs-code-popup>
  <script>
    // Set flags SYNCHRONOUSLY before any modules load
    window.__CODESIGHT_VSCODE__ = acquireVsCodeApi();
    window.__CODESIGHT_WEBVIEW__ = true;
  </script>
  <script type="module">
    // Import all components
    import '${webSrcUri}/components/cs-app.js';
    import '${webSrcUri}/components/cs-graph.js';
    import '${webSrcUri}/components/cs-sidebar.js';
    import '${webSrcUri}/components/cs-global-search.js';
    import '${webSrcUri}/components/cs-code-popup.js';
    import '${webSrcUri}/panels/cs-explorer.js';
    import '${webSrcUri}/panels/cs-search-panel.js';
    import '${webSrcUri}/panels/cs-tour-panel.js';
  </script>
</body>
</html>`;
  }
};

// src/navigation.ts
var vscode2 = __toESM(require("vscode"));
var path2 = __toESM(require("path"));
var setupNavigation = {
  /**
   * Graph → Editor: Open a file at a specific line in VS Code.
   */
  openFile(filePath, line, workspaceRoot) {
    const absPath = path2.isAbsolute(filePath) ? filePath : path2.join(workspaceRoot, filePath);
    const uri = vscode2.Uri.file(absPath);
    const position = new vscode2.Position(Math.max(0, line - 1), 0);
    const range = new vscode2.Range(position, position);
    vscode2.window.showTextDocument(uri, {
      selection: range,
      viewColumn: vscode2.ViewColumn.One
    });
  },
  /**
   * Editor → Graph: Reveal a symbol from the editor in the graph.
   */
  revealInGraph(filePath, line, analyzer2, webviewManager2, workspaceRoot) {
    const symbol = analyzer2.findSymbolAtLine(filePath, line);
    if (!symbol) {
      vscode2.window.showInformationMessage("Codesight: No symbol found at cursor position.");
      return;
    }
    const relPath = path2.relative(workspaceRoot, filePath);
    const nodeId = `${relPath}:${symbol.name}`;
    webviewManager2.postMessage({ type: "highlightNode", nodeId });
  }
};

// src/chat-participant.ts
var vscode3 = __toESM(require("vscode"));
function registerChatParticipant(context, analyzer2) {
  const participant = vscode3.chat.createChatParticipant("codesight", async (request, chatContext, stream, token) => {
    const result = analyzer2.getResult();
    if (!result) {
      stream.markdown("Codesight analysis has not been run yet. Open the graph first with **Codesight: Open Graph** command.");
      return;
    }
    const prompt = request.prompt.toLowerCase();
    let contextText = buildBaselineContext(result);
    if (isModuleQuestion(prompt)) {
      contextText += buildModuleContext(prompt, result);
    } else if (isImpactQuestion(prompt)) {
      contextText += buildImpactContext(prompt, result);
    } else if (isCallChainQuestion(prompt)) {
      contextText += buildCallChainContext(prompt, result);
    } else {
      contextText += buildOverviewContext(result);
    }
    const messages = [
      vscode3.LanguageModelChatMessage.User(
        `You are a code structure expert. Use the following structural analysis data to answer the user's question about their codebase.

${contextText}

User question: ${request.prompt}`
      )
    ];
    try {
      const models = await vscode3.lm.selectChatModels({ family: "gpt-4o" });
      const model = models[0] ?? (await vscode3.lm.selectChatModels())[0];
      if (!model) {
        stream.markdown("No language model available. Please ensure you have GitHub Copilot or another LLM extension installed.");
        return;
      }
      const chatResponse = await model.sendRequest(messages, {}, token);
      for await (const fragment of chatResponse.text) {
        stream.markdown(fragment);
      }
    } catch (err) {
      if (err.code === "NoPermissions") {
        stream.markdown("Codesight needs permission to access the language model. Please allow access when prompted.");
      } else {
        stream.markdown(`Error: ${err.message || "Failed to get response from language model."}`);
      }
    }
  });
  participant.iconPath = vscode3.Uri.joinPath(context.extensionUri, "media", "icon.png");
  context.subscriptions.push(participant);
}
function buildBaselineContext(result) {
  const modules = result.modules || [];
  const languages = result.languages || [];
  const totalFiles = modules.reduce((sum, m) => sum + (m.files?.length || 0), 0);
  const totalSymbols = modules.reduce((sum, m) => sum + (m.files || []).reduce((s, f) => s + (f.symbols?.length || 0), 0), 0);
  return `## Project: ${result.projectName || "Unknown"}
- Languages: ${languages.join(", ")}
- Modules: ${modules.length}
- Files: ${totalFiles}
- Symbols: ${totalSymbols}
- Entry points: ${(result.keyFiles || []).map((f) => f.path).join(", ") || "none detected"}

`;
}
function buildModuleContext(prompt, result) {
  const modules = result.modules || [];
  let context = "## Module Details\n\n";
  const matchedModule = modules.find(
    (m) => prompt.includes(m.name.toLowerCase())
  );
  if (matchedModule) {
    context += `### Module: ${matchedModule.name}
`;
    context += `- Path: ${matchedModule.path}
`;
    context += `- Description: ${matchedModule.description || "N/A"}
`;
    context += `- Files: ${matchedModule.files?.length || 0}
`;
    context += `- Lines: ${matchedModule.lineCount || 0}

`;
    context += `**Files:**
`;
    for (const file of (matchedModule.files || []).slice(0, 20)) {
      context += `- ${file.path} (${file.symbols?.length || 0} symbols)
`;
      for (const sym of (file.symbols || []).slice(0, 10)) {
        context += `  - ${sym.kind}: ${sym.name}${sym.exported ? " (exported)" : ""}
`;
      }
    }
  } else {
    context += "Available modules:\n";
    for (const mod of modules) {
      context += `- **${mod.name}** (${mod.files?.length || 0} files, ${mod.lineCount || 0} lines): ${mod.description || ""}
`;
    }
  }
  return context + "\n";
}
function buildImpactContext(prompt, result) {
  const impactMap = result.impactMap || {};
  let context = "## Impact Analysis\n\n";
  const keys = Object.keys(impactMap);
  const matched = keys.find((k) => prompt.includes(k.toLowerCase().split("/").pop().replace(/\.\w+$/, "")));
  if (matched) {
    const impact = impactMap[matched];
    context += `### Impact of ${matched}
`;
    context += `- Direct dependents: ${impact.directDependents?.length || 0}
`;
    for (const dep of (impact.directDependents || []).slice(0, 15)) {
      context += `  - ${dep}
`;
    }
    context += `- Transitive dependents: ${impact.transitiveDependents?.length || 0}
`;
    for (const dep of (impact.transitiveDependents || []).slice(0, 15)) {
      context += `  - ${dep}
`;
    }
    context += `- Risk score: ${impact.riskScore || "N/A"}
`;
  } else {
    const sorted = keys.map((k) => ({ path: k, count: impactMap[k].transitiveDependents?.length || 0 })).sort((a, b) => b.count - a.count).slice(0, 10);
    context += "Highest-impact files:\n";
    for (const item of sorted) {
      context += `- ${item.path} (${item.count} transitive dependents)
`;
    }
  }
  return context + "\n";
}
function buildCallChainContext(prompt, result) {
  const callGraph = result.callGraph || { edges: [] };
  let context = `## Call Graph

Total edges: ${callGraph.edges?.length || 0}

`;
  const edges = callGraph.edges || [];
  const relevantEdges = edges.filter(
    (e) => prompt.includes(e.from?.toLowerCase()) || prompt.includes(e.to?.toLowerCase())
  );
  if (relevantEdges.length > 0) {
    context += "Relevant call relationships:\n";
    for (const edge of relevantEdges.slice(0, 30)) {
      context += `- ${edge.from} \u2192 ${edge.to} (${edge.confidence || "unknown"} confidence)
`;
    }
  } else {
    context += "Sample call relationships:\n";
    for (const edge of edges.slice(0, 20)) {
      context += `- ${edge.from} \u2192 ${edge.to}
`;
    }
  }
  return context + "\n";
}
function buildOverviewContext(result) {
  const modules = result.modules || [];
  let context = "## Project Overview\n\n";
  context += "Modules:\n";
  for (const mod of modules.slice(0, 15)) {
    context += `- **${mod.name}** (${mod.files?.length || 0} files): ${mod.description || ""}
`;
  }
  const edges = result.edges || [];
  if (edges.length > 0) {
    context += "\nModule dependencies:\n";
    for (const edge of edges.slice(0, 20)) {
      context += `- ${edge.source} \u2192 ${edge.target} (weight: ${edge.weight})
`;
    }
  }
  return context + "\n";
}
function isModuleQuestion(prompt) {
  return /\b(module|package|folder|directory|component)\b/.test(prompt);
}
function isImpactQuestion(prompt) {
  return /\b(impact|break|change|affect|depend|risk)\b/.test(prompt);
}
function isCallChainQuestion(prompt) {
  return /\b(call|chain|invoke|flow|trace|path)\b/.test(prompt);
}

// src/watcher.ts
var vscode4 = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var SUPPORTED_EXTENSIONS = /* @__PURE__ */ new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".c",
  ".h",
  ".cpp",
  ".cc",
  ".cxx",
  ".hpp",
  ".hh",
  ".hxx",
  ".java"
]);
function setupFileWatcher(context, analyzer2, webviewManager2) {
  let debounceTimer = null;
  const saveDisposable = vscode4.workspace.onDidSaveTextDocument((document) => {
    const ext = "." + document.fileName.split(".").pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const result = await analyzer2.runIncrementalUpdate(document.fileName);
      if (result) {
        webviewManager2.postMessage({ type: "updateData", data: result });
      }
    }, 500);
  });
  context.subscriptions.push(saveDisposable);
  const workspaceRoot = vscode4.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const ideaFile = path3.join(workspaceRoot, ".codesight", "idea-structure.json");
    const ideaDir = path3.join(workspaceRoot, ".codesight");
    const pattern = new vscode4.RelativePattern(workspaceRoot, ".codesight/idea-structure.json");
    const ideaWatcher = vscode4.workspace.createFileSystemWatcher(pattern);
    const loadIdeaStructure = () => {
      try {
        if (!fs.existsSync(ideaFile)) return;
        const content = fs.readFileSync(ideaFile, "utf-8");
        const ideaStructure = JSON.parse(content);
        if (!ideaStructure.nodes) return;
        const result = analyzer2.getResult();
        if (result) {
          result.ideaStructure = ideaStructure;
          webviewManager2.postMessage({ type: "updateData", data: result });
          console.log(`[codesight] Loaded idea layer: ${ideaStructure.nodes.length} concepts`);
        }
      } catch (err) {
        console.error("[codesight] Failed to load idea structure:", err.message);
      }
    };
    ideaWatcher.onDidCreate(loadIdeaStructure);
    ideaWatcher.onDidChange(loadIdeaStructure);
    context.subscriptions.push(ideaWatcher);
    loadIdeaStructure();
  }
}

// src/idea-layer.ts
var vscode5 = __toESM(require("vscode"));
async function generateIdeaLayer(analyzer2, webviewManager2) {
  const result = analyzer2.getResult();
  if (!result) {
    vscode5.window.showWarningMessage("Codesight: Run analysis first (Open Graph).");
    return;
  }
  let model;
  try {
    const allModels = await vscode5.lm.selectChatModels();
    console.log(
      `[codesight] Available models (${allModels?.length || 0}):`,
      allModels?.map((m) => `${m.name} (${m.vendor}, ${m.family}, ${m.id})`)
    );
    if (!allModels || allModels.length === 0) {
      vscode5.window.showErrorMessage(
        "Codesight: No language model available. Make sure your LLM extension (Copilot, Claude, etc.) is active in this window."
      );
      return;
    }
    model = allModels[0];
    console.log(`[codesight] Using model: ${model.name} (${model.vendor})`);
  } catch (err) {
    console.error("[codesight] LM API error:", err);
    vscode5.window.showErrorMessage(`Codesight: Failed to access language model: ${err.message}`);
    return;
  }
  const prompt = buildIdeaStructurePrompt(result);
  await vscode5.window.withProgress(
    { location: vscode5.ProgressLocation.Notification, title: "Codesight: Generating idea layer...", cancellable: true },
    async (progress, token) => {
      try {
        const messages = [
          vscode5.LanguageModelChatMessage.User(
            prompt.system + "\n\n" + prompt.user
          )
        ];
        const response = await model.sendRequest(messages, {}, token);
        let fullText = "";
        for await (const fragment of response.text) {
          fullText += fragment;
        }
        const parsed = parseJSON(fullText);
        if (!parsed || !parsed.nodes) {
          vscode5.window.showWarningMessage("Codesight: LLM returned an invalid idea structure. Try again.");
          console.error("[codesight] Invalid idea structure response:", fullText.slice(0, 500));
          return;
        }
        const validated = validateIdeaStructure(parsed, result);
        result.ideaStructure = validated;
        webviewManager2.postMessage({ type: "updateData", data: result });
        vscode5.window.showInformationMessage("Codesight: Idea layer generated successfully.");
      } catch (err) {
        if (err.code === "NoPermissions") {
          vscode5.window.showWarningMessage("Codesight: Please allow access to the language model when prompted.");
        } else if (token.isCancellationRequested) {
        } else {
          vscode5.window.showErrorMessage(`Codesight: Idea layer generation failed: ${err.message}`);
          console.error("[codesight] Idea layer error:", err);
        }
      }
    }
  );
}
function buildIdeaStructurePrompt(result) {
  const { projectName, modules, edges, keyFiles, languages } = result;
  const modulesSummary = (modules || []).map((m) => {
    const desc = m.explanation || m.description || "";
    const files = (m.files || []).slice(0, 8).map(
      (f) => `    ${f.path}${f.explanation ? ": " + f.explanation : ""}`
    ).join("\n");
    return `  ${m.name} (${m.files?.length || 0} files, ${m.lineCount || 0} lines): ${desc}
${files}`;
  }).join("\n\n");
  const edgesSummary = (edges || []).filter((e) => e.target !== "external").slice(0, 30).map((e) => `  ${e.source} \u2192 ${e.target} (${e.weight} imports)`).join("\n");
  const keyFilesSummary = (keyFiles || []).slice(0, 15).map(
    (f) => `  ${f.path} (imported by ${f.importedByCount} files${f.isEntryPoint ? ", entry point" : ""})`
  ).join("\n");
  const validModules = (modules || []).map((m) => m.name);
  const system = `You are a software architect who explains projects conceptually. Your job is to create an "idea structure" \u2014 a conceptual map of what a project does, organized by concepts and purposes rather than file paths.

Each idea node represents a concept, feature, or responsibility. Map each idea to actual code (modules, files, symbols) that implements it.

IMPORTANT:
- Only reference code that exists in the provided data
- Valid module names: ${JSON.stringify(validModules)}
- Create 5-15 idea nodes depending on project complexity
- Create edges between ideas that have relationships (e.g., "feeds into", "depends on", "protects")
- All ideas should be at the same level \u2014 no parent-child nesting, no hierarchy
- The idea structure should help someone understand WHAT the project does before HOW it's implemented`;
  const user = `Create an idea structure for this project.

Project: ${projectName || "Unknown"}
Languages: ${(languages || []).join(", ")}

Modules:
${modulesSummary}

Dependencies:
${edgesSummary}

Key files:
${keyFilesSummary}

Respond in JSON format:
{
  "projectSummary": "2-3 sentence high-level description of what this project does and its purpose",
  "nodes": [
    {
      "id": "idea:<kebab-case-id>",
      "label": "Human Readable Concept Name",
      "description": "1-2 sentence description of this concept/feature",
      "codeRefs": [
        { "type": "module", "name": "<module-name>" },
        { "type": "file", "path": "<file-path>" },
        { "type": "symbol", "path": "<file-path>", "name": "<symbol-name>" }
      ]
    }
  ],
  "edges": [
    { "source": "idea:<id>", "target": "idea:<id>", "label": "relationship description" }
  ]
}

Only use module names and file paths from the data above. Keep it conceptual \u2014 group by purpose, not by file structure.`;
  return { system, user };
}
function validateIdeaStructure(idea, result) {
  const validModules = new Set((result.modules || []).map((m) => m.name));
  const validFiles = new Set((result.modules || []).flatMap((m) => (m.files || []).map((f) => f.path)));
  const validSymbols = new Set((result.modules || []).flatMap(
    (m) => (m.files || []).flatMap(
      (f) => (f.symbols || []).filter((s) => s.exported).map((s) => `${f.path}::${s.name}`)
    )
  ));
  if (result.rootFiles) {
    for (const f of result.rootFiles) {
      validFiles.add(f.path);
      for (const s of (f.symbols || []).filter((s2) => s2.exported)) {
        validSymbols.add(`${f.path}::${s.name}`);
      }
    }
  }
  const nodeIds = new Set(idea.nodes.map((n) => n.id));
  let removedRefs = 0;
  let totalRefs = 0;
  for (const node of idea.nodes) {
    delete node.parentId;
    if (node.codeRefs) {
      totalRefs += node.codeRefs.length;
      node.codeRefs = node.codeRefs.filter((ref) => {
        if (ref.type === "module" && validModules.has(ref.name)) return true;
        if (ref.type === "file" && validFiles.has(ref.path)) return true;
        if (ref.type === "symbol" && validSymbols.has(`${ref.path}::${ref.name}`)) return true;
        removedRefs++;
        return false;
      });
    }
  }
  if (idea.edges) {
    idea.edges = idea.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  }
  if (removedRefs > 0) {
    console.log(`[codesight] Removed ${removedRefs}/${totalRefs} hallucinated code references from idea structure`);
  }
  return idea;
}
function parseJSON(text) {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
      }
    }
    return null;
  }
}

// src/extension.ts
var analyzer = null;
var webviewManager;
function getWorkspaceRoot() {
  return vscode6.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}
function ensureAnalyzer() {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode6.window.showWarningMessage("Codesight: Please open a folder first.");
    return null;
  }
  if (!analyzer) {
    analyzer = new AnalyzerWrapper(root);
  }
  return analyzer;
}
function activate(context) {
  console.log("[codesight] Extension activating...");
  webviewManager = new WebviewManager(context.extensionUri);
  context.subscriptions.push(
    vscode6.commands.registerCommand("codesight.openGraph", async () => {
      const a = ensureAnalyzer();
      if (!a) return;
      const panel = webviewManager.createOrShow(context);
      if (!a.getResult()) {
        await vscode6.window.withProgress(
          { location: vscode6.ProgressLocation.Notification, title: "Codesight: Analyzing project..." },
          async () => {
            await a.runFullAnalysis();
          }
        );
      }
      const result = a.getResult();
      if (result) {
        webviewManager.postMessage({ type: "updateData", data: result });
      } else {
        vscode6.window.showErrorMessage("Codesight: Analysis failed. Check the Output panel for details.");
      }
    }),
    vscode6.commands.registerCommand("codesight.refresh", async () => {
      const a = ensureAnalyzer();
      if (!a) return;
      await vscode6.window.withProgress(
        { location: vscode6.ProgressLocation.Notification, title: "Codesight: Refreshing analysis..." },
        async () => {
          await a.runFullAnalysis();
        }
      );
      const result = a.getResult();
      if (result) {
        webviewManager.postMessage({ type: "updateData", data: result });
      }
    }),
    vscode6.commands.registerCommand("codesight.generateIdeaLayer", async () => {
      const a = ensureAnalyzer();
      if (!a) return;
      if (!a.getResult()) {
        vscode6.window.showWarningMessage('Codesight: Run "Open Graph" first to analyze the project.');
        return;
      }
      await generateIdeaLayer(a, webviewManager);
    }),
    vscode6.commands.registerCommand("codesight.revealInGraph", () => {
      const root2 = getWorkspaceRoot();
      if (!root2 || !analyzer) return;
      const editor = vscode6.window.activeTextEditor;
      if (!editor) return;
      const filePath = editor.document.uri.fsPath;
      const line = editor.selection.active.line + 1;
      setupNavigation.revealInGraph(filePath, line, analyzer, webviewManager, root2);
    })
  );
  webviewManager.onMessage((msg) => {
    const root2 = getWorkspaceRoot();
    if (msg.type === "openFile" && root2) {
      setupNavigation.openFile(msg.path, msg.line, root2);
    } else if (msg.type === "ready" && analyzer) {
      const result = analyzer.getResult();
      if (result) {
        webviewManager.postMessage({ type: "updateData", data: result });
      }
    } else if (msg.type === "requestRefresh") {
      vscode6.commands.executeCommand("codesight.refresh");
    } else if (msg.type === "chatRequest") {
      handleChatRequest(msg, analyzer, webviewManager);
    }
  });
  const root = getWorkspaceRoot();
  if (root) {
    analyzer = new AnalyzerWrapper(root);
    setupFileWatcher(context, analyzer, webviewManager);
    try {
      if (vscode6.chat?.createChatParticipant) {
        registerChatParticipant(context, analyzer);
      }
    } catch (_) {
    }
  }
  console.log("[codesight] Extension activated successfully");
}
function deactivate() {
}
async function handleChatRequest(msg, analyzerInstance, webview) {
  const { message, context, history } = msg;
  const result = analyzerInstance?.getResult();
  let contextText = "";
  if (context.ideaNode) {
    contextText += `The user is asking about the concept "${context.ideaNode.label}": ${context.ideaNode.description}
`;
    if (context.ideaNode.codeRefs?.length) {
      contextText += `Related code: ${context.ideaNode.codeRefs.map(
        (r) => r.type === "module" ? `module:${r.name}` : r.path
      ).join(", ")}
`;
    }
  }
  if (context.currentFile && result) {
    for (const mod of result.modules || []) {
      const file = mod.files?.find((f) => f.path === context.currentFile);
      if (file) {
        contextText += `Currently viewing: ${file.path} in module ${mod.name}
`;
        contextText += `Symbols: ${file.symbols?.map((s) => `${s.kind} ${s.name}`).join(", ")}
`;
        break;
      }
    }
  }
  if (result) {
    contextText += `Project: ${result.projectName}, ${result.modules?.length} modules, ${result.languages?.join(", ")}
`;
  }
  try {
    const models = await vscode6.lm.selectChatModels();
    if (models && models.length > 0) {
      const model = models[0];
      const prompt = `You are a code structure expert. Use this context to answer the user's question.

${contextText}

User: ${message}`;
      const messages = [vscode6.LanguageModelChatMessage.User(prompt)];
      const response = await model.sendRequest(messages, {});
      let fullText = "";
      for await (const fragment of response.text) {
        fullText += fragment;
      }
      webview.postMessage({ type: "chatResponse", text: fullText, originalMessage: message });
      return;
    }
  } catch (_) {
  }
  const root = getWorkspaceRoot();
  if (root) {
    const fs2 = require("fs");
    const path4 = require("path");
    const outDir = path4.join(root, ".codesight");
    fs2.mkdirSync(outDir, { recursive: true });
    const requestFile = path4.join(outDir, "chat-request.json");
    fs2.writeFileSync(requestFile, JSON.stringify({
      message,
      context: contextText,
      history: history?.slice(-6),
      timestamp: Date.now()
    }, null, 2));
    const responseFile = path4.join(outDir, "chat-response.json");
    try {
      fs2.unlinkSync(responseFile);
    } catch (_) {
    }
    const startTime = Date.now();
    const poll = setInterval(() => {
      try {
        if (fs2.existsSync(responseFile)) {
          const data = JSON.parse(fs2.readFileSync(responseFile, "utf-8"));
          if (data.timestamp > startTime) {
            clearInterval(poll);
            webview.postMessage({ type: "chatResponse", text: data.text, originalMessage: message });
            try {
              fs2.unlinkSync(responseFile);
            } catch (_) {
            }
          }
        }
      } catch (_) {
      }
      if (Date.now() - startTime > 6e4) {
        clearInterval(poll);
        webview.postMessage({
          type: "chatResponse",
          error: "No LLM available. Use Claude Code to answer: the question is saved in .codesight/chat-request.json",
          originalMessage: message
        });
      }
    }, 500);
  } else {
    webview.postMessage({
      type: "chatResponse",
      error: "No language model available and no workspace folder open.",
      originalMessage: message
    });
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
