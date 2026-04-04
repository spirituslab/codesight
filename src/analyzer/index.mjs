import { readFile, access, stat } from "fs/promises";
import { relative, basename, dirname, resolve } from "path";
import { walkDir } from "./walker.mjs";
import { detectLanguage } from "./detector.mjs";
import { parseFile } from "./parser.mjs";
import { getLanguage } from "../languages/index.mjs";
import { buildCrossReferences } from "./references.mjs";
import { buildFileIndex } from "./file-index.mjs";
import { refineModuleGrouping } from "./modules.mjs";
import { loadCache, saveCache, hashContent, getCachedParse, setCachedParse, pruneCache } from "./cache.mjs";

const BATCH_SIZE = 30;

/**
 * Detect the "source root" — usually src/, lib/, or the project root itself.
 */
function detectSourceRoot(files, projectRoot) {
  const srcDirs = ["src", "lib", "app", "source"];
  for (const dir of srcDirs) {
    const prefix = dir + "/";
    const count = files.filter(f => {
      const rel = relative(projectRoot, f);
      return rel.startsWith(prefix);
    }).length;
    if (count > files.length * 0.3) {
      return resolve(projectRoot, dir);
    }
  }
  return projectRoot;
}

/**
 * Detect project name from package.json, setup.py, Cargo.toml, etc.
 */
async function detectProjectName(projectRoot) {
  const checks = [
    { file: "package.json", extract: (c) => JSON.parse(c).name },
    { file: "pyproject.toml", extract: (c) => c.match(/name\s*=\s*"([^"]+)"/)?.[1] },
    { file: "Cargo.toml", extract: (c) => c.match(/name\s*=\s*"([^"]+)"/)?.[1] },
    { file: "go.mod", extract: (c) => c.match(/module\s+(\S+)/)?.[1]?.split("/").pop() },
  ];

  for (const { file, extract } of checks) {
    try {
      const content = await readFile(resolve(projectRoot, file), "utf-8");
      const name = extract(content);
      if (name) return name;
    } catch {}
  }

  return basename(projectRoot);
}

/**
 * Detect entry point files from project config and naming conventions.
 */
