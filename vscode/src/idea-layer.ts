import * as vscode from 'vscode';
import * as path from 'path';
import { AnalyzerWrapper } from './analyzer';
import { WebviewManager } from './webview';

let output: vscode.OutputChannel;
function getOutput() {
  if (!output) output = vscode.window.createOutputChannel('Codesight');
  return output;
}

/**
 * Generate the idea layer using whatever LLM the user has installed in VS Code.
 * Reuses the same prompt logic as codesight's --llm mode, but routes through
 * vscode.lm instead of a direct API call.
 */
export async function generateIdeaLayer(
  analyzer: AnalyzerWrapper,
  webviewManager: WebviewManager
): Promise<void> {
  const log = getOutput();
  log.show(true);
  log.appendLine('[idea-layer] Starting idea layer generation...');

  const result = analyzer.getResult();
  if (!result) {
    vscode.window.showWarningMessage('Codesight: Run analysis first (Open Graph).');
    return;
  }

  // Find an available language model
  let model: vscode.LanguageModelChat;
  try {
    if (!vscode.lm) {
      vscode.window.showErrorMessage(
        'Codesight: Language Model API not available. Requires VS Code 1.90+ with a language model extension (Copilot, Claude, etc.).'
      );
      return;
    }
    log.appendLine('[idea-layer] Querying available models...');
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
    const allModels = await Promise.race([vscode.lm.selectChatModels(), timeout]);

    if (!allModels || allModels.length === 0) {
      log.appendLine('[idea-layer] No models found (timed out or none registered)');
      log.show();
      vscode.window.showErrorMessage(
        'Codesight: No language model found. Install and sign into GitHub Copilot (github.copilot) — it provides the vscode.lm API. Copilot Chat alone is not sufficient.'
      );
      return;
    }
    log.appendLine(`[idea-layer] Found ${allModels.length} models: ${allModels.map((m: any) => m.name).join(', ')}`);
    model = allModels[0];
    log.appendLine(`[idea-layer] Using model: ${model.name} (${(model as any).vendor})`);
  } catch (err: any) {
    log.appendLine(`[idea-layer] LM API error: ${err.message}\n${err.stack || ''}`);
    vscode.window.showErrorMessage(`Codesight: LM API error: ${err.message}`);
    return;
  }

  // Build the prompt (same logic as src/llm/prompts.mjs buildIdeaStructurePrompt)
  const prompt = buildIdeaStructurePrompt(result);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Codesight: Generating idea layer...', cancellable: true },
    async (progress, token) => {
      try {
        const messages = [
          vscode.LanguageModelChatMessage.User(
            prompt.system + '\n\n' + prompt.user
          ),
        ];

        log.appendLine('[idea-layer] Sending request to model...');
        const response = await model.sendRequest(messages, {}, token);

        // Collect the full response
        let fullText = '';
        for await (const fragment of response.text) {
          fullText += fragment;
        }
        log.appendLine(`[idea-layer] Response received (${fullText.length} chars)`);

        // Parse JSON from the response
        const parsed = parseJSON(fullText);
        if (!parsed || !parsed.nodes) {
          log.appendLine('[idea-layer] Failed to parse response:\n' + fullText.slice(0, 1000));
          log.show();
          vscode.window.showErrorMessage('Codesight: LLM returned an invalid idea structure. Check Output panel (Codesight) for details.');
          return;
        }

        // Validate code references against actual analysis data
        const validated = validateIdeaStructure(parsed, result);

        // Send to webview — spread into a new object so the store
        // detects a change (store.set compares by reference).
        result.ideaStructure = validated;
        webviewManager.postMessage({ type: 'updateData', data: { ...result } });

        vscode.window.showInformationMessage('Codesight: Idea layer generated successfully.');
      } catch (err: any) {
        log.appendLine(`[idea-layer] Error: ${err?.code} ${err?.message}\n${err?.stack || ''}`);
        log.show();
        if (err.code === 'NoPermissions') {
          const action = await vscode.window.showWarningMessage(
            'Codesight: Language model access was denied. Please allow access when prompted.',
            'Try Again'
          );
          if (action === 'Try Again') {
            vscode.commands.executeCommand('codesight.generateIdeaLayer');
          }
        } else if (token.isCancellationRequested) {
          // User cancelled
        } else {
          vscode.window.showErrorMessage(`Codesight: Idea layer generation failed: ${err.message}. Check Output panel (Codesight).`);
        }
      }
    }
  );
}

/**
 * Build the idea structure prompt from analysis data.
 * Mirrors src/llm/prompts.mjs:buildIdeaStructurePrompt but returns
 * separate system/user strings for the vscode.lm API.
 */
