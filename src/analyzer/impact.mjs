// Dependency impact analysis — transitive dependency tracking + risk scoring

/**
 * Compute impact metrics for all symbols and files.
 * Uses both file-level imports and symbol-level call graph.
 */
export function computeImpact(modules, rootFiles, callGraph) {
  const allFiles = [...rootFiles, ...modules.flatMap(m => m.files)];

  // Build file-level reverse dependency map
  const fileDepMap = new Map(); // file → Set of files that import it
  for (const file of allFiles) {
    for (const imp of file.imports) {
      if (imp.resolvedModule === 'external' || !imp.resolvedPath) continue;
      // Find target file
      const target = allFiles.find(f =>
        f.path === imp.resolvedPath ||
        f.path.replace(/\.[^.]+$/, '') === imp.resolvedPath
      );
      if (target) {
        if (!fileDepMap.has(target.path)) fileDepMap.set(target.path, new Set());
        fileDepMap.get(target.path).add(file.path);
      }
    }
  }

  // Build symbol-level reverse call map from callGraph
  const symbolCallers = new Map(); // "file::sym" → Set of "file::sym" callers
  if (callGraph?.edges) {
    for (const edge of callGraph.edges) {
      if (!symbolCallers.has(edge.target)) symbolCallers.set(edge.target, new Set());
      symbolCallers.get(edge.target).add(edge.source);
    }
  }

  // Compute transitive file impact via BFS
  const impactMap = {};
  for (const file of allFiles) {
    const directDeps = fileDepMap.get(file.path);
    if (!directDeps || directDeps.size === 0) continue;

    const transitive = new Set();
    const queue = [...directDeps];
    while (queue.length > 0) {
      const dep = queue.shift();
      if (transitive.has(dep)) continue;
      transitive.add(dep);
      const next = fileDepMap.get(dep);
      if (next) {
        for (const n of next) {
          if (!transitive.has(n)) queue.push(n);
        }
      }
    }

    const riskLevel = transitive.size > 10 ? 'high' : transitive.size > 3 ? 'medium' : 'low';

    impactMap[file.path] = {
      directDependents: [...directDeps],
      transitiveDependents: [...transitive],
      transitiveCount: transitive.size,
      riskLevel,
    };
  }

  // Compute symbol-level impact
  for (const file of allFiles) {
    for (const sym of file.symbols) {
      const symId = `${file.path}::${sym.name}`;
      const callers = symbolCallers.get(symId);
      const directCount = callers?.size || 0;
      const usedByCount = sym.usedBy?.length || 0;

      // BFS through callers for transitive impact
      let transitiveDepth = 0;
      const transitiveFiles = new Set();
      if (callers) {
        const visited = new Set();
        const queue = [...callers].map(c => ({ id: c, depth: 1 }));
        while (queue.length > 0) {
          const { id, depth } = queue.shift();
          if (visited.has(id)) continue;
          visited.add(id);
          transitiveDepth = Math.max(transitiveDepth, depth);
          const [callerFile] = id.split('::');
          transitiveFiles.add(callerFile);
          const nextCallers = symbolCallers.get(id);
          if (nextCallers) {
            for (const nc of nextCallers) {
              if (!visited.has(nc)) queue.push({ id: nc, depth: depth + 1 });
            }
          }
        }
      }

      const totalImpact = Math.max(directCount, usedByCount);
      if (totalImpact > 0) {
        sym.impact = {
          directCallers: directCount,
          fileImporters: usedByCount,
          transitiveDepth,
          impactedFiles: transitiveFiles.size,
          riskLevel: totalImpact > 10 ? 'high' : totalImpact > 3 ? 'medium' : 'low',
        };
      }
    }
  }

  return impactMap;
}
