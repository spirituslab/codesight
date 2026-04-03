// Guided tour generation — DFS from entry points through call graph + LLM narration

/**
 * Generate guided tours from call graph and entry points.
 * Returns tours array for the output data.
 */
export async function generateTours(result, client) {
  const { modules, rootFiles, callGraph, keyFiles } = result;
  if (!callGraph?.edges?.length) return [];

  const allFiles = [...(rootFiles || []), ...modules.flatMap(m => m.files)];

  // Build adjacency list from call graph
  const adj = new Map(); // "file::sym" → [{ target, line }]
  for (const edge of callGraph.edges) {
    if (!adj.has(edge.source)) adj.set(edge.source, []);
    adj.get(edge.source).push({ target: edge.target, line: edge.line });
  }

  // Find good starting points for tours
  const startPoints = findTourStartPoints(allFiles, keyFiles, callGraph);

  // Generate raw tour paths via DFS
  const rawTours = [];
  for (const start of startPoints.slice(0, 6)) {
    const path = buildTourPath(start, adj, allFiles);
    if (path.length >= 3) {
      rawTours.push({ start, path });
    }
  }

  if (rawTours.length === 0) return [];

  // Enhance with LLM if available
  if (client) {
    console.log(`  Generating ${rawTours.length} guided tours...`);
    const tours = [];

    // Architecture tour first
    const archTour = buildArchitectureTour(modules, result.edges, keyFiles, allFiles);
    if (archTour) {
      try {
        const enhanced = await enhanceArchTourWithLLM(archTour, result, client);
        tours.push(enhanced || archTour);
      } catch {
        tours.push(archTour);
      }
    }

    for (const raw of rawTours) {
      try {
        const tour = await enhanceTourWithLLM(raw, result, client);
        if (tour) tours.push(tour);
      } catch (err) {
        tours.push(buildBasicTour(raw, allFiles));
      }
    }
    return tours;
  }

  // Without LLM, return basic tours
  const basicTours = rawTours.map(raw => buildBasicTour(raw, allFiles));

  // Add architecture tour (no LLM needed)
  const archTour = buildArchitectureTour(modules, result.edges, keyFiles, allFiles);
  if (archTour) basicTours.unshift(archTour);

  return basicTours;
}

function findTourStartPoints(allFiles, keyFiles, callGraph) {
  const points = [];

  // Entry points first
  for (const file of allFiles) {
    if (!file.isEntryPoint) continue;
    for (const sym of file.symbols) {
      if (sym.kind === 'function' && sym.calls?.length > 0) {
        points.push({ file: file.path, symbol: sym.name, reason: 'entry point' });
      }
    }
  }

  // Key files with high call-out count
  const callOutCount = new Map();
  for (const edge of callGraph.edges) {
    const src = edge.source;
    callOutCount.set(src, (callOutCount.get(src) || 0) + 1);
  }

  // Symbols with most outgoing calls (orchestrators)
  const sorted = [...callOutCount.entries()].sort((a, b) => b[1] - a[1]);
  for (const [symId, count] of sorted.slice(0, 10)) {
    if (count < 3) break;
    const [filePath, symName] = symId.split('::');
    if (points.some(p => p.file === filePath && p.symbol === symName)) continue;
    points.push({ file: filePath, symbol: symName, reason: `${count} calls (orchestrator)` });
  }

  // Key files — most imported
  for (const kf of (keyFiles || []).slice(0, 5)) {
    const file = allFiles.find(f => f.path === kf.path);
    if (!file) continue;
    const mainSym = file.symbols.find(s => s.exported && s.kind === 'function' && s.calls?.length > 0);
    if (mainSym && !points.some(p => p.file === file.path && p.symbol === mainSym.name)) {
      points.push({ file: file.path, symbol: mainSym.name, reason: 'key file' });
    }
  }

  return points;
}

