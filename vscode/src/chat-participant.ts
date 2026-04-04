import * as vscode from 'vscode';
import { AnalyzerWrapper } from './analyzer';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  analyzer: AnalyzerWrapper
) {
  const participant = vscode.chat.createChatParticipant('codesight', async (request, chatContext, stream, token) => {
    const result = analyzer.getResult();
    if (!result) {
      stream.markdown('Codesight analysis has not been run yet. Open the graph first with **Codesight: Open Graph** command.');
      return;
    }

    const prompt = request.prompt.toLowerCase();

    // Build context based on question type
    let contextText = buildBaselineContext(result);

    if (isModuleQuestion(prompt)) {
      contextText += buildModuleContext(prompt, result);
    } else if (isImpactQuestion(prompt)) {
      contextText += buildImpactContext(prompt, result);
    } else if (isCallChainQuestion(prompt)) {
      contextText += buildCallChainContext(prompt, result);
    } else {
      // General question — include overview
      contextText += buildOverviewContext(result);
    }

    // Use the available language model
    const messages = [
      vscode.LanguageModelChatMessage.User(
        `You are a code structure expert. Use the following structural analysis data to answer the user's question about their codebase.\n\n${contextText}\n\nUser question: ${request.prompt}`
      ),
    ];

    try {
      const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
      const model = models[0] ?? (await vscode.lm.selectChatModels())[0];

      if (!model) {
        stream.markdown('No language model available. Please ensure you have GitHub Copilot or another LLM extension installed.');
        return;
      }

      const chatResponse = await model.sendRequest(messages, {}, token);
      for await (const fragment of chatResponse.text) {
        stream.markdown(fragment);
      }
    } catch (err: any) {
      if (err.code === 'NoPermissions') {
        stream.markdown('Codesight needs permission to access the language model. Please allow access when prompted.');
      } else {
        stream.markdown(`Error: ${err.message || 'Failed to get response from language model.'}`);
      }
    }
  });

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');

  context.subscriptions.push(participant);
}

function buildBaselineContext(result: any): string {
  const modules = result.modules || [];
  const languages = result.languages || [];
  const totalFiles = modules.reduce((sum: number, m: any) => sum + (m.files?.length || 0), 0);
  const totalSymbols = modules.reduce((sum: number, m: any) =>
    sum + (m.files || []).reduce((s: number, f: any) => s + (f.symbols?.length || 0), 0), 0);

  return `## Project: ${result.projectName || 'Unknown'}
- Languages: ${languages.join(', ')}
- Modules: ${modules.length}
- Files: ${totalFiles}
- Symbols: ${totalSymbols}
- Entry points: ${(result.keyFiles || []).map((f: any) => f.path).join(', ') || 'none detected'}

`;
}

function buildModuleContext(prompt: string, result: any): string {
  const modules = result.modules || [];
  let context = '## Module Details\n\n';

  // Try to find which module the user is asking about
  const matchedModule = modules.find((m: any) =>
    prompt.includes(m.name.toLowerCase())
  );

  if (matchedModule) {
    context += `### Module: ${matchedModule.name}\n`;
    context += `- Path: ${matchedModule.path}\n`;
    context += `- Description: ${matchedModule.description || 'N/A'}\n`;
    context += `- Files: ${matchedModule.files?.length || 0}\n`;
    context += `- Lines: ${matchedModule.lineCount || 0}\n\n`;
    context += `**Files:**\n`;
    for (const file of (matchedModule.files || []).slice(0, 20)) {
      context += `- ${file.path} (${file.symbols?.length || 0} symbols)\n`;
      for (const sym of (file.symbols || []).slice(0, 10)) {
        context += `  - ${sym.kind}: ${sym.name}${sym.exported ? ' (exported)' : ''}\n`;
      }
    }
  } else {
    // List all modules
    context += 'Available modules:\n';
    for (const mod of modules) {
      context += `- **${mod.name}** (${mod.files?.length || 0} files, ${mod.lineCount || 0} lines): ${mod.description || ''}\n`;
    }
  }

  return context + '\n';
}

function buildImpactContext(prompt: string, result: any): string {
  const impactMap = result.impactMap || {};
  let context = '## Impact Analysis\n\n';

  // Try to find which file/symbol the user is asking about
  const keys = Object.keys(impactMap);
  const matched = keys.find(k => prompt.includes(k.toLowerCase().split('/').pop()!.replace(/\.\w+$/, '')));

  if (matched) {
    const impact = impactMap[matched];
    context += `### Impact of ${matched}\n`;
    context += `- Direct dependents: ${impact.directDependents?.length || 0}\n`;
    for (const dep of (impact.directDependents || []).slice(0, 15)) {
      context += `  - ${dep}\n`;
    }
    context += `- Transitive dependents: ${impact.transitiveDependents?.length || 0}\n`;
    for (const dep of (impact.transitiveDependents || []).slice(0, 15)) {
      context += `  - ${dep}\n`;
    }
    context += `- Risk score: ${impact.riskScore || 'N/A'}\n`;
  } else {
    // Show highest-impact files
    const sorted = keys
      .map(k => ({ path: k, count: impactMap[k].transitiveDependents?.length || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    context += 'Highest-impact files:\n';
    for (const item of sorted) {
      context += `- ${item.path} (${item.count} transitive dependents)\n`;
    }
  }

  return context + '\n';
}

function buildCallChainContext(prompt: string, result: any): string {
  const callGraph = result.callGraph || { edges: [] };
  let context = `## Call Graph\n\nTotal edges: ${callGraph.edges?.length || 0}\n\n`;

  // Show a sample of call graph edges relevant to the question
  const edges = callGraph.edges || [];
  const relevantEdges = edges.filter((e: any) =>
    prompt.includes(e.from?.toLowerCase()) || prompt.includes(e.to?.toLowerCase())
  );

  if (relevantEdges.length > 0) {
    context += 'Relevant call relationships:\n';
    for (const edge of relevantEdges.slice(0, 30)) {
      context += `- ${edge.from} → ${edge.to} (${edge.confidence || 'unknown'} confidence)\n`;
    }
  } else {
    context += 'Sample call relationships:\n';
    for (const edge of edges.slice(0, 20)) {
      context += `- ${edge.from} → ${edge.to}\n`;
    }
  }

  return context + '\n';
}

function buildOverviewContext(result: any): string {
  const modules = result.modules || [];
  let context = '## Project Overview\n\n';
  context += 'Modules:\n';
  for (const mod of modules.slice(0, 15)) {
    context += `- **${mod.name}** (${mod.files?.length || 0} files): ${mod.description || ''}\n`;
  }

  const edges = result.edges || [];
  if (edges.length > 0) {
    context += '\nModule dependencies:\n';
    for (const edge of edges.slice(0, 20)) {
      context += `- ${edge.source} → ${edge.target} (weight: ${edge.weight})\n`;
    }
  }

  return context + '\n';
}

function isModuleQuestion(prompt: string): boolean {
  return /\b(module|package|folder|directory|component)\b/.test(prompt);
}

function isImpactQuestion(prompt: string): boolean {
  return /\b(impact|break|change|affect|depend|risk)\b/.test(prompt);
}

function isCallChainQuestion(prompt: string): boolean {
  return /\b(call|chain|invoke|flow|trace|path)\b/.test(prompt);
}
