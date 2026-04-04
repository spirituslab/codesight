// Call graph builder — extracts function-level call relationships

import { getLanguage } from "../languages/index.mjs";

/**
 * Build a call graph from parsed modules.
 * Uses cached _rootNode from initial parse pass.
 */
export function buildCallGraph(modules, rootFiles, projectRoot, warnings = []) {
  const allFiles = [...rootFiles, ...modules.flatMap(m => m.files)];

  // Build path lookup maps for O(1) file resolution
  const fileByPath = new Map();
  const fileByPathNoExt = new Map();
  for (const file of allFiles) {
    fileByPath.set(file.path, file);
    fileByPathNoExt.set(file.path.replace(/\.[^.]+$/, ''), file);
  }
  function findFileByPath(path) {
    return fileByPath.get(path) || fileByPathNoExt.get(path) || null;
  }

  // Build a global symbol index: symbolName → [{ filePath, symbol }]
  const symbolIndex = new Map();
  for (const file of allFiles) {
    for (const sym of file.symbols) {
      if (!symbolIndex.has(sym.name)) symbolIndex.set(sym.name, []);
      symbolIndex.get(sym.name).push({ filePath: file.path, symbol: sym });
    }
  }

  const callGraphEdges = [];
  let processed = 0;
  let unresolvedCount = 0;

  // Build set of files each file imports (for disambiguation)
  const importedFilesMap = new Map();
  for (const file of allFiles) {
    const importedFiles = new Set();
    for (const imp of file.imports) {
      if (imp.resolvedPath) importedFiles.add(imp.resolvedPath);
      // Also match without extension for fuzzy cases
      if (imp.resolvedPath) importedFiles.add(imp.resolvedPath.replace(/\.[^./]+$/, ''));
    }
    importedFilesMap.set(file.path, importedFiles);
  }

  for (const file of allFiles) {
    const lang = getLanguage(file.language);
    if (!lang?.extractCalls) continue;

    try {
      if (!file._rootNode) continue;

      const callMap = lang.extractCalls(file._rootNode, file.symbols, file.imports);
      const importedFiles = importedFilesMap.get(file.path) || new Set();

      for (const [callerName, calls] of callMap) {
        const callerSym = file.symbols.find(s => s.name === callerName);
        if (!callerSym) continue;

        const resolvedCalls = [];

        for (const call of calls) {
          const callName = call.name.split('.').pop();

          let targetFile = null;
          let targetSymbol = callName;
          let confidence = 'exact';

          if (call.resolvedFile && !call.isExternal) {
            // Import resolved to a local file — highest confidence
            targetFile = call.resolvedFile;
            confidence = 'exact';
          } else if (!call.resolvedFile && !call.isExternal) {
            // Local call in same file
            targetFile = file.path;
            confidence = 'exact';
          } else {
            // Fall back to global symbol index
            const candidates = symbolIndex.get(callName);
            if (candidates) {
              const exported = candidates.filter(c => c.symbol.exported && c.filePath !== file.path);

              if (exported.length === 1) {
                targetFile = exported[0].filePath;
                confidence = 'inferred';
              } else if (exported.length > 1) {
                // Disambiguate using the file's import graph
                const fromImported = exported.filter(c =>
                  importedFiles.has(c.filePath) || importedFiles.has(c.filePath.replace(/\.[^./]+$/, ''))
                );
                if (fromImported.length === 1) {
                  targetFile = fromImported[0].filePath;
                  confidence = 'inferred';
                } else {
                  // Try import source path hint
                  const imp = file.imports.find(i => i.symbols.includes(callName));
                  if (imp?.source) {
                    const hint = imp.source.replace(/^@\//, '').replace(/\./g, '/');
                    const best = exported.find(c => c.filePath.includes(hint));
                    if (best) {
                      targetFile = best.filePath;
                      confidence = 'inferred';
                    }
                  }
                  if (!targetFile) {
                    targetFile = (fromImported[0] || exported[0]).filePath;
                    confidence = 'ambiguous';
                  }
                }
              } else {
                // No exported matches — check non-exported
                const any = candidates.filter(c => c.filePath !== file.path);
                if (any.length === 1) {
                  targetFile = any[0].filePath;
                  confidence = 'inferred';
                } else if (any.length > 1) {
                  const fromImported = any.filter(c =>
                    importedFiles.has(c.filePath) || importedFiles.has(c.filePath.replace(/\.[^./]+$/, ''))
                  );
                  targetFile = (fromImported[0] || any[0]).filePath;
                  confidence = fromImported.length === 1 ? 'inferred' : 'ambiguous';
                }
              }
            }

            // Check same file as last resort
            if (!targetFile) {
              const localSym = file.symbols.find(s => s.name === callName && s.name !== callerName);
              if (localSym) {
                targetFile = file.path;
                confidence = 'inferred';
              }
            }
          }

          if (!targetFile) {
            unresolvedCount++;
            continue;
          }

          resolvedCalls.push({
            name: callName,
            resolvedFile: targetFile,
            line: call.line,
          });

          callGraphEdges.push({
            source: `${file.path}::${callerName}`,
            target: `${targetFile}::${targetSymbol}`,
            line: call.line,
            confidence,
          });
        }

        if (resolvedCalls.length > 0) {
          callerSym.calls = resolvedCalls;
        }
      }
    } catch (err) {
      warnings.push({ type: 'callgraph', file: file.path, message: err.message });
    }

    processed++;
    if (processed % 50 === 0) {
      process.stdout.write(`\r  Call graph: ${processed}/${allFiles.length} files`);
    }
  }

  if (unresolvedCount > 0) {
    warnings.push({ type: 'callgraph', message: `${unresolvedCount} calls could not be resolved to known symbols` });
  }

  if (allFiles.length > 50) console.log(`\r  Call graph: ${allFiles.length}/${allFiles.length} files`);

  // Build calledBy on symbols
  for (const edge of callGraphEdges) {
    const [targetFile, targetName] = edge.target.split('::');
    const [sourceFile, sourceName] = edge.source.split('::');

    const file = findFileByPath(targetFile);
    if (file) {
      const sym = file.symbols.find(s => s.name === targetName);
      if (sym) {
        if (!sym.calledBy) sym.calledBy = [];
        sym.calledBy.push({ symbol: sourceName, file: sourceFile, line: edge.line });
      }
    }
  }

  // Build compact call graph for output
  const nodes = [];
  const nodeSet = new Set();
  for (const edge of callGraphEdges) {
    for (const id of [edge.source, edge.target]) {
      if (!nodeSet.has(id)) {
        nodeSet.add(id);
        const [filePath, symName] = id.split('::');
        const file = findFileByPath(filePath);
        const sym = file?.symbols.find(s => s.name === symName);
        nodes.push({
          id,
          symbol: symName,
          file: file?.path || filePath,
          kind: sym?.kind || 'unknown',
        });
      }
    }
  }

  return {
    nodes,
    edges: callGraphEdges,
    stats: {
      totalCalls: callGraphEdges.length,
      filesWithCalls: new Set(callGraphEdges.map(e => e.source.split('::')[0])).size,
      uniqueCallers: new Set(callGraphEdges.map(e => e.source)).size,
      uniqueCallees: new Set(callGraphEdges.map(e => e.target)).size,
      exact: callGraphEdges.filter(e => e.confidence === 'exact').length,
      inferred: callGraphEdges.filter(e => e.confidence === 'inferred').length,
      ambiguous: callGraphEdges.filter(e => e.confidence === 'ambiguous').length,
      unresolved: unresolvedCount,
    },
  };
}
