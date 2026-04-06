#!/usr/bin/env node

/**
 * Codesight MCP Server
 *
 * Exposes code structure analysis as 6 focused MCP tools for Claude Code,
 * Claude Desktop, and any MCP-compatible client.
 *
 * Tools:
 *   1. codesight_explore    — structural navigation (project → module → file → symbol)
 *   2. codesight_impact     — "what breaks if I change X?"
 *   3. codesight_trace      — find call path between two symbols
 *   4. codesight_search     — search symbols by name/kind
 *   5. codesight_idea_layer — generate or set the idea structure overlay
 *   6. codesight_refresh    — re-run analysis
 *
 * Usage:
 *   node mcp-server.mjs [project-path]
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

/** Collect all files across modules and rootFiles. */
function getAllFiles(result) {
  return [...(result.rootFiles || []), ...result.modules.flatMap(m => m.files || [])];
}

/** Find a file by exact or suffix match. Returns { file, moduleName }. */
function findFile(result, filePath) {
  for (const mod of result.modules) {
    const file = (mod.files || []).find(f =>
      f.path === filePath || f.path.endsWith(filePath)
    );
    if (file) return { file, moduleName: mod.name };
  }
  const rootFile = (result.rootFiles || []).find(f =>
    f.path === filePath || f.path.endsWith(filePath)
  );
  if (rootFile) return { file: rootFile, moduleName: "root" };
  return null;
}

/** Find a symbol by file::symbol ref. Returns { file, symbol, moduleName }. */
function findSymbol(result, ref) {
  const sep = ref.indexOf("::");
  if (sep === -1) return null;
  const filePath = ref.substring(0, sep);
  const symName = ref.substring(sep + 2);
  const found = findFile(result, filePath);
  if (!found) return null;
  const sym = (found.file.symbols || []).find(s => s.name === symName);
  if (!sym) return null;
  return { file: found.file, symbol: sym, moduleName: found.moduleName };
}

/** Build adjacency list from callGraph edges for BFS. */
function buildAdjacency(edges) {
  const adj = new Map();
  for (const edge of edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source).push(edge.target);
  }
  return adj;
}

/** Build reverse adjacency (calledBy) from callGraph edges. */
function buildReverseAdjacency(edges) {
  const rev = new Map();
  for (const edge of edges) {
    if (!rev.has(edge.target)) rev.set(edge.target, []);
    rev.get(edge.target).push(edge.source);
  }
  return rev;
}

/** Find all call graph node IDs matching a flexible name query. */
function matchSymbolNodes(edges, name) {
  const nodeSet = new Set();
  for (const e of edges) {
    nodeSet.add(e.source);
    nodeSet.add(e.target);
  }
  // Exact match first
  if (nodeSet.has(name)) return [name];
  // file::symbol format — try suffix match on the file part
  const nameLower = name.toLowerCase();
  const matches = [];
  for (const id of nodeSet) {
    const sep = id.indexOf("::");
    if (sep === -1) continue;
    const symName = id.substring(sep + 2);
    if (symName.toLowerCase() === nameLower) {
      matches.push(id);
    } else if (id.toLowerCase().endsWith(nameLower)) {
      matches.push(id);
    }
  }
  return matches;
}

