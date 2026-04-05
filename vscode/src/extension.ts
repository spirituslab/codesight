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
