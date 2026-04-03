import { readFile, access, stat } from "fs/promises";
import { relative, basename, dirname, resolve } from "path";
import { walkDir } from "./walker.mjs";
import { detectLanguage } from "./detector.mjs";
import { parseFile } from "./parser.mjs";
import { getLanguage } from "../languages/index.mjs";
import { buildCrossReferences } from "./references.mjs";

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

  // 4. Parse files in batches
  const moduleMap = new Map();

  for (let i = 0; i < supportedFiles.length; i += BATCH_SIZE) {
    const batch = supportedFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async ({ path: filePath, langId }) => {
        try {
          const content = await readFile(filePath, "utf-8");
          const lineCount = content.split("\n").length;
          const parsed = parseFile(content, langId);
          if (!parsed) return null;

          const lang = getLanguage(langId);
          const relPath = relative(projectRoot, filePath);

          // Resolve imports
          const resolvedImports = parsed.imports.map(imp => {
            const resolved = lang.resolveImport(imp.source, filePath, projectRoot);
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
              symbols: parsed.symbols,
              imports: resolvedImports,
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
  console.log(`  Parsed ${supportedFiles.length}/${supportedFiles.length} files`);

  // 5. Build modules array
  const modules = [];
  const rootFiles = [];

  for (const [name, data] of moduleMap.entries()) {
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

  for (const file of allFileInfos) {
    const sourceModule = moduleMap.has(file.path.split("/")[0])
      ? file.path.split("/")[0]
      : "root";
    // Find which module this file belongs to
    const srcMod = modules.find(m => m.files.includes(file))?.name || "root";

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
      // Find which file this import resolves to
      for (const target of allFileInfos) {
        const targetNoExt = target.path.replace(/\.[^.]+$/, "");
        if (targetNoExt === imp.resolvedPath || target.path === imp.resolvedPath ||
            targetNoExt.endsWith("/" + imp.resolvedPath) || targetNoExt === "src/" + imp.resolvedPath) {
          importedByCount.set(target.path, (importedByCount.get(target.path) || 0) + 1);
          break;
        }
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

  const elapsed = Date.now() - startTime;
  console.log(`Done in ${elapsed}ms`);
  console.log(`  ${modules.length} modules, ${rootFiles.length} root files`);
  console.log(`  ${edges.length} module-to-module edges`);
  console.log(`  ${allFileInfos.reduce((s, f) => s + f.symbols.length, 0)} symbols extracted`);
  console.log(`  ${entryPointPaths.size} entry points, ${keyFiles.length} key files`);

  return {
    generatedAt: new Date().toISOString(),
    projectName,
    languages,
    modules,
    rootFiles,
    edges,
    keyFiles,
  };
}