function buildTourPath(start, adj, allFiles, maxDepth = 8) {
  const startId = `${start.file}::${start.symbol}`;
  const path = [];
  const visited = new Set();

  function dfs(nodeId, depth) {
    if (depth > maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);

    const [filePath, symName] = nodeId.split('::');
    const file = allFiles.find(f => f.path === filePath || f.path.replace(/\.[^.]+$/, '') === filePath);
    const sym = file?.symbols.find(s => s.name === symName);

    path.push({
      file: file?.path || filePath,
      symbol: symName,
      kind: sym?.kind || 'unknown',
      line: sym?.line || 0,
      signature: sym?.signature || '',
      comment: sym?.comment || '',
      source: sym?.source?.slice(0, 500) || '',
      callCount: sym?.calls?.length || 0,
    });

    // Follow calls, prioritize non-utility functions
    const edges = adj.get(nodeId) || [];
    const sorted = edges
      .filter(e => !visited.has(e.target))
      .sort((a, b) => {
        // Prefer calls to different files (more interesting in a tour)
        const aFile = a.target.split('::')[0];
        const bFile = b.target.split('::')[0];
        if (aFile !== filePath && bFile === filePath) return -1;
        if (bFile !== filePath && aFile === filePath) return 1;
        return 0;
      });

    // Follow the most interesting path (first 2 branches)
    for (const edge of sorted.slice(0, 2)) {
      dfs(edge.target, depth + 1);
    }
  }

  dfs(startId, 0);
  return path;
}

function buildBasicTour(raw, allFiles) {
  const startSym = raw.path[0];
  return {
    id: `tour:${startSym.symbol}`,
    title: `${startSym.symbol} flow`,
    description: `Follow the call chain starting from ${startSym.symbol} in ${startSym.file}`,
    steps: raw.path.map((step, i) => ({
      file: step.file,
      symbol: step.symbol,
      kind: step.kind,
      line: step.line,
      explanation: step.comment || `Step ${i + 1}: ${step.symbol}`,
      callsNext: raw.path[i + 1]?.symbol || null,
    })),
  };
}

async function enhanceTourWithLLM(raw, result, client) {
  const stepsContext = raw.path.map((step, i) => {
    let desc = `${i + 1}. ${step.kind} ${step.symbol} in ${step.file} (line ${step.line})`;
    if (step.signature) desc += `\n   Signature: ${step.signature.slice(0, 150)}`;
    if (step.comment) desc += `\n   Comment: ${step.comment.slice(0, 150)}`;
    if (step.source) desc += `\n   Source:\n${step.source.slice(0, 300)}`;
    return desc;
  }).join('\n\n');

  const prompt = [
    {
      role: 'system',
      content: 'You are a code documentation expert. Generate a guided tour explanation for a sequence of function calls. Be concise and factual. Only describe what is present in the code.',
    },
    {
      role: 'user',
      content: `Generate a guided reading tour for this call chain in the "${result.projectName}" project:

${stepsContext}

Respond in JSON:
{
  "title": "Short descriptive title (5-8 words)",
  "description": "1-2 sentence overview of what this flow does",
  "steps": [
    { "explanation": "1-2 sentences: what this function does and WHY it calls the next step" }
  ]
}

The steps array must have exactly ${raw.path.length} entries, one per step above. Focus on transitions — explain why each function delegates to the next.`,
    },
  ];

  const response = await client.complete(prompt);
  const parsed = parseJSON(response);
  if (!parsed || !parsed.steps || parsed.steps.length !== raw.path.length) {
    return buildBasicTour(raw, []);
  }

  return {
    id: `tour:${raw.path[0].symbol}`,
    title: parsed.title || `${raw.path[0].symbol} flow`,
    description: parsed.description || '',
    steps: raw.path.map((step, i) => ({
      file: step.file,
      symbol: step.symbol,
      kind: step.kind,
      line: step.line,
      explanation: parsed.steps[i]?.explanation || step.comment || `Step ${i + 1}`,
      callsNext: raw.path[i + 1]?.symbol || null,
    })),
  };
}

/**
 * Build an architecture tour that walks through project modules.
 * Steps: entry point → core modules → utility modules, following dependency edges.
 */
