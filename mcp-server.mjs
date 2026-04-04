#!/usr/bin/env node

/**
 * Codesight MCP Server
 *
 * Exposes code structure analysis as MCP tools for Claude Code,
 * Claude Desktop, and any MCP-compatible client.
 *
 * Usage:
 *   node mcp-server.mjs [project-path]
 *
 * If project-path is omitted, uses the current working directory.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve, join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { analyze } from "./src/analyzer/index.mjs";

const projectRoot = resolve(process.argv[2] || process.cwd());
let analysisResult = null;

async function getAnalysis() {
  if (!analysisResult) {
    analysisResult = await analyze(projectRoot, { llm: false, cache: true });
  }
  return analysisResult;
}

async function refreshAnalysis() {
  analysisResult = await analyze(projectRoot, { llm: false, cache: true });
  return analysisResult;
}

const server = new McpServer({
  name: "codesight",
  version: "0.1.0",
});

// ─── Tool: list_modules ──────────────────────────────────────────

server.tool(
  "codesight_list_modules",
  "List all modules in the project with their files, symbols, and dependencies",
  {},
  async () => {
    const result = await getAnalysis();
    const modules = result.modules.map(m => ({
      name: m.name,
      path: m.path,
      description: m.description || "",
      fileCount: m.files?.length || 0,
      lineCount: m.lineCount || 0,
      symbols: (m.files || []).reduce((sum, f) => sum + (f.symbols?.length || 0), 0),
    }));

    const edges = result.edges.map(e => `${e.source} → ${e.target} (weight: ${e.weight})`);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          projectName: result.projectName,
          languages: result.languages,
          totalModules: modules.length,
          modules,
          dependencies: edges,
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: get_module_detail ─────────────────────────────────────

server.tool(
  "codesight_get_module",
  "Get detailed information about a specific module including all files and exported symbols",
  {
    moduleName: z.string().describe("Name of the module to inspect"),
  },
  async ({ moduleName }) => {
    const result = await getAnalysis();
    const mod = result.modules.find(m =>
      m.name === moduleName || m.name.toLowerCase() === moduleName.toLowerCase()
    );

    if (!mod) {
      const available = result.modules.map(m => m.name).join(", ");
      return {
        content: [{
          type: "text",
          text: `Module "${moduleName}" not found. Available modules: ${available}`,
        }],
      };
    }

    const files = (mod.files || []).map(f => ({
      path: f.path,
      name: f.name,
      symbols: (f.symbols || []).map(s => ({
        name: s.name,
        kind: s.kind,
        exported: s.exported,
        line: s.line,
        signature: s.signature,
      })),
      importCount: f.imports?.length || 0,
    }));

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          name: mod.name,
          path: mod.path,
          description: mod.description || "",
          lineCount: mod.lineCount || 0,
          files,
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: impact_analysis ───────────────────────────────────────

server.tool(
  "codesight_impact_analysis",
  "Analyze what would be affected if a file or symbol is changed. Shows direct and transitive dependents.",
  {
    filePath: z.string().describe("Relative file path to analyze impact for"),
  },
  async ({ filePath }) => {
    const result = await getAnalysis();
    const impactMap = result.impactMap || {};

    // Try exact match, then partial match
    let impact = impactMap[filePath];
    if (!impact) {
      const key = Object.keys(impactMap).find(k =>
        k.endsWith(filePath) || k.includes(filePath)
      );
      if (key) impact = impactMap[key];
    }

    if (!impact) {
      return {
        content: [{
          type: "text",
          text: `No impact data found for "${filePath}". This file may not have any dependents.`,
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          file: filePath,
          directDependents: impact.directDependents || [],
          transitiveDependents: impact.transitiveDependents || [],
          riskScore: impact.riskScore || 0,
          directCount: impact.directDependents?.length || 0,
          transitiveCount: impact.transitiveDependents?.length || 0,
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: call_graph ────────────────────────────────────────────

server.tool(
  "codesight_call_graph",
  "Get the call graph showing which functions call which other functions. Optionally filter by a specific function name.",
  {
    functionName: z.string().optional().describe("Filter to calls involving this function (caller or callee). Omit for full graph."),
  },
  async ({ functionName }) => {
    const result = await getAnalysis();
    const callGraph = result.callGraph || { edges: [], stats: {} };
    let edges = callGraph.edges || [];

    if (functionName) {
      const name = functionName.toLowerCase();
      edges = edges.filter(e =>
        e.from?.toLowerCase().includes(name) ||
        e.to?.toLowerCase().includes(name)
      );
    }

    // Limit output to prevent overwhelming context
    const limited = edges.slice(0, 100);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          totalEdges: callGraph.edges?.length || 0,
          shownEdges: limited.length,
          stats: callGraph.stats,
          edges: limited.map(e => ({
            from: e.from,
            to: e.to,
            fromFile: e.fromFile,
            toFile: e.toFile,
            confidence: e.confidence,
          })),
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: explain_file ──────────────────────────────────────────

server.tool(
  "codesight_explain_file",
  "Get structural information about a specific file: its symbols, imports, dependencies, and which module it belongs to.",
  {
    filePath: z.string().describe("Relative file path to explain"),
  },
  async ({ filePath }) => {
    const result = await getAnalysis();

    let targetFile = null;
    let moduleName = null;

    for (const mod of result.modules) {
      const file = (mod.files || []).find(f =>
        f.path === filePath || f.path.endsWith(filePath)
      );
      if (file) {
        targetFile = file;
        moduleName = mod.name;
        break;
      }
    }

    if (!targetFile) {
      // Check root files
      const rootFile = result.rootFiles?.find(f =>
        f.path === filePath || f.path.endsWith(filePath)
      );
      if (rootFile) {
        targetFile = rootFile;
        moduleName = "root";
      }
    }

    if (!targetFile) {
      return {
        content: [{
          type: "text",
          text: `File "${filePath}" not found in analysis results.`,
        }],
      };
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          path: targetFile.path,
          name: targetFile.name,
          module: moduleName,
          symbols: (targetFile.symbols || []).map(s => ({
            name: s.name,
            kind: s.kind,
            exported: s.exported,
            line: s.line,
            signature: s.signature,
            comment: s.comment || "",
          })),
          imports: (targetFile.imports || []).map(i => ({
            source: i.source,
            symbols: i.symbols,
            resolvedPath: i.resolvedPath,
            resolvedModule: i.resolvedModule,
          })),
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: search_symbols ────────────────────────────────────────

server.tool(
  "codesight_search_symbols",
  "Search for symbols (functions, classes, methods, types) across the entire project by name pattern.",
  {
    query: z.string().describe("Search query — matches against symbol names (case-insensitive)"),
    kind: z.enum(["function", "class", "method", "interface", "type", "enum", "const", "any"]).optional().describe("Filter by symbol kind. Default: any"),
  },
  async ({ query, kind }) => {
    const result = await getAnalysis();
    const queryLower = query.toLowerCase();
    const matches = [];

    for (const mod of result.modules) {
      for (const file of mod.files || []) {
        for (const sym of file.symbols || []) {
          if (!sym.name.toLowerCase().includes(queryLower)) continue;
          if (kind && kind !== "any" && sym.kind !== kind) continue;
          matches.push({
            name: sym.name,
            kind: sym.kind,
            exported: sym.exported,
            file: file.path,
            module: mod.name,
            line: sym.line,
            signature: sym.signature,
          });
        }
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          query,
          kind: kind || "any",
          matchCount: matches.length,
          matches: matches.slice(0, 50),
        }, null, 2),
      }],
    };
  }
);

// ─── Tool: generate_idea_structure ────────────────────────────────

server.tool(
  "codesight_generate_idea_structure",
  `Generate a conceptual "idea layer" for the project. This returns the project's structural data formatted as a prompt. You (the LLM) should then create the idea structure JSON and call codesight_set_idea_layer to push it to the VS Code graph.

The idea structure is a conceptual map: nodes represent concepts/features/responsibilities, edges represent relationships between them, and codeRefs link each concept to the actual code that implements it.`,
  {},
  async () => {
    const result = await getAnalysis();

    const modulesSummary = result.modules.map(m => {
      const desc = m.explanation || m.description || '';
      const files = m.files.slice(0, 8).map(f => `    ${f.path}`).join('\n');
      return `  ${m.name} (${m.files.length} files, ${m.lineCount} lines): ${desc}\n${files}`;
    }).join('\n\n');

    const edgesSummary = result.edges
      .filter(e => e.target !== 'external')
      .slice(0, 30)
      .map(e => `  ${e.source} → ${e.target} (${e.weight} imports)`)
      .join('\n');

    const keyFilesSummary = (result.keyFiles || []).slice(0, 15).map(f =>
      `  ${f.path} (imported by ${f.importedByCount} files${f.isEntryPoint ? ', entry point' : ''})`
    ).join('\n');

    const validModules = result.modules.map(m => m.name);
    const validFiles = result.modules.flatMap(m => m.files.map(f => f.path));

    return {
      content: [{
        type: "text",
        text: `Create an idea structure for this project. After generating it, call codesight_set_idea_layer with the JSON.

Project: ${result.projectName}
Languages: ${result.languages.join(', ')}

Modules:
${modulesSummary}

Dependencies:
${edgesSummary}

Key files:
${keyFilesSummary}

VALID module names: ${JSON.stringify(validModules)}
VALID file paths (first 50): ${JSON.stringify(validFiles.slice(0, 50))}

Respond by calling codesight_set_idea_layer with a JSON object containing:
{
  "projectSummary": "2-3 sentence description",
  "nodes": [
    {
      "id": "idea:<kebab-case-id>",
      "label": "Human Readable Name",
      "description": "1-2 sentence description",
      "codeRefs": [
        { "type": "module", "name": "<module-name>" },
        { "type": "file", "path": "<file-path>" }
      ]
    }
  ],
  "edges": [
    { "source": "idea:<id>", "target": "idea:<id>", "label": "relationship" }
  ]
}

Create 5-15 idea nodes. Only use module names and file paths from the lists above. Keep it conceptual — group by purpose, not file structure.`,
      }],
    };
  }
);

// ─── Tool: set_idea_layer ────────────────────────────────────────

server.tool(
  "codesight_set_idea_layer",
  "Push an idea structure to the VS Code graph visualization. The idea structure JSON will be written to .codesight/idea-structure.json, and the VS Code extension will pick it up and render the idea layer overlay.",
  {
    ideaStructure: z.string().describe("The idea structure JSON string containing projectSummary, nodes (with id, label, description, codeRefs), and edges"),
  },
  async ({ ideaStructure }) => {
    try {
      const parsed = JSON.parse(ideaStructure);

      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        return {
          content: [{ type: "text", text: "Error: ideaStructure must contain a 'nodes' array." }],
        };
      }

      // Validate code references
      const result = await getAnalysis();
      const validModules = new Set(result.modules.map(m => m.name));
      const validFiles = new Set(result.modules.flatMap(m => m.files.map(f => f.path)));

      let removedRefs = 0;
      let totalRefs = 0;

      for (const node of parsed.nodes) {
        if (node.codeRefs) {
          totalRefs += node.codeRefs.length;
          node.codeRefs = node.codeRefs.filter(ref => {
            if (ref.type === 'module' && validModules.has(ref.name)) return true;
            if (ref.type === 'file' && validFiles.has(ref.path)) return true;
            if (ref.type === 'symbol') return true; // trust symbol refs
            removedRefs++;
            return false;
          });
        }
      }

      // Validate edges
      const nodeIds = new Set(parsed.nodes.map(n => n.id));
      if (parsed.edges) {
        parsed.edges = parsed.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
      }

      // Write to .codesight/idea-structure.json
      const outDir = join(projectRoot, '.codesight');
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, 'idea-structure.json');
      writeFileSync(outPath, JSON.stringify(parsed, null, 2));

      const refInfo = removedRefs > 0
        ? ` (removed ${removedRefs}/${totalRefs} invalid code references)`
        : '';

      return {
        content: [{
          type: "text",
          text: `Idea layer saved with ${parsed.nodes.length} concepts and ${parsed.edges?.length || 0} relationships${refInfo}. The VS Code extension will pick it up and render the overlay.`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error parsing idea structure: ${err.message}` }],
      };
    }
  }
);

// ─── Tool: refresh ───────────────────────────────────────────────

server.tool(
  "codesight_refresh",
  "Re-run the analysis to pick up recent file changes.",
  {},
  async () => {
    const result = await refreshAnalysis();
    return {
      content: [{
        type: "text",
        text: `Analysis refreshed. Found ${result.modules.length} modules, ${result.languages.join(", ")} across ${result.modules.reduce((s, m) => s + (m.files?.length || 0), 0)} files.`,
      }],
    };
  }
);

// ─── Start ───────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
