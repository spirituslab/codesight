#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { analyze } from "./src/analyzer/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Init subcommand ──────────────────────────────────────────
const args = process.argv.slice(2);

if (args[0] === "init") {
  const targetDir = resolve(args[1] || ".");
  const mcpJsonPath = resolve(targetDir, ".mcp.json");
  const mcpServerPath = resolve(__dirname, "mcp-server.mjs");

  // Verify target directory exists
  try {
    const { stat: fsStat } = await import("fs/promises");
    const s = await fsStat(targetDir);
    if (!s.isDirectory()) {
      console.error(`Error: "${targetDir}" is not a directory`);
      process.exit(2);
    }
  } catch {
    console.error(`Error: "${targetDir}" does not exist`);
    process.exit(2);
  }

  // Check if .mcp.json already exists and has codesight
  try {
    const { readFile } = await import("fs/promises");
    const existing = JSON.parse(await readFile(mcpJsonPath, "utf-8"));
    if (existing.mcpServers?.codesight) {
      console.log("Codesight MCP is already registered in .mcp.json");
      process.exit(0);
    }
    // Merge into existing config
    existing.mcpServers = existing.mcpServers || {};
    existing.mcpServers.codesight = {
      command: "node",
      args: [mcpServerPath, "."],
    };
    await writeFile(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n");
    console.log(`Added codesight to existing .mcp.json`);
  } catch {
    // No existing .mcp.json — create new
    const config = {
      mcpServers: {
        codesight: {
          command: "node",
          args: [mcpServerPath, "."],
        },
      },
    };
    await writeFile(mcpJsonPath, JSON.stringify(config, null, 2) + "\n");
    console.log(`Created .mcp.json with codesight MCP`);
  }
  console.log(`MCP server: ${mcpServerPath}`);
  console.log(`\nStart Claude Code in ${targetDir} and the codesight tools will be available.`);
  process.exit(0);
}

// ─── Arg parsing ──────────────────────────────────────────────
let projectPath = ".";
let outputPath = null;
let jsonOutput = false;
let maxFiles = 5000;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === "--output" || args[i] === "-o") && args[i + 1]) {
    outputPath = args[++i];
  } else if (args[i] === "--json") {
    jsonOutput = true;
  } else if (args[i] === "--max-files" && args[i + 1]) {
    maxFiles = parseInt(args[++i], 10);
    if (isNaN(maxFiles) || maxFiles < 1) {
      console.error("Error: --max-files must be a positive integer");
      process.exit(2);
    }
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
codesight — Universal code structure visualization

Usage:
  codesight [path] [options]
  codesight init [path]

Commands:
  init [path]         Register codesight MCP in a project for Claude Code

Arguments:
  path                Project root to analyze (default: current directory)

Options:
  -o, --output PATH   Output analysis JSON to a file
  --json              Output raw JSON to stdout (for CI/programmatic use)
  --max-files N       Maximum files to analyze (default: 5000)
  -h, --help          Show this help message

Examples:
  codesight .                           Analyze current directory
  codesight init ~/myproject            Register MCP for Claude Code
  codesight . --json > analysis.json    Export raw JSON for CI
  codesight . -o analysis.json          Write JSON to file
`);
    process.exit(0);
  } else if (args[i].startsWith("-")) {
    console.error(`Error: Unknown option "${args[i]}". Use --help for usage.`);
    process.exit(2);
  } else {
    projectPath = args[i];
  }
}

import { stat as fsStat } from "fs/promises";

const absoluteProjectPath = resolve(projectPath);

// Validate project path
try {
  const pathStat = await fsStat(absoluteProjectPath);
  if (!pathStat.isDirectory()) {
    console.error(`Error: "${projectPath}" is not a directory`);
    process.exit(2);
  }
} catch {
  console.error(`Error: "${projectPath}" does not exist`);
  process.exit(2);
}

const absoluteOutputPath = outputPath ? resolve(outputPath) : null;

// Build options
const options = { maxFiles };

try {
  const data = await analyze(absoluteProjectPath, options);
  const json = JSON.stringify(data, null, 2);

  if (jsonOutput) {
    process.stdout.write(json + "\n");
  } else if (absoluteOutputPath) {
    await writeFile(absoluteOutputPath, json);
    console.log(`\nOutput written to: ${absoluteOutputPath}`);
  } else {
    console.log(`\nAnalysis complete. Use --json or --output to export.`);
  }
} catch (err) {
  console.error("Analysis failed:", err.message);
  process.exit(1);
}
