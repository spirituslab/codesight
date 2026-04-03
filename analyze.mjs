#!/usr/bin/env node

import { writeFile } from "fs/promises";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "./src/env.mjs";
import { analyze } from "./src/analyzer/index.mjs";
import { createClient } from "./src/llm/client.mjs";

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));

// Arg parsing
const args = process.argv.slice(2);
let projectPath = ".";
let outputPath = null;
let jsonOutput = false;
let maxFiles = 5000;
let llmEnabled = false;
let llmProvider = null;
let llmModel = null;
let llmApiKey = null;
let serve = false;

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
  } else if (args[i] === "--serve" || args[i] === "-s") {
    serve = true;
  } else if (args[i] === "--llm") {
    llmEnabled = true;
  } else if (args[i] === "--llm-provider" && args[i + 1]) {
    llmProvider = args[++i];
    llmEnabled = true;
  } else if (args[i] === "--llm-model" && args[i + 1]) {
    llmModel = args[++i];
    llmEnabled = true;
  } else if (args[i] === "--llm-api-key" && args[i + 1]) {
    llmApiKey = args[++i];
    llmEnabled = true;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
codesight — Universal code structure visualization

Usage:
  codesight [path] [options]
  npx codesight [path] [options]

Arguments:
  path                Project root to analyze (default: current directory)

Options:
  -o, --output PATH   Output file path (default: <codesight>/web/data.js)
  --json              Output raw JSON to stdout (for CI/programmatic use)
  --max-files N       Maximum files to analyze (default: 5000)
  -s, --serve         Start the web server after analysis
  --llm               Enable LLM explanations and idea structure
  --llm-provider      LLM provider: claude or openai (default: claude)
  --llm-model         Model name (default: provider-specific)
  --llm-api-key       API key (or set env var)
  -h, --help          Show this help message

Environment variables:
  CODESIGHT_LLM_PROVIDER   LLM provider
  CODESIGHT_LLM_API_KEY    API key
  CODESIGHT_LLM_MODEL      Model name
  ANTHROPIC_API_KEY         Claude API key (fallback)
  OPENAI_API_KEY            OpenAI API key (fallback)

Examples:
  codesight .                           Analyze current directory
  codesight ~/myapp --llm               Analyze with LLM explanations
  codesight . --serve                   Analyze and open in browser
  codesight . --json > analysis.json    Export raw JSON for CI
  codesight . --max-files 1000          Limit to 1000 files
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

const defaultOutput = join(__dirname, "web", "data.js");
const absoluteOutputPath = resolve(outputPath || defaultOutput);

// Build options
const options = { maxFiles };

if (llmEnabled) {
  const client = createClient({
    provider: llmProvider,
    apiKey: llmApiKey,
    model: llmModel,
  });

  if (!client) {
    console.warn("Warning: --llm enabled but no API key found. Skipping LLM features.");
    console.warn("Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or pass --llm-api-key.");
  } else {
    options.llm = client;
    console.log(`LLM: ${client.provider} / ${client.model}`);
  }
}

try {
  const data = await analyze(absoluteProjectPath, options);
  const json = JSON.stringify(data, null, 2);

  if (jsonOutput) {
    process.stdout.write(json + "\n");
  } else {
    await writeFile(absoluteOutputPath, `window.CODEBASE_DATA = ${json};\n`);
    console.log(`\nOutput written to: ${absoluteOutputPath}`);

    if (serve) {
      // Start the web server
      const { execSync } = await import("child_process");
      console.log(`\nStarting server...`);
      execSync(`node ${join(__dirname, "serve.mjs")}`, { stdio: "inherit" });
    } else {
      console.log(`\nTo view: cd ${__dirname} && node serve.mjs`);
    }
  }
} catch (err) {
  console.error("Analysis failed:", err.message);
  process.exit(1);
}
