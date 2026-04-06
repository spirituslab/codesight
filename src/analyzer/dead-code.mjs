/**
 * Dead code detection — finds unused symbols, files, and modules.
 */

/**
 * Detect dead code across the project.
 * @param {Array} modules - analyzed modules with files and symbols
 * @param {Array} rootFiles - root-level files
 * @param {object} callGraph - call graph with edges [{source, target}]
 * @param {Array} edges - module-to-module edges [{source, target, weight}]
 * @returns {{ deadSymbols, deadFiles, deadModules, stats }}
 */
export function detectDeadCode(modules, rootFiles, callGraph, edges) {
  const allFiles = [...rootFiles, ...modules.flatMap(m => m.files)];

  // Build set of call graph targets (symbols that are called by something)
  const calledSymbols = new Set();
  if (callGraph?.edges) {
    for (const e of callGraph.edges) {
      calledSymbols.add(e.target); // format: "file::symbol"
    }
  }

  // Build set of entry point file paths
  const entryPaths = new Set(allFiles.filter(f => f.isEntryPoint).map(f => f.path));

  // Build set of modules with incoming edges
  const modulesWithIncoming = new Set();
  for (const e of edges) {
    modulesWithIncoming.add(e.target);
  }

  // 1. Detect dead symbols
  const deadSymbols = [];
  const deadSymbolKeys = new Set();

  for (const file of allFiles) {
    if (entryPaths.has(file.path)) continue; // skip entry point files entirely

    for (const sym of file.symbols) {
      if (!sym.exported) continue; // only flag exported symbols as dead

      const hasImporters = sym.usedBy && sym.usedBy.length > 0;
      const callKey = `${file.path}::${sym.name}`;
      const hasCallers = calledSymbols.has(callKey);

      if (!hasImporters && !hasCallers) {
        deadSymbols.push({
          file: file.path,
          name: sym.name,
          kind: sym.kind,
          reason: 'exported but never imported or called',
        });
        deadSymbolKeys.add(callKey);
      }
    }
  }

  // 2. Detect dead files
  const deadFiles = [];
  for (const file of allFiles) {
    if (entryPaths.has(file.path)) continue;
    if (file.importedByCount > 0) continue;
    if (file.symbols.length === 0) continue;

    const allDead = file.symbols
      .filter(s => s.exported)
      .every(s => deadSymbolKeys.has(`${file.path}::${s.name}`));

    if (allDead) {
      deadFiles.push({ path: file.path, symbolCount: file.symbols.length });
    }
  }

  // 3. Detect dead modules
  const deadModules = [];
  for (const mod of modules) {
    if (modulesWithIncoming.has(mod.name)) continue;
    const hasEntryPoint = mod.files.some(f => entryPaths.has(f.path));
    if (hasEntryPoint) continue;
    deadModules.push({ name: mod.name });
  }

  const totalSymbols = allFiles.reduce((s, f) => s + f.symbols.length, 0);

  return {
    deadSymbols,
    deadFiles,
    deadModules,
    stats: {
      totalSymbols,
      deadSymbolCount: deadSymbols.length,
      totalFiles: allFiles.length,
      deadFileCount: deadFiles.length,
      totalModules: modules.length,
      deadModuleCount: deadModules.length,
    },
  };
}
