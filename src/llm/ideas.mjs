// Idea structure generator — conceptual map of the project

import { buildIdeaStructurePrompt } from './prompts.mjs';

/**
 * Generate an idea structure (conceptual map) from the analysis result.
 * Returns the ideaStructure object or null on failure.
 */
export async function generateIdeaStructure(result, client) {
  try {
    const prompt = buildIdeaStructurePrompt(result);
    const response = await client.complete(prompt, { maxTokens: 8192 });
    const parsed = parseJSON(response);

    if (!parsed || !parsed.nodes) {
      console.warn('  Warning: LLM returned invalid idea structure');
      return null;
    }

    // Validate and clean code references
    const { validated, removedRefs, totalRefs } = validateIdeaStructure(parsed, result);

    // Retry if too many refs were hallucinated (>40% removed)
    if (totalRefs > 0 && removedRefs / totalRefs > 0.4) {
      console.log(`  Retrying idea structure (${removedRefs}/${totalRefs} refs were invalid)...`);
      try {
        const retryPrompt = buildRetryPrompt(validated, result, removedRefs);
        const retryResponse = await client.complete(retryPrompt, { maxTokens: 8192 });
        const retryParsed = parseJSON(retryResponse);
        if (retryParsed?.nodes) {
          const retry = validateIdeaStructure(retryParsed, result);
          return addConfidenceWeights(retry.validated, result);
        }
      } catch {
        // Retry failed, use original
      }
    }

    return addConfidenceWeights(validated, result);
  } catch (err) {
    console.warn(`  Warning: Failed to generate idea structure: ${err.message}`);
    return null;
  }
}

/**
 * Build a retry prompt that tells the LLM which refs were invalid.
 */
function buildRetryPrompt(validated, result, removedCount) {
  const validModules = result.modules.map(m => m.name);
  const validFiles = result.modules.flatMap(m => m.files.map(f => f.path));

  return [
    {
      role: 'system',
      content: `You are a software architect. Your previous idea structure had ${removedCount} invalid code references that were removed. Please regenerate with ONLY valid references.

VALID module names: ${JSON.stringify(validModules)}
VALID file paths (first 50): ${JSON.stringify(validFiles.slice(0, 50))}

Only use module names and file paths from these lists.`,
    },
    {
      role: 'user',
      content: `Here is your previous idea structure with invalid refs stripped. Please regenerate it with corrected code references. Keep the same conceptual structure but fix the references.

${JSON.stringify(validated, null, 2)}

Respond in the same JSON format with nodes and edges.`,
    },
  ];
}

/**
 * Add confidence weights to code refs based on reference type.
 * symbol refs = highest, file refs = medium, module refs = base.
 */
function addConfidenceWeights(idea, result) {
  if (!idea?.nodes) return idea;

  // Build lookup for import counts to weight file refs
  const importCounts = new Map();
  for (const kf of (result.keyFiles || [])) {
    importCounts.set(kf.path, kf.importedByCount);
  }

  for (const node of idea.nodes) {
    if (!node.codeRefs) continue;
    for (const ref of node.codeRefs) {
      if (ref.type === 'symbol') {
        ref.confidence = 1.0;
      } else if (ref.type === 'file') {
        // Weight by importance (more-imported files = higher confidence)
        const imports = importCounts.get(ref.path) || 0;
        ref.confidence = 0.6 + Math.min(0.3, imports * 0.03);
      } else if (ref.type === 'module') {
        ref.confidence = 0.4;
      }
    }
    // Sort refs by confidence (highest first)
    node.codeRefs.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  }

  return idea;
}

/**
 * Validate idea structure: remove hallucinated code references,
 * ensure node IDs are consistent, etc.
 */
function validateIdeaStructure(idea, result) {
  const validModules = new Set(result.modules.map(m => m.name));
  const validFiles = new Set(result.modules.flatMap(m => m.files.map(f => f.path)));
  const validSymbols = new Set(result.modules.flatMap(m =>
    m.files.flatMap(f => f.symbols.filter(s => s.exported).map(s => `${f.path}::${s.name}`))
  ));

  // Add root files
  if (result.rootFiles) {
    for (const f of result.rootFiles) {
      validFiles.add(f.path);
      for (const s of f.symbols.filter(s => s.exported)) {
        validSymbols.add(`${f.path}::${s.name}`);
      }
    }
  }

  const nodeIds = new Set(idea.nodes.map(n => n.id));
  let removedRefs = 0;
  let totalRefs = 0;

  for (const node of idea.nodes) {
    delete node.parentId;

    if (node.codeRefs) {
      totalRefs += node.codeRefs.length;
      const validRefs = [];
      for (const ref of node.codeRefs) {
        if (ref.type === 'module' && validModules.has(ref.name)) {
          validRefs.push(ref);
        } else if (ref.type === 'file' && validFiles.has(ref.path)) {
          validRefs.push(ref);
        } else if (ref.type === 'symbol' && validSymbols.has(`${ref.path}::${ref.name}`)) {
          validRefs.push(ref);
        } else {
          removedRefs++;
        }
      }
      node.codeRefs = validRefs;
    }
  }

  if (idea.edges) {
    idea.edges = idea.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }

  if (removedRefs > 0) {
    console.warn(`  Removed ${removedRefs}/${totalRefs} hallucinated code references from idea structure`);
  }

  return { validated: idea, removedRefs, totalRefs };
}

/**
 * Parse JSON from LLM response.
 */
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