function buildArchitectureTour(modules, edges, keyFiles, allFiles) {
  if (modules.length < 2) return null;

  const steps = [];
  const visited = new Set();

  // Start with modules that have entry points, or the most-depended-on modules
  const entryModules = modules.filter(m => m.files.some(f => f.isEntryPoint));
  let startModules;
  if (entryModules.length > 0) {
    startModules = entryModules;
  } else {
    // Pick modules with the most incoming edges (core modules)
    const incomingWeight = new Map();
    for (const e of edges) {
      const mod = modules.find(m => m.name === e.target);
      if (mod) incomingWeight.set(e.target, (incomingWeight.get(e.target) || 0) + e.weight);
    }
    const sorted = modules.slice().sort((a, b) => (incomingWeight.get(b.name) || 0) - (incomingWeight.get(a.name) || 0));
    startModules = [sorted[0]];
  }

  // BFS through module dependencies
  const queue = [...startModules.map(m => m.name)];
  while (queue.length > 0 && steps.length < 12) {
    const modName = queue.shift();
    if (visited.has(modName)) continue;
    visited.add(modName);

    const mod = modules.find(m => m.name === modName);
    if (!mod) continue;

    // Pick the most important file in this module
    const representativeFile = mod.files.find(f => f.isEntryPoint)
      || mod.files.find(f => f.importedByCount > 0)
      || mod.files[0];

    const mainSymbol = representativeFile?.symbols.find(s => s.exported && (s.kind === 'function' || s.kind === 'class'))
      || representativeFile?.symbols[0];

    steps.push({
      file: representativeFile?.path || mod.path || mod.name,
      symbol: mainSymbol?.name || mod.name,
      kind: 'module',
      line: mainSymbol?.line || 0,
      explanation: mod.explanation || `${mod.name}: ${mod.description}`,
      callsNext: null,
    });

    // Queue connected modules (both directions for broader coverage)
    const outgoing = edges.filter(e => e.source === modName).sort((a, b) => b.weight - a.weight);
    const incoming = edges.filter(e => e.target === modName).sort((a, b) => b.weight - a.weight);
    for (const edge of outgoing) {
      if (!visited.has(edge.target)) queue.push(edge.target);
    }
    for (const edge of incoming) {
      if (!visited.has(edge.source)) queue.push(edge.source);
    }
  }

  if (steps.length < 2) return null;

  return {
    id: 'tour:architecture',
    title: 'Architecture Overview',
    description: `Walk through the ${steps.length} main modules and how they connect`,
    steps,
  };
}

async function enhanceArchTourWithLLM(tour, result, client) {
  const stepsContext = tour.steps.map((step, i) => {
    const mod = result.modules.find(m => m.files.some(f => f.path === step.file));
    return `${i + 1}. Module "${mod?.name || step.symbol}" (${mod?.fileCount || '?'} files, ${mod?.lineCount || '?'} lines)\n   Key file: ${step.file}\n   Description: ${step.explanation}`;
  }).join('\n\n');

  const edgesSummary = result.edges.slice(0, 20).map(e => `  ${e.source} → ${e.target} (${e.weight} imports)`).join('\n');

  const prompt = [
    {
      role: 'system',
      content: 'You are a software architect giving a guided tour of a codebase. Write clear, engaging explanations that help a new developer understand the architecture.',
    },
    {
      role: 'user',
      content: `Write an architecture tour for the "${result.projectName}" project.

Modules in tour order:
${stepsContext}

Module dependencies:
${edgesSummary}

Respond in JSON:
{
  "title": "Short descriptive title (5-8 words)",
  "description": "2-3 sentence overview of the project architecture",
  "steps": [
    { "explanation": "1-2 sentences: what this module does, why it matters, and how it connects to the next" }
  ]
}

The steps array must have exactly ${tour.steps.length} entries. Focus on transitions — explain WHY control/data flows from one module to the next.`,
    },
  ];

  const response = await client.complete(prompt);
  const parsed = parseJSON(response);
  if (!parsed?.steps || parsed.steps.length !== tour.steps.length) return null;

  return {
    ...tour,
    title: parsed.title || tour.title,
    description: parsed.description || tour.description,
    steps: tour.steps.map((step, i) => ({
      ...step,
      explanation: parsed.steps[i]?.explanation || step.explanation,
    })),
  };
}

function parseJSON(text) {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}