function jsonResponse(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({
  name: "codesight",
  version: "0.2.0",
});

// ─── Tool 1: codesight_explore ──────────────────────────────────

server.tool(
  "codesight_explore",
  `Structural navigation tool. Drill into the project at any level.
- No target: project overview (modules, languages, entry points, key files)
- Module name: that module's files, top exported symbols, dependencies
- File path: that file's symbols, imports, importers
- file::symbol: that symbol's full info, callers, callees`,
  {
    target: z.string().optional().describe("Module name, file path, or file::symbol ref. Omit for project overview."),
  },
  async ({ target }) => {
    const result = await getAnalysis();

    // ── No target → project overview ──
    if (!target) {
      const modules = result.modules.map(m => ({
        name: m.name,
        fileCount: m.files?.length || 0,
        lineCount: m.lineCount || 0,
      }));
      const entryPoints = (result.keyFiles || [])
        .filter(f => f.isEntryPoint)
        .slice(0, 10)
        .map(f => f.path);
      const keyFiles = (result.keyFiles || [])
        .sort((a, b) => (b.importedByCount || 0) - (a.importedByCount || 0))
        .slice(0, 10)
        .map(f => ({ path: f.path, importedByCount: f.importedByCount }));

      return jsonResponse({
        projectName: result.projectName,
        languages: result.languages,
        totalModules: modules.length,
        totalFiles: result.modules.reduce((s, m) => s + (m.files?.length || 0), 0),
        modules,
        entryPoints,
        keyFiles,
      });
    }

    // ── file::symbol → symbol detail ──
    if (target.includes("::")) {
      const found = findSymbol(result, target);
      if (!found) {
        return jsonResponse({ error: `Symbol "${target}" not found.` });
      }
      const { file, symbol: sym, moduleName } = found;
      const callGraph = result.callGraph || { edges: [] };
      const symId = `${file.path}::${sym.name}`;

      const callees = callGraph.edges
        .filter(e => e.source === symId)
        .map(e => ({ target: e.target, confidence: e.confidence }));
      const callers = callGraph.edges
        .filter(e => e.target === symId)
        .map(e => ({ source: e.source, confidence: e.confidence }));

      return jsonResponse({
        ref: symId,
        module: moduleName,
        name: sym.name,
        kind: sym.kind,
        exported: sym.exported,
        line: sym.line,
        signature: sym.signature || null,
        comment: sym.comment || null,
        callers,
        callees,
        impact: sym.impact || null,
      });
    }

    // ── Module name match ──
    const mod = result.modules.find(m =>
      m.name === target || m.name.toLowerCase() === target.toLowerCase()
    );
    if (mod) {
      const files = (mod.files || []).map(f => ({
        path: f.path,
        name: f.name,
        lineCount: f.lineCount || (f.symbols ? undefined : undefined),
      }));
      const exportedSymbols = [];
      for (const f of mod.files || []) {
        for (const s of f.symbols || []) {
          if (s.exported) {
            exportedSymbols.push({
              name: s.name,
              kind: s.kind,
              file: f.path,
              line: s.line,
              signature: s.signature,
            });
          }
        }
      }
      // Top 10 exported symbols by impact or alphabetical
      exportedSymbols.sort((a, b) => (b.impact?.directCallers || 0) - (a.impact?.directCallers || 0));
      const topExports = exportedSymbols.slice(0, 10);

      const depsFrom = result.edges.filter(e => e.source === mod.name && e.target !== 'external');
      const depsTo = result.edges.filter(e => e.target === mod.name);

      return jsonResponse({
        name: mod.name,
        path: mod.path,
        description: mod.description || "",
        lineCount: mod.lineCount || 0,
        fileCount: files.length,
        files,
        topExportedSymbols: topExports,
        dependsOn: depsFrom.map(e => ({ module: e.target, weight: e.weight })),
        dependedOnBy: depsTo.map(e => ({ module: e.source, weight: e.weight })),
      });
    }

    // ── File path match ──
    const fileMatch = findFile(result, target);
    if (fileMatch) {
      const { file, moduleName } = fileMatch;
      const impactMap = result.impactMap || {};
      const impact = impactMap[file.path];
      const importers = impact?.directDependents || [];

      return jsonResponse({
        path: file.path,
        name: file.name,
        module: moduleName,
        symbols: (file.symbols || []).map(s => ({
          name: s.name,
          kind: s.kind,
          exported: s.exported,
          line: s.line,
          signature: s.signature,
        })),
        imports: (file.imports || []).map(i => ({
          source: i.source,
          symbols: i.symbols,
          resolvedPath: i.resolvedPath,
          resolvedModule: i.resolvedModule,
        })),
        importedBy: importers,
      });
    }

    // ── Nothing matched ──
    const available = result.modules.map(m => m.name);
    return jsonResponse({
      error: `"${target}" did not match any module, file, or symbol.`,
      availableModules: available,
      hint: "Use a module name, file path, or file::symbolName format.",
    });
  }
);

// ─── Tool 2: codesight_impact ───────────────────────────────────

server.tool(
  "codesight_impact",
  `"What breaks if I change X?" Shows direct dependents, transitive dependents, risk level, and affected files.
Takes a file path or file::symbol reference.`,
  {
    target: z.string().describe("File path or file::symbol reference to analyze impact for"),
  },
  async ({ target }) => {
    const result = await getAnalysis();
    const impactMap = result.impactMap || {};
    const callGraph = result.callGraph || { edges: [] };

    // ── Symbol-level impact ──
    if (target.includes("::")) {
      const found = findSymbol(result, target);
      if (!found) {
        return jsonResponse({ error: `Symbol "${target}" not found.` });
      }
      const { file, symbol: sym } = found;
      const symId = `${file.path}::${sym.name}`;

      // BFS through reverse call graph
      const rev = buildReverseAdjacency(callGraph.edges);
      const visited = new Set();
      const queue = [{ id: symId, depth: 0 }];
      const callerChain = [];
      const impactedFiles = new Set();

      while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        if (id !== symId) {
          callerChain.push({ ref: id, depth });
          const sep = id.indexOf("::");
          if (sep !== -1) impactedFiles.add(id.substring(0, sep));
        }
        if (depth < 10) {
          const callers = rev.get(id) || [];
          for (const c of callers) {
            if (!visited.has(c)) queue.push({ id: c, depth: depth + 1 });
          }
        }
      }

      return jsonResponse({
        target: symId,
        kind: sym.kind,
        directCallers: callerChain.filter(c => c.depth === 1).map(c => c.ref),
        transitiveCallerCount: callerChain.length,
        impactedFiles: [...impactedFiles],
        impactedFileCount: impactedFiles.size,
        riskLevel: sym.impact?.riskLevel || (callerChain.length > 10 ? 'high' : callerChain.length > 3 ? 'medium' : 'low'),
        callerChain: callerChain.slice(0, 30),
      });
    }

    // ── File-level impact ──
    let impact = impactMap[target];
    if (!impact) {
      const key = Object.keys(impactMap).find(k =>
        k.endsWith(target) || k.includes(target)
      );
      if (key) impact = impactMap[key];
    }

    if (!impact) {
      return jsonResponse({
        target,
        directDependents: [],
        transitiveDependents: [],
        riskLevel: "none",
        message: "No dependents found. This file may not be imported by anything.",
      });
    }

    return jsonResponse({
      target,
      directDependents: impact.directDependents || [],
      directCount: (impact.directDependents || []).length,
      transitiveDependents: impact.transitiveDependents || [],
      transitiveCount: (impact.transitiveDependents || []).length,
      riskLevel: impact.riskLevel || 'low',
    });
  }
);

