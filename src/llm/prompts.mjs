// Prompt templates for LLM explanations and idea structure

/**
 * Build a prompt to explain a module and its files.
 */
export function buildModuleExplanationPrompt(mod, edges, extraContext = {}) {
  const { callGraph, impactMap } = extraContext;
  const incomingEdges = edges.filter(e => e.target === mod.name);
  const outgoingEdges = edges.filter(e => e.source === mod.name);

  const fileList = mod.files.map(f => {
    const syms = f.symbols
      .filter(s => s.exported)
      .slice(0, 15)
      .map(s => {
        let desc = `    - ${s.kind} ${s.name}${s.signature ? `: ${s.signature.slice(0, 120)}` : ''}`;
        if (s.calledBy?.length) desc += ` [called by ${s.calledBy.length} other functions]`;
        if (s.calls?.length) desc += ` [calls ${s.calls.length} functions]`;
        return desc;
      })
      .join('\n');
    const imps = f.imports
      .slice(0, 10)
      .map(i => `    - from ${i.source}${i.symbols.length ? ` (${i.symbols.join(', ')})` : ''}`)
      .join('\n');

    // Impact info
    let impactInfo = '';
    if (impactMap?.[f.path]) {
      const impact = impactMap[f.path];
      if (impact.riskLevel === 'high') {
        impactInfo = `\n    ⚠ HIGH IMPACT: ${impact.transitiveDependents} files depend on this transitively`;
      } else if (impact.riskLevel === 'medium') {
        impactInfo = `\n    Impact: ${impact.transitiveDependents} transitive dependents`;
      }
    }

    return `  ${f.path} (${f.language}, ${f.lineCount} lines)${impactInfo}${syms ? '\n    Exports:\n' + syms : ''}${imps ? '\n    Imports:\n' + imps : ''}`;
  }).join('\n\n');

  const depsIn = incomingEdges.map(e => `  ← ${e.source} (${e.weight} imports)`).join('\n') || '  (none)';
  const depsOut = outgoingEdges.map(e => `  → ${e.target} (${e.weight} imports)`).join('\n') || '  (none)';

  // Call flow summary for the module
  let callFlowSection = '';
  if (callGraph?.edges?.length) {
    const moduleFiles = new Set(mod.files.map(f => f.path));
    const inbound = callGraph.edges.filter(e => {
      const targetFile = e.target.split('::')[0];
      const sourceFile = e.source.split('::')[0];
      return moduleFiles.has(targetFile) && !moduleFiles.has(sourceFile);
    });
    const outbound = callGraph.edges.filter(e => {
      const sourceFile = e.source.split('::')[0];
      const targetFile = e.target.split('::')[0];
      return moduleFiles.has(sourceFile) && !moduleFiles.has(targetFile);
    });
    if (inbound.length > 0 || outbound.length > 0) {
      callFlowSection = `\nCall flow:
  Inbound calls (other modules → this module): ${inbound.length}
  Outbound calls (this module → other modules): ${outbound.length}`;
      if (inbound.length > 0) {
        const topInbound = inbound.slice(0, 5).map(e => `  ${e.source} → ${e.target}`).join('\n');
        callFlowSection += `\n  Top inbound:\n${topInbound}`;
      }
    }
  }

  return [
    {
      role: 'system',
      content: `You are a code documentation expert. You explain code structure clearly and concisely. Only describe what is present in the provided data. Do not invent files, functions, or structures that are not listed. Be factual and precise.`
    },
    {
      role: 'user',
      content: `Analyze this module and provide explanations.

Module: "${mod.name}" (${mod.fileCount} files, ${mod.lineCount} lines)
Languages: ${mod.languages.join(', ')}

Files:
${fileList}

Dependencies from other modules:
${depsIn}

Dependencies to other modules:
${depsOut}
${callFlowSection}

Respond in JSON format:
{
  "moduleExplanation": "1-2 sentence summary of what this module does and its role in the project",
  "files": {
    "<file_path>": "1 sentence summary of what this file does"
  }
}

Only include files listed above. Keep explanations concise and factual.`
    }
  ];
}

/**
 * Build a prompt to generate an overall architecture description.
 */