async function detectEntryPoints(projectRoot, allFiles) {
  const entryPoints = new Set();
  const allPaths = allFiles.map(f => f.path);

  // 1. From package.json: main, bin, exports
  try {
    const pkg = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf-8"));
    const candidates = [];
    if (pkg.main) candidates.push(pkg.main);
    if (pkg.bin) {
      if (typeof pkg.bin === "string") candidates.push(pkg.bin);
      else for (const v of Object.values(pkg.bin)) candidates.push(v);
    }
    if (pkg.exports) {
      const walk = (obj) => {
        if (typeof obj === "string") candidates.push(obj);
        else if (obj && typeof obj === "object") Object.values(obj).forEach(walk);
      };
      walk(pkg.exports);
    }
    for (const c of candidates) {
      const rel = c.replace(/^\.\//, "");
      const match = allPaths.find(p => p === rel || p.replace(/\.[^.]+$/, "") === rel.replace(/\.[^.]+$/, ""));
      if (match) entryPoints.add(match);
    }
  } catch {}

  // 2. From pyproject.toml: scripts
  try {
    const toml = await readFile(resolve(projectRoot, "pyproject.toml"), "utf-8");
    const scriptSection = toml.match(/\[(?:project\.scripts|tool\.poetry\.scripts)\]([\s\S]*?)(?:\n\[|$)/);
    if (scriptSection) {
      const entries = scriptSection[1].matchAll(/=\s*"([^"]+)"/g);
      for (const m of entries) {
        const modulePath = m[1].split(":")[0].replace(/\./g, "/");
        const match = allPaths.find(p => p.includes(modulePath));
        if (match) entryPoints.add(match);
      }
    }
  } catch {}

  // 3. Naming conventions: files named main, index, app, cli, __main__
  const entryNames = /^(main|index|app|cli|server|__main__)\.[^.]+$/;
  for (const p of allPaths) {
    const name = basename(p);
    if (entryNames.test(name)) {
      // Only mark as entry point if it's in the project root or src/ or an entrypoints dir
      const depth = p.split("/").length;
      if (depth <= 2 || p.includes("entrypoint") || p.includes("bin/")) {
        entryPoints.add(p);
      }
    }
  }

  return entryPoints;
}

/**
 * Main analysis function.
 */
export async function analyze(projectRoot, options = {}) {
  const startTime = Date.now();
  const { extraIgnore = [], maxFiles = 5000 } = options;
  const warnings = [];

  console.log(`Scanning ${projectRoot}...`);

  // 1. Walk files
  const allPaths = await walkDir(projectRoot, extraIgnore);

  // 2. Filter to supported languages
  const supportedFiles = [];
  const langCounts = {};
  for (const filePath of allPaths) {
    const langId = detectLanguage(filePath);
    if (!langId) continue;
    supportedFiles.push({ path: filePath, langId });
    langCounts[langId] = (langCounts[langId] || 0) + 1;
  }

  if (supportedFiles.length > maxFiles) {
    console.warn(`Warning: ${supportedFiles.length} files found, limiting to ${maxFiles}`);
    supportedFiles.length = maxFiles;
  }

  console.log(`Found ${supportedFiles.length} files (${Object.entries(langCounts).map(([k, v]) => `${v} ${k}`).join(", ")})`);

  // 3. Detect source root and project name
  const sourceRoot = detectSourceRoot(supportedFiles.map(f => f.path), projectRoot);
  const projectName = await detectProjectName(projectRoot);
  const languages = Object.keys(langCounts);

  // 3.5 Build file path index for accurate import resolution
  const fileIndex = buildFileIndex(supportedFiles.map(f => f.path), projectRoot);

  // 3.6 Read tsconfig.json for path aliases (TypeScript/JavaScript projects)
  try {
    const tsconfigPath = resolve(projectRoot, "tsconfig.json");
    const tsconfigRaw = await readFile(tsconfigPath, "utf-8");
    // Strip comments (tsconfig allows them) and trailing commas
    const stripped = tsconfigRaw
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,\s*([\]}])/g, "$1");
    const tsconfig = JSON.parse(stripped);
    const co = tsconfig.compilerOptions || {};
    if (co.paths || co.baseUrl) {
      fileIndex.tsconfig = { paths: co.paths || {}, baseUrl: co.baseUrl || "." };
      console.log(`  tsconfig.json: ${Object.keys(co.paths || {}).length} path aliases, baseUrl="${co.baseUrl || "."}"`);
    }
  } catch {
    // No tsconfig.json or invalid — that's fine
  }

  // 4. Parse files in batches (with incremental caching)
  const cache = await loadCache(projectRoot);
  const moduleMap = new Map();
  let cacheHits = 0;

  for (let i = 0; i < supportedFiles.length; i += BATCH_SIZE) {
    const batch = supportedFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ({ path: filePath, langId }) => {
        try {
          const content = await readFile(filePath, "utf-8");
          const lineCount = content.split("\n").length;
          const lang = getLanguage(langId);
          const relPath = relative(projectRoot, filePath);
          const contentHash = hashContent(content);

          // Check cache
          const cached = getCachedParse(cache, relPath, contentHash);
          let symbols, imports, rootNode;

          if (cached) {
            // Use cached symbols/imports, but re-parse for AST if file has functions/methods
            symbols = cached.symbols;
            rootNode = null;
            cacheHits++;

            // Re-parse only if we need the AST for call graph extraction
            const hasFunctions = symbols.some(s => s.kind === 'function' || s.kind === 'method');
            if (hasFunctions) {
              const parsed = parseFile(content, langId);
              if (parsed) rootNode = parsed.rootNode;
            }

            imports = cached.rawImports;
          } else {
            const parsed = parseFile(content, langId);
            if (!parsed) return null;
            symbols = parsed.symbols;
            rootNode = parsed.rootNode;
            imports = parsed.imports;

            // Cache the result (symbols + raw imports, not resolved imports or AST)
            setCachedParse(cache, relPath, contentHash, {
              symbols: symbols.map(s => ({ ...s, usedBy: [] })), // strip transient fields
              rawImports: imports,
            });
          }

          // Resolve imports (always, since file index may have changed)
          const resolvedImports = imports.map(imp => {
            const resolved = lang.resolveImport(imp.source, filePath, projectRoot, fileIndex);
            return {
              source: imp.source,
              resolvedPath: resolved.resolvedPath,
              resolvedModule: resolved.resolvedModule,
              symbols: imp.symbols,
              typeOnly: imp.typeOnly || false,
            };
          });

          const moduleName = lang.getModulePath(filePath, projectRoot);

          return {
            moduleName,
            fileInfo: {
              name: basename(filePath),
              path: relPath,
              language: langId,
              lineCount,
              symbols,
              imports: resolvedImports,
              _rootNode: rootNode, // transient: used by callgraph, stripped before serialization
            },
          };
        } catch (err) {
          console.warn(`  Warning: failed to parse ${relative(projectRoot, filePath)}: ${err.message}`);
          return null;
        }
      })
    );

    for (const result of results) {
      if (!result) continue;
      const { moduleName, fileInfo } = result;
      if (!moduleMap.has(moduleName)) {
        moduleMap.set(moduleName, { files: [], lineCount: 0, languages: new Set() });
      }
      const mod = moduleMap.get(moduleName);
      mod.files.push(fileInfo);
      mod.lineCount += fileInfo.lineCount;
      mod.languages.add(fileInfo.language);
    }

    if (i + BATCH_SIZE < supportedFiles.length) {
      process.stdout.write(`  Parsed ${Math.min(i + BATCH_SIZE, supportedFiles.length)}/${supportedFiles.length} files\r`);
    }
  }
  console.log(`  Parsed ${supportedFiles.length}/${supportedFiles.length} files${cacheHits > 0 ? ` (${cacheHits} cached)` : ''}`);

  // Save cache (prune removed files first)
  pruneCache(cache, supportedFiles.map(f => relative(projectRoot, f.path)));
  await saveCache(projectRoot, cache);

  // 4.5 Refine module grouping (split oversized modules, detect monorepo patterns)
  const refinedModuleMap = refineModuleGrouping(moduleMap, projectRoot);

  // 5. Build modules array
  const modules = [];
  const rootFiles = [];

  for (const [name, data] of refinedModuleMap.entries()) {
    const totalSymbols = data.files.reduce((s, f) => s + f.symbols.length, 0);
    const totalFunctions = data.files.reduce((s, f) => s + f.symbols.filter(sym => sym.kind === "function").length, 0);
    const totalClasses = data.files.reduce((s, f) => s + f.symbols.filter(sym => sym.kind === "class").length, 0);
    const totalTypes = data.files.reduce((s, f) => s + f.symbols.filter(sym => ["type", "interface"].includes(sym.kind)).length, 0);

    const descParts = [`${data.files.length} files`];
    if (totalFunctions) descParts.push(`${totalFunctions} functions`);
    if (totalClasses) descParts.push(`${totalClasses} classes`);
    if (totalTypes) descParts.push(`${totalTypes} types`);

    const entry = {
      name,
      path: name === "root" ? "" : name,
      description: descParts.join(", "),
      fileCount: data.files.length,
      lineCount: data.lineCount,
      languages: [...data.languages],
      files: data.files.sort((a, b) => b.lineCount - a.lineCount),
    };

    if (name === "root") {
      rootFiles.push(...entry.files);
    } else {
      modules.push(entry);
    }
  }

  modules.sort((a, b) => b.lineCount - a.lineCount);

  // 6. Build module-to-module edges
  const edgeMap = new Map();
  const allFileInfos = [...rootFiles, ...modules.flatMap(m => m.files)];

  // Build file → module name lookup from refined modules
  const fileToModule = new Map();
  for (const [name, data] of refinedModuleMap.entries()) {
    for (const f of data.files) {
      fileToModule.set(f.path, name);
    }
  }

  for (const file of allFileInfos) {
    const srcMod = fileToModule.get(file.path) || "root";

    for (const imp of file.imports) {
      const targetModule = imp.resolvedModule;
      if (targetModule === "external" || targetModule === srcMod) continue;
      const key = `${srcMod}→${targetModule}`;
      edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
    }
  }

  const edges = [];
  for (const [key, weight] of edgeMap.entries()) {
    const [source, target] = key.split("→");
    edges.push({ source, target, weight });
  }
  edges.sort((a, b) => b.weight - a.weight);

  // 7. Build cross-references
  buildCrossReferences(modules, rootFiles);

  // 8. Detect entry points
  const entryPointPaths = await detectEntryPoints(projectRoot, allFileInfos);
  for (const file of allFileInfos) {
    file.isEntryPoint = entryPointPaths.has(file.path);
  }

  // 9. Compute importance (how many files import each file)
  const importedByCount = new Map();
  for (const file of allFileInfos) {
    for (const imp of file.imports) {
      if (imp.resolvedModule === "external" || !imp.resolvedPath) continue;
      // resolvedPath is now exact (set by fileIndex during import resolution)
      if (fileIndex.has(imp.resolvedPath)) {
        importedByCount.set(imp.resolvedPath, (importedByCount.get(imp.resolvedPath) || 0) + 1);
      }
    }
  }
  for (const file of allFileInfos) {
    file.importedByCount = importedByCount.get(file.path) || 0;
  }

  // Build top-level key files list (most imported across entire project)
  const keyFiles = allFileInfos
    .filter(f => f.importedByCount > 0)
    .sort((a, b) => b.importedByCount - a.importedByCount)
    .slice(0, 20)
    .map(f => ({ path: f.path, name: f.name, importedByCount: f.importedByCount, isEntryPoint: f.isEntryPoint }));

  // 10. Build call graph
  console.log('  Building call graph...');
  const { buildCallGraph } = await import('./callgraph.mjs');
  const callGraph = buildCallGraph(modules, rootFiles, projectRoot, warnings);
  console.log(`  Call graph: ${callGraph.stats.totalCalls} calls (${callGraph.stats.exact} exact, ${callGraph.stats.inferred} inferred, ${callGraph.stats.ambiguous} ambiguous, ${callGraph.stats.unresolved} unresolved)`);

  // Strip transient AST nodes before serialization
  for (const file of allFileInfos) {
    delete file._rootNode;
  }

  // 11. Compute impact
  const { computeImpact } = await import('./impact.mjs');
  const impactMap = computeImpact(modules, rootFiles, callGraph);
  const impactedFileCount = Object.keys(impactMap).length;

  const elapsed = Date.now() - startTime;
  console.log(`Done in ${elapsed}ms`);
  console.log(`  ${modules.length} modules, ${rootFiles.length} root files`);
  console.log(`  ${edges.length} module-to-module edges`);
  console.log(`  ${allFileInfos.reduce((s, f) => s + f.symbols.length, 0)} symbols extracted`);
  console.log(`  ${entryPointPaths.size} entry points, ${keyFiles.length} key files`);
  console.log(`  ${impactedFileCount} files with dependents`);
  if (warnings.length > 0) {
    console.warn(`  ${warnings.length} warning(s) during analysis`);
  }

  const result = {
    generatedAt: new Date().toISOString(),
    projectName,
    languages,
    modules,
    rootFiles,
    edges,
    keyFiles,
    callGraph,
    impactMap,
    warnings,
  };

  // Generate basic tours from call graph (no LLM needed)
  if (callGraph.edges.length > 0) {
    const { generateTours } = await import('../llm/tours.mjs');
    const basicTours = await generateTours(result, null);
    if (basicTours.length > 0) {
      result.tours = basicTours;
    }
  }

  // LLM enhancement (optional)
  if (options.llm) {
    const { generateExplanations } = await import('../llm/explain.mjs');
    const { generateIdeaStructure } = await import('../llm/ideas.mjs');

    console.log('\nGenerating LLM explanations...');
    await generateExplanations(result, options.llm);

    console.log('Generating idea structure...');
    const ideaStructure = await generateIdeaStructure(result, options.llm);
    if (ideaStructure) {
      result.ideaStructure = ideaStructure;
    }

    console.log('Generating guided tours...');
    const { generateTours } = await import('../llm/tours.mjs');
    const tours = await generateTours(result, options.llm);
    if (tours.length > 0) {
      result.tours = tours;
      console.log(`  ${tours.length} tours generated`);
    }

    result.llmGenerated = true;
    result.llmProvider = options.llm.provider;
    result.llmModel = options.llm.model;

    const usage = options.llm.getUsage();
    console.log(`\nLLM usage: ~${usage.inputTokens} input tokens, ~${usage.outputTokens} output tokens`);
  }

  return result;
}
