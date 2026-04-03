#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { analyze } from "./src/analyzer/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Simple arg parsing
const args = process.argv.slice(2);
let projectPath = ".";
let outputPath = null;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--output" || args[i] === "-o") && args[i + 1]) {
    outputPath = args[++i];
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
codesight — Universal code structure visualization

Usage:
  node analyze.mjs [path] [options]

Arguments:
  path              Project root to analyze (default: current directory)

Options:
  -o, --output      Output file path (default: <codesight>/web/data.js)
  -h, --help        Show this help message

Examples:
  node analyze.mjs .                    # Analyze current directory
  node analyze.mjs ~/projects/myapp     # Analyze a specific project
  node analyze.mjs . -o ./output.js     # Custom output path
`);
    process.exit(0);
  } else if (!args[i].startsWith("-")) {
    projectPath = args[i];
  }
}

const absoluteProjectPath = resolve(projectPath);
const defaultOutput = join(__dirname, "web", "data.js");
const absoluteOutputPath = resolve(outputPath || defaultOutput);

try {
  const data = await analyze(absoluteProjectPath);
  const json = JSON.stringify(data, null, 2);
  await writeFile(absoluteOutputPath, `window.CODEBASE_DATA = ${json};\n`);
  console.log(`\nOutput written to: ${absoluteOutputPath}`);
  console.log(`\nTo view: cd ${__dirname} && python3 -m http.server 8080 -d web/`);
} catch (err) {
  console.error("Analysis failed:", err.message);
  process.exit(1);
}