export function buildArchitecturePrompt(projectData) {
  const { projectName, modules, edges, keyFiles, callGraph, impactMap, languages } = projectData;

  const modulesSummary = modules.map(m => {
    const desc = m.explanation || m.description;
    const impact = m.files.filter(f => impactMap?.[f.path]?.riskLevel === 'high').length;
    let line = `  ${m.name} (${m.fileCount} files, ${m.lineCount} lines): ${desc}`;
    if (impact > 0) line += ` [${impact} high-impact files]`;
    return line;
  }).join('\n');

  const edgesSummary = edges
    .filter(e => e.target !== 'external')
    .slice(0, 30)
    .map(e => `  ${e.source} → ${e.target} (${e.weight} imports)`)
    .join('\n');

  const keyFilesSummary = keyFiles.slice(0, 15).map(f => {
    const impact = impactMap?.[f.path];
    let line = `  ${f.path} (imported by ${f.importedByCount} files${f.isEntryPoint ? ', entry point' : ''})`;
    if (impact?.riskLevel === 'high') line += ` [HIGH RISK: ${impact.transitiveDependents} transitive deps]`;
    return line;
  }).join('\n');

  let callStats = '';
  if (callGraph?.stats) {
    callStats = `\nCall graph: ${callGraph.stats.totalCalls} calls, ${callGraph.stats.uniqueCallers} unique callers, ${callGraph.stats.uniqueCallees} unique callees`;
    if (callGraph.stats.ambiguous > 0) callStats += `, ${callGraph.stats.ambiguous} ambiguous`;
  }

  return [
    {
      role: 'system',
      content: `You are a senior software architect. You write concise, insightful architecture descriptions that help developers understand a codebase quickly. Focus on data flow, key abstractions, and design decisions — not just listing files.`
    },
    {
      role: 'user',
      content: `Write an architecture overview for this project.

Project: ${projectName}
Languages: ${languages.join(', ')}
${callStats}

Modules:
${modulesSummary}

Module dependencies:
${edgesSummary}

Key files:
${keyFilesSummary}

Respond in JSON format:
{
  "overview": "3-5 sentence high-level architecture description covering what the system does and how it's organized",
  "dataFlow": "2-3 sentences describing how data flows through the system from entry points to outputs",
  "keyDecisions": ["1 sentence each describing notable architecture/design decisions"],
  "riskAreas": ["1 sentence each identifying areas with high coupling or complexity"]
}

Be factual — only reference modules and files that exist in the data above.`
    }
  ];
}

/**
 * Build a prompt to explain key symbols.
 */
export function buildSymbolExplanationPrompt(symbols) {
  const symList = symbols.map(s => {
    let desc = `- ${s.kind} ${s.name} in ${s._filePath} (line ${s.line})`;
    if (s.signature) desc += `\n  Signature: ${s.signature.slice(0, 200)}`;
    if (s.comment) desc += `\n  Comment: ${s.comment.slice(0, 200)}`;
    if (s.source) desc += `\n  Source:\n${s.source.slice(0, 500)}`;
    if (s.usedBy?.length) desc += `\n  Used by: ${s.usedBy.slice(0, 5).join(', ')}${s.usedBy.length > 5 ? ` (+${s.usedBy.length - 5} more)` : ''}`;
    return desc;
  }).join('\n\n');

  return [
    {
      role: 'system',
      content: `You are a code documentation expert. Explain what each symbol does based on its source code, signature, and context. Be concise and factual. Do not invent behavior not evident from the code.`
    },
    {
      role: 'user',
      content: `Explain these key symbols:

${symList}

Respond in JSON format:
{
  "<filePath>::<symbolName>": "1 sentence explanation of what this symbol does"
}

Keep explanations concise.`
    }
  ];
}

/**
 * Build a prompt to generate the idea structure (conceptual map).
 */
export function buildIdeaStructurePrompt(projectData) {
  const { projectName, modules, edges, keyFiles, languages } = projectData;

  const modulesSummary = modules.map(m => {
    const desc = m.explanation || m.description;
    const files = m.files.slice(0, 8).map(f =>
      `    ${f.path}${f.explanation ? ': ' + f.explanation : ''}`
    ).join('\n');
    return `  ${m.name} (${m.fileCount} files, ${m.lineCount} lines): ${desc}\n${files}`;
  }).join('\n\n');

  const edgesSummary = edges
    .filter(e => e.target !== 'external')
    .slice(0, 30)
    .map(e => `  ${e.source} → ${e.target} (${e.weight} imports)`)
    .join('\n');

  const keyFilesSummary = keyFiles.slice(0, 15).map(f =>
    `  ${f.path} (imported by ${f.importedByCount} files${f.isEntryPoint ? ', entry point' : ''})`
  ).join('\n');

  // Build valid code ref targets for the LLM
  const validModules = modules.map(m => m.name);
  const validFiles = modules.flatMap(m => m.files.map(f => f.path));
  const validSymbols = modules.flatMap(m =>
    m.files.flatMap(f =>
      f.symbols.filter(s => s.exported).map(s => `${f.path}::${s.name}`)
    )
  );

  return [
    {
      role: 'system',
      content: `You are a software architect who explains projects conceptually. Your job is to create an "idea structure" — a conceptual map of what a project does, organized by concepts and purposes rather than file paths.

Each idea node represents a concept, feature, or responsibility. Map each idea to actual code (modules, files, symbols) that implements it.

IMPORTANT:
- Only reference code that exists in the provided data
- Valid module names: ${JSON.stringify(validModules)}
- Create 5-15 idea nodes depending on project complexity
- Create edges between ideas that have relationships (e.g., "feeds into", "depends on", "protects")
- All ideas should be at the same level — no parent-child nesting, no hierarchy
- The idea structure should help someone understand WHAT the project does before HOW it's implemented`
    },
    {
      role: 'user',
      content: `Create an idea structure for this project.

Project: ${projectName}
Languages: ${languages.join(', ')}

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

Only use module names and file paths from the data above. Keep it conceptual — group by purpose, not by file structure.`
    }
  ];
}

