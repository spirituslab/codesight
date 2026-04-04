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
import { resolve } from "path";
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
