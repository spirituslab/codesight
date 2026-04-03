/**
 * Build cross-references: for each imported symbol, find its definition
 * and populate the usedBy array.
 */
export function buildCrossReferences(modules, rootFiles) {
  // Build symbol map: name -> [{ file path, symbol ref }]
  const symbolMap = new Map();
  const allFiles = [...rootFiles, ...modules.flatMap(m => m.files)];

  for (const file of allFiles) {
    for (const sym of file.symbols) {
      if (!sym.exported) continue;
      if (!symbolMap.has(sym.name)) symbolMap.set(sym.name, []);
      symbolMap.get(sym.name).push({ filePath: file.path, symbol: sym });
    }
  }

  // For each file's imports, mark usedBy on matching symbols
  for (const file of allFiles) {
    for (const imp of file.imports) {
      if (imp.resolvedModule === "external") continue;
      for (const symName of imp.symbols) {
        const defs = symbolMap.get(symName);
        if (!defs) continue;
        // Prefer definition in the resolved path, else first match
        const match = defs.find(d =>
          imp.resolvedPath && d.filePath.startsWith(imp.resolvedPath)
        ) || defs[0];
        if (match && !match.symbol.usedBy.includes(file.path)) {
          match.symbol.usedBy.push(file.path);
        }
      }
    }
  }
}