function buildIdeaStructurePrompt(result: any): { system: string; user: string } {
  const { projectName, modules, edges, keyFiles, languages } = result;

  const modulesSummary = (modules || []).map((m: any) => {
    const desc = m.explanation || m.description || '';
    const files = (m.files || []).slice(0, 8).map((f: any) =>
      `    ${f.path}${f.explanation ? ': ' + f.explanation : ''}`
    ).join('\n');
    return `  ${m.name} (${m.files?.length || 0} files, ${m.lineCount || 0} lines): ${desc}\n${files}`;
  }).join('\n\n');

  const edgesSummary = (edges || [])
    .filter((e: any) => e.target !== 'external')
    .slice(0, 30)
    .map((e: any) => `  ${e.source} → ${e.target} (${e.weight} imports)`)
    .join('\n');

  const keyFilesSummary = (keyFiles || []).slice(0, 15).map((f: any) =>
    `  ${f.path} (imported by ${f.importedByCount} files${f.isEntryPoint ? ', entry point' : ''})`
  ).join('\n');

  const validModules = (modules || []).map((m: any) => m.name);

  const system = `You are a software architect who explains projects conceptually. Your job is to create an "idea structure" — a conceptual map of what a project does, organized by concepts and purposes rather than file paths.

Each idea node represents a concept, feature, or responsibility. Map each idea to actual code (modules, files, symbols) that implements it.

IMPORTANT:
- Only reference code that exists in the provided data
- Valid module names: ${JSON.stringify(validModules)}
- Create 5-15 idea nodes depending on project complexity
- Create edges between ideas that have relationships (e.g., "feeds into", "depends on", "protects")
- All ideas should be at the same level — no parent-child nesting, no hierarchy
- The idea structure should help someone understand WHAT the project does before HOW it's implemented`;

  const user = `Create an idea structure for this project.

Project: ${projectName || 'Unknown'}
Languages: ${(languages || []).join(', ')}

Modules:
${modulesSummary}

Dependencies:
${edgesSummary}

Key files:
${keyFilesSummary}

Respond in JSON format:
{
  "projectSummary": "2-3 sentence high-level description of what this project does and its purpose",
  "nodes": [
    {
      "id": "idea:<kebab-case-id>",
      "label": "Human Readable Concept Name",
      "description": "1-2 sentence description of this concept/feature",
      "codeRefs": [
        { "type": "module", "name": "<module-name>" },
        { "type": "file", "path": "<file-path>" },
        { "type": "symbol", "path": "<file-path>", "name": "<symbol-name>" }
      ]
    }
  ],
  "edges": [
    { "source": "idea:<id>", "target": "idea:<id>", "label": "relationship description" }
  ]
}

Only use module names and file paths from the data above. Keep it conceptual — group by purpose, not by file structure.`;

  return { system, user };
}

/**
 * Validate idea structure: remove hallucinated code references.
 * Mirrors src/llm/ideas.mjs:validateIdeaStructure
 */
function validateIdeaStructure(idea: any, result: any): any {
  const validModules = new Set((result.modules || []).map((m: any) => m.name));
  const validFiles = new Set((result.modules || []).flatMap((m: any) => (m.files || []).map((f: any) => f.path)));
  const validSymbols = new Set((result.modules || []).flatMap((m: any) =>
    (m.files || []).flatMap((f: any) =>
      (f.symbols || []).filter((s: any) => s.exported).map((s: any) => `${f.path}::${s.name}`)
    )
  ));

  if (result.rootFiles) {
    for (const f of result.rootFiles) {
      validFiles.add(f.path);
      for (const s of (f.symbols || []).filter((s: any) => s.exported)) {
        validSymbols.add(`${f.path}::${s.name}`);
      }
    }
  }

  const nodeIds = new Set(idea.nodes.map((n: any) => n.id));
  let removedRefs = 0;
  let totalRefs = 0;

  for (const node of idea.nodes) {
    delete node.parentId;

    if (node.codeRefs) {
      totalRefs += node.codeRefs.length;
      node.codeRefs = node.codeRefs.filter((ref: any) => {
        if (ref.type === 'module' && validModules.has(ref.name)) return true;
        if (ref.type === 'file' && validFiles.has(ref.path)) return true;
        if (ref.type === 'symbol' && validSymbols.has(`${ref.path}::${ref.name}`)) return true;
        removedRefs++;
        return false;
      });
    }
  }

  if (idea.edges) {
    idea.edges = idea.edges.filter((e: any) => nodeIds.has(e.source) && nodeIds.has(e.target));
  }

  if (removedRefs > 0) {
    console.log(`[codesight] Removed ${removedRefs}/${totalRefs} hallucinated code references from idea structure`);
  }

  return idea;
}

/**
 * Parse JSON from LLM response, handling markdown code blocks.
 */
function parseJSON(text: string): any {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return null;
  }
}
