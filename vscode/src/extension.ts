import * as vscode from 'vscode';
import { AnalyzerWrapper } from './analyzer';
import { WebviewManager } from './webview';
import { setupNavigation } from './navigation';
import { registerChatParticipant } from './chat-participant';
import { setupFileWatcher } from './watcher';
import { generateIdeaLayer } from './idea-layer';
import * as fs from 'fs';
import * as path from 'path';

let analyzer: AnalyzerWrapper | null = null;
let webviewManager: WebviewManager;
let fileWatcherDisposable: vscode.Disposable | null = null;

function getWorkspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
}

function mergeIdeaStructure(result: any) {
  const root = getWorkspaceRoot();
  if (!root || !result) return;
  try {
    const ideaFile = path.join(root, '.codesight', 'idea-structure.json');
    if (fs.existsSync(ideaFile)) {
      const ideaStructure = JSON.parse(fs.readFileSync(ideaFile, 'utf-8'));
      if (ideaStructure.nodes) {
        result.ideaStructure = ideaStructure;
      }
    }
  } catch (err) {
    console.warn('[codesight] Failed to merge idea structure:', err);
  }
}

function ensureAnalyzer(): AnalyzerWrapper | null {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage('Codesight: Please open a folder first.');
    return null;
  }
  if (!analyzer) {
    analyzer = new AnalyzerWrapper(root);
  }
  return analyzer;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('[codesight] Extension activating...');

  webviewManager = new WebviewManager(context.extensionUri);

  // Always register commands, regardless of workspace state
  context.subscriptions.push(
    vscode.commands.registerCommand('codesight.openGraph', async () => {
      const a = ensureAnalyzer();
      if (!a) return;

      const panel = webviewManager.createOrShow(context);
      if (!a.getResult()) {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Codesight: Analyzing project...' },
          async () => { await a.runFullAnalysis(); }
        );
      }
      const result = a.getResult();
      if (result) {
        mergeIdeaStructure(result);
        webviewManager.postMessage({ type: 'updateData', data: result });
      } else {
        vscode.window.showErrorMessage('Codesight: Analysis failed. Check the Output panel for details.');
      }
    }),

    vscode.commands.registerCommand('codesight.refresh', async () => {
      const a = ensureAnalyzer();
      if (!a) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Codesight: Refreshing analysis...' },
        async () => { await a.runFullAnalysis(); }
      );
      const result = a.getResult();
      if (result) {
        mergeIdeaStructure(result);
        webviewManager.postMessage({ type: 'updateData', data: result });
      }
    }),

    vscode.commands.registerCommand('codesight.generateIdeaLayer', async () => {
      vscode.window.showInformationMessage('Codesight: Starting idea layer generation...');
      const a = ensureAnalyzer();
      if (!a) {
        vscode.window.showErrorMessage('Codesight: No analyzer available.');
        return;
      }

      if (!a.getResult()) {
        vscode.window.showWarningMessage('Codesight: Run "Open Graph" first to analyze the project.');
        return;
      }
      await generateIdeaLayer(a, webviewManager);
    }),

    vscode.commands.registerCommand('codesight.revealInGraph', () => {
      const root = getWorkspaceRoot();
      if (!root || !analyzer) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const filePath = editor.document.uri.fsPath;
      const line = editor.selection.active.line + 1;
      setupNavigation.revealInGraph(filePath, line, analyzer, webviewManager, root);
    })
  );

  // Set up webview message handler
  webviewManager.onMessage((msg) => {
    const root = getWorkspaceRoot();
    if (msg.type === 'openFile' && root) {
      setupNavigation.openFile(msg.path, msg.line, root);
    } else if (msg.type === 'ready' && analyzer) {
      const result = analyzer.getResult();
      if (result) {
        mergeIdeaStructure(result);
        webviewManager.postMessage({ type: 'updateData', data: result });
      }
    } else if (msg.type === 'chatRequest') {
      handleChatRequest(msg, analyzer, webviewManager);
    } else if (msg.type === 'requestRefresh') {
      vscode.commands.executeCommand('codesight.refresh');
    }
  });

  // Set up workspace-dependent features if a folder is open
  const root = getWorkspaceRoot();
  if (root) {
    analyzer = new AnalyzerWrapper(root);
    fileWatcherDisposable = setupFileWatcher(context, analyzer, webviewManager);

    try {
      if (vscode.chat?.createChatParticipant) {
        registerChatParticipant(context, analyzer);
      }
    } catch (err) {
      console.warn('[codesight] Failed to register chat participant:', err);
    }
  }

  // Re-initialize when workspace folders change
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newRoot = getWorkspaceRoot();
      // Dispose old watcher before creating a new one
      if (fileWatcherDisposable) {
        fileWatcherDisposable.dispose();
        fileWatcherDisposable = null;
      }
      if (newRoot) {
        analyzer = new AnalyzerWrapper(newRoot);
        fileWatcherDisposable = setupFileWatcher(context, analyzer, webviewManager);
      } else {
        analyzer = null;
      }
    })
  );

  console.log('[codesight] Extension activated successfully');
}

export function deactivate() {
  analyzer = null;
}

// ─── Chat request handler (vscode.lm only) ──────────────────────

async function handleChatRequest(msg: any, analyzer: AnalyzerWrapper | null, webviewManager: WebviewManager) {
  const { message, context, history } = msg;

  // Build context string from what the user is looking at
  let contextText = '';
  if (context?.ideaNode) {
    contextText += `Concept: ${context.ideaNode.label}\nDescription: ${context.ideaNode.description}\n`;
    if (context.ideaNode.codeRefs?.length) {
      contextText += `Code refs: ${context.ideaNode.codeRefs.map((r: any) => r.type === 'module' ? r.name : r.path).join(', ')}\n`;
    }
  }
  if (context?.focusedNode) {
    const fn = context.focusedNode;
    contextText += `Focused ${fn.type}: ${fn.data?.name || fn.data?.path || ''}\n`;
    if (fn.data?.description) contextText += `Description: ${fn.data.description}\n`;
    if (fn.data?.signature) contextText += `Signature: ${fn.data.signature}\n`;
  }
  if (context?.currentFile) contextText += `Current file: ${context.currentFile}\n`;
  if (context?.currentModule) contextText += `Current module: ${context.currentModule}\n`;

  // Add project context
  const result = analyzer?.getResult();
  if (result) {
    contextText += `\nProject: ${result.projectName} (${result.modules?.length || 0} modules, ${result.languages?.join(', ')})\n`;
    contextText += `Modules: ${result.modules?.map((m: any) => m.name).join(', ')}\n`;
  }

  // Try vscode.lm
  try {
    const models = await vscode.lm.selectChatModels();
    if (models && models.length > 0) {
      const model = models[0];
      const messages = [
        vscode.LanguageModelChatMessage.User(
          `You are a code assistant for the "${result?.projectName || 'unknown'}" project.\n\nContext:\n${contextText}\n\n${history?.slice(-6).map((h: any) => `${h.role}: ${h.content}`).join('\n') || ''}\n\nUser: ${message}`
        ),
      ];

      const response = await model.sendRequest(messages);
      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
      }

      webviewManager.postMessage({
        type: 'chatResponse',
        text,
        model: model.name || model.id,
        originalMessage: message,
      });
      return;
    }
  } catch (_) {
    // vscode.lm not available
  }

  // No LLM available — show helpful error
  webviewManager.postMessage({
    type: 'chatResponse',
    error: 'No language model available. Install GitHub Copilot (or another vscode.lm extension) to use chat, or use Claude Code with MCP for AI features.',
  });
}