/**
 * Build a prompt for the chat interface.
 */
export function buildChatPrompt(message, context, analysisData) {
  const { currentLevel, currentModule, currentFile, currentSymbol } = context;

  // Build a focused context based on what the user is looking at
  let codeContext = '';

  if (currentFile && analysisData) {
    const file = findFile(analysisData, currentFile);
    if (file) {
      const syms = file.symbols.map(s =>
        `  ${s.exported ? 'export ' : ''}${s.kind} ${s.name}${s.signature ? ': ' + s.signature.slice(0, 150) : ''}`
      ).join('\n');
      const imps = file.imports.map(i =>
        `  from ${i.source} (${i.symbols.join(', ') || 'side-effect'})`
      ).join('\n');
      codeContext = `\nCurrently viewing file: ${file.path} (${file.language}, ${file.lineCount} lines)
${file.explanation ? 'Description: ' + file.explanation : ''}
Exports:\n${syms || '  (none)'}
Imports:\n${imps || '  (none)'}`;

      if (currentSymbol) {
        const sym = file.symbols.find(s => s.name === currentSymbol);
        if (sym) {
          codeContext += `\n\nFocused symbol: ${sym.kind} ${sym.name}`;
          if (sym.signature) codeContext += `\nSignature: ${sym.signature}`;
          if (sym.comment) codeContext += `\nComment: ${sym.comment}`;
          if (sym.source) codeContext += `\nSource:\n${sym.source.slice(0, 1000)}`;
          if (sym.usedBy?.length) codeContext += `\nUsed by: ${sym.usedBy.join(', ')}`;
          if (sym.calls?.length) {
            codeContext += `\nCalls: ${sym.calls.map(c => `${c.name} (${c.resolvedFile || 'same file'})`).join(', ')}`;
          }
          if (sym.calledBy?.length) {
            codeContext += `\nCalled by: ${sym.calledBy.map(c => `${c.symbol} in ${c.file}`).join(', ')}`;
          }
          // Impact info
          const impact = analysisData.impactMap?.[file.path];
          if (impact) {
            codeContext += `\nImpact: ${impact.directDependents} direct dependents, ${impact.transitiveDependents} transitive (risk: ${impact.riskLevel})`;
          }
        }
      }
    }
  } else if (currentModule && analysisData) {
    const mod = analysisData.modules.find(m => m.name === currentModule);
    if (mod) {
      const files = mod.files.slice(0, 20).map(f =>
        `  ${f.path} (${f.lineCount} lines)${f.explanation ? ' — ' + f.explanation : ''}`
      ).join('\n');
      codeContext = `\nCurrently viewing module: ${mod.name} (${mod.fileCount} files, ${mod.lineCount} lines)
${mod.explanation ? 'Description: ' + mod.explanation : ''}
Files:\n${files}`;
    }
  }

  // Project overview
  let projectOverview = '';
  if (analysisData) {
    projectOverview = `Project: ${analysisData.projectName}
Languages: ${analysisData.languages.join(', ')}
Modules: ${analysisData.modules.map(m => `${m.name} (${m.fileCount} files)`).join(', ')}`;

    if (analysisData.architecture?.overview) {
      projectOverview += `\nArchitecture: ${analysisData.architecture.overview}`;
      if (analysisData.architecture.dataFlow) {
        projectOverview += `\nData flow: ${analysisData.architecture.dataFlow}`;
      }
    } else if (analysisData.ideaStructure?.projectSummary) {
      projectOverview += `\nProject summary: ${analysisData.ideaStructure.projectSummary}`;
    }
  }

  return [
    {
      role: 'system',
      content: `You are a helpful code assistant for the "${analysisData?.projectName || 'unknown'}" project. You help users understand the codebase by answering questions about its structure, modules, files, and symbols.

${projectOverview}
${codeContext}

Guidelines:
- Answer based on the code structure data provided. Be factual.
- If you don't have enough information to answer, say so.
- Reference specific files, modules, and symbols when relevant.
- Keep answers concise but thorough.
- Use markdown formatting for readability.`
    },
    {
      role: 'user',
      content: message
    }
  ];
}

function findFile(data, filePath) {
  for (const mod of data.modules) {
    const f = mod.files.find(f => f.path === filePath);
    if (f) return f;
  }
  return data.rootFiles?.find(f => f.path === filePath) || null;
}
