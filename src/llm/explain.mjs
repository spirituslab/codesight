// Batch explanation generator for modules, files, and symbols

import { buildModuleExplanationPrompt, buildSymbolExplanationPrompt, buildArchitecturePrompt } from './prompts.mjs';

/**
 * Generate LLM explanations for all modules, files, and key symbols.
 * Mutates the result object in-place, adding `explanation` fields.
 */
export async function generateExplanations(result, client, options = {}) {
  const { maxConcurrent = 3, symbolThreshold = 2 } = options;

  // Phase 1: Module + file explanations (batched by module)
  console.log(`  Explaining ${result.modules.length} modules...`);
  const moduleQueue = [...result.modules];
  let completed = 0;

  async function processModule(mod) {
    try {
      const prompt = buildModuleExplanationPrompt(mod, result.edges, {
        callGraph: result.callGraph,
        impactMap: result.impactMap,
      });
      const response = await client.complete(prompt);
      const parsed = parseJSON(response);

      if (parsed) {
        mod.explanation = parsed.moduleExplanation || '';
        if (parsed.files) {
          for (const file of mod.files) {
            if (parsed.files[file.path]) {
              file.explanation = parsed.files[file.path];
            }
          }
        }
      }
    } catch (err) {
      console.warn(`  Warning: Failed to explain module "${mod.name}": ${err.message}`);
    }
    completed++;
    process.stdout.write(`\r  Modules: ${completed}/${result.modules.length}`);
  }

  // Process with concurrency limit
  await runWithConcurrency(moduleQueue, processModule, maxConcurrent);
  console.log('');

  // Phase 2: Key symbol explanations
  const keySymbols = collectKeySymbols(result, symbolThreshold);
  if (keySymbols.length > 0) {
    console.log(`  Explaining ${keySymbols.length} key symbols...`);
    const batches = chunk(keySymbols, 15);
    let symCompleted = 0;

    for (const batch of batches) {
      try {
        const prompt = buildSymbolExplanationPrompt(batch);
        const response = await client.complete(prompt);
        const parsed = parseJSON(response);

        if (parsed) {
          for (const sym of batch) {
            const key = `${sym._filePath}::${sym.name}`;
            if (parsed[key]) {
              sym.explanation = parsed[key];
            }
          }
        }
      } catch (err) {
        console.warn(`  Warning: Failed to explain symbol batch: ${err.message}`);
      }
      symCompleted += batch.length;
      process.stdout.write(`\r  Symbols: ${symCompleted}/${keySymbols.length}`);
    }
    console.log('');
  }

  // Clean up temporary fields
  for (const sym of keySymbols) {
    delete sym._filePath;
    delete sym._moduleName;
  }

  // Phase 3: Architecture overview
  console.log('  Generating architecture overview...');
  try {
    const prompt = buildArchitecturePrompt(result);
    const response = await client.complete(prompt);
    const parsed = parseJSON(response);
    if (parsed) {
      result.architecture = parsed;
    }
  } catch (err) {
    console.warn(`  Warning: Failed to generate architecture overview: ${err.message}`);
  }
}

/**
 * Collect symbols worth explaining: exported + referenced by >= threshold files.
 */
function collectKeySymbols(result, threshold) {
  const symbols = [];
  for (const mod of result.modules) {
    for (const file of mod.files) {
      for (const sym of file.symbols) {
        if (sym.exported && (sym.usedBy?.length || 0) >= threshold) {
          sym._filePath = file.path;
          sym._moduleName = mod.name;
          symbols.push(sym);
        }
      }
    }
  }
  return symbols;
}

/**
 * Run async tasks with a concurrency limit.
 */
async function runWithConcurrency(items, fn, limit) {
  const queue = [...items];
  const running = [];

  while (queue.length > 0 || running.length > 0) {
    while (running.length < limit && queue.length > 0) {
      const item = queue.shift();
      const promise = fn(item).then(() => {
        running.splice(running.indexOf(promise), 1);
      });
      running.push(promise);
    }
    if (running.length > 0) {
      await Promise.race(running);
    }
  }
}

/**
 * Parse JSON from LLM response, handling markdown code blocks.
 */
function parseJSON(text) {
  try {
    // Strip markdown code blocks if present
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON object from response
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        console.warn('  Warning: Could not parse LLM JSON response');
      }
    }
    return null;
  }
}

/**
 * Split array into chunks.
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