// ─── Tool 3: codesight_trace ────────────────────────────────────

server.tool(
  "codesight_trace",
  `Find a call path between two symbols via BFS through the call graph.
Accepts symbol names or file::symbol refs. Caps at 10 hops.
If no path is found, shows what the source symbol calls directly.`,
  {
    from: z.string().describe("Source symbol name or file::symbol ref"),
    to: z.string().describe("Target symbol name or file::symbol ref"),
  },
  async ({ from, to }) => {
    const result = await getAnalysis();
    const callGraph = result.callGraph || { edges: [] };
    const edges = callGraph.edges || [];

    if (edges.length === 0) {
      return jsonResponse({ error: "No call graph data available. Run codesight_refresh if the project has changed." });
    }

    const adj = buildAdjacency(edges);

    // Resolve flexible names to node IDs
    const fromNodes = matchSymbolNodes(edges, from);
    const toNodes = matchSymbolNodes(edges, to);

    if (fromNodes.length === 0) {
      return jsonResponse({
        error: `Could not find "${from}" in the call graph.`,
        hint: "Try a function name or file::symbol format.",
      });
    }
    if (toNodes.length === 0) {
      return jsonResponse({
        error: `Could not find "${to}" in the call graph.`,
        hint: "Try a function name or file::symbol format.",
      });
    }

    const toSet = new Set(toNodes);

    // BFS from all fromNodes
    let foundPath = null;
    const visited = new Map(); // node → parent
    const queue = [];

    for (const start of fromNodes) {
      visited.set(start, null);
      queue.push({ node: start, depth: 0 });
    }

    while (queue.length > 0) {
      const { node, depth } = queue.shift();
      if (toSet.has(node) && !fromNodes.includes(node)) {
        // Reconstruct path
        const path = [];
        let cur = node;
        while (cur !== null) {
          path.unshift(cur);
          cur = visited.get(cur);
        }
        foundPath = path;
        break;
      }
      if (depth >= 10) continue;
      const neighbors = adj.get(node) || [];
      for (const next of neighbors) {
        if (!visited.has(next)) {
          visited.set(next, node);
          queue.push({ node: next, depth: depth + 1 });
        }
      }
    }

    if (foundPath) {
      return jsonResponse({
        found: true,
        hops: foundPath.length - 1,
        path: foundPath,
        from: foundPath[0],
        to: foundPath[foundPath.length - 1],
      });
    }

    // No path — show what from calls directly
    const directCallees = [];
    for (const start of fromNodes) {
      const neighbors = adj.get(start) || [];
      directCallees.push({ source: start, calls: neighbors.slice(0, 10) });
    }

    return jsonResponse({
      found: false,
      message: `No call path found from "${from}" to "${to}" within 10 hops.`,
      fromResolved: fromNodes,
      toResolved: toNodes,
      directCallsFromSource: directCallees,
    });
  }
);

// ─── Tool 4: codesight_search ───────────────────────────────────

server.tool(
  "codesight_search",
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

    return jsonResponse({
      query,
      kind: kind || "any",
      matchCount: matches.length,
      matches: matches.slice(0, 50),
    });
  }
);

// ─── Tool 5: codesight_idea_layer ───────────────────────────────

server.tool(
  "codesight_idea_layer",
  `Manage the conceptual "idea layer" overlay for the project graph.
- No ideaStructure: returns project data as a prompt for you to generate the idea JSON, then call this tool again with the result.
- With ideaStructure: validates and writes the idea structure to .codesight/idea-structure.json for the VS Code extension.`,
  {
    ideaStructure: z.string().optional().describe("The idea structure JSON string. Omit to get the generation prompt."),
  },
  async ({ ideaStructure }) => {
    const result = await getAnalysis();

    // ── No ideaStructure → return generation prompt ──
    if (!ideaStructure) {
      const modulesSummary = result.modules.map(m => {
        const desc = m.explanation || m.description || '';
        const files = (m.files || []).slice(0, 8).map(f => `    ${f.path}`).join('\n');
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
      const validFiles = result.modules.flatMap(m => (m.files || []).map(f => f.path));

      return {
        content: [{
          type: "text",
          text: `Create an idea structure for this project. After generating it, call codesight_idea_layer again with the ideaStructure parameter set to the JSON string.

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

Generate a JSON object with this shape:
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

    // ── With ideaStructure → validate and write ──
    try {
      const parsed = JSON.parse(ideaStructure);

      if (!parsed.nodes || !Array.isArray(parsed.nodes)) {
        return jsonResponse({ error: "ideaStructure must contain a 'nodes' array." });
      }

      // Validate code references
      const validModules = new Set(result.modules.map(m => m.name));
      const validFiles = new Set(result.modules.flatMap(m => (m.files || []).map(f => f.path)));

      let removedRefs = 0;
      let totalRefs = 0;

      for (const node of parsed.nodes) {
        if (node.codeRefs) {
          totalRefs += node.codeRefs.length;
          node.codeRefs = node.codeRefs.filter(ref => {
            if (ref.type === 'module' && validModules.has(ref.name)) return true;
            if (ref.type === 'file' && validFiles.has(ref.path)) return true;
            if (ref.type === 'symbol') return true;
            removedRefs++;
            return false;
          });
        }
      }

      // Validate edges reference existing node IDs
      const nodeIds = new Set(parsed.nodes.map(n => n.id));
      let removedEdges = 0;
      if (parsed.edges) {
        const originalCount = parsed.edges.length;
        parsed.edges = parsed.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
        removedEdges = originalCount - parsed.edges.length;
      }

      // Write to .codesight/idea-structure.json
      const outDir = join(projectRoot, '.codesight');
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, 'idea-structure.json');
      writeFileSync(outPath, JSON.stringify(parsed, null, 2));

      const warnings = [];
      if (removedRefs > 0) warnings.push(`removed ${removedRefs}/${totalRefs} invalid code references`);
      if (removedEdges > 0) warnings.push(`removed ${removedEdges} edges with invalid node IDs`);

      return jsonResponse({
        success: true,
        nodeCount: parsed.nodes.length,
        edgeCount: parsed.edges?.length || 0,
        path: outPath,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    } catch (err) {
      return jsonResponse({ error: `Failed to parse idea structure: ${err.message}` });
    }
  }
);

// ─── Tool 6: codesight_circular_deps ────────────────────────────

server.tool(
  "codesight_circular_deps",
  "Find circular dependencies between modules. Returns cycle chains with paths and weights.",
  {},
  async () => {
    const result = await getAnalysis();
    const cd = result.circularDeps || { cycles: [], hasCycles: false };
    return jsonResponse({
      hasCycles: cd.hasCycles,
      cycleCount: cd.cycles.length,
      cycles: cd.cycles.map(c => ({
        path: c.path,
        totalWeight: c.totalWeight,
        description: c.path.join(' → '),
      })),
    });
  }
);

// ─── Tool 7: codesight_dead_code ────────────────────────────────

server.tool(
  "codesight_dead_code",
  "Identify potentially dead code — exported symbols never imported or called, unused files, and isolated modules.",
  {},
  async () => {
    const result = await getAnalysis();
    const dc = result.deadCode || { deadSymbols: [], deadFiles: [], deadModules: [], stats: {} };
    return jsonResponse({
      stats: dc.stats,
      deadSymbols: dc.deadSymbols.slice(0, 50),
      deadFiles: dc.deadFiles,
      deadModules: dc.deadModules,
    });
  }
);

// ─── Tool 8: codesight_refresh ──────────────────────────────────

server.tool(
  "codesight_refresh",
  "Re-run the analysis to pick up recent file changes. Invalidates cached results.",
  {},
  async () => {
    const result = await refreshAnalysis();
    return jsonResponse({
      refreshed: true,
      projectName: result.projectName,
      modules: result.modules.length,
      languages: result.languages,
      totalFiles: result.modules.reduce((s, m) => s + (m.files?.length || 0), 0),
      callGraphEdges: result.callGraph?.edges?.length || 0,
    });
  }
);

// ─── Start ───────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
