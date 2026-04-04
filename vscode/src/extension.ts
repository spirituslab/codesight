import * as vscode from 'vscode';
import { AnalyzerWrapper } from './analyzer';
import { WebviewManager } from './webview';
import { setupNavigation } from './navigation';
import { registerChatParticipant } from './chat-participant';
import { setupFileWatcher } from './watcher';
import { generateIdeaLayer } from './idea-layer';

let analyzer: AnalyzerWrapper | null = null;
let webviewManager: WebviewManager;

function getWorkspaceRoot(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
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
        webviewManager.postMessage({ type: 'updateData', data: result });
      }
    }),

    vscode.commands.registerCommand('codesight.generateIdeaLayer', async () => {
      const a = ensureAnalyzer();
      if (!a) return;

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
    setupFileWatcher(context, analyzer, webviewManager);

    try {
      if (vscode.chat?.createChatParticipant) {
        registerChatParticipant(context, analyzer);
      }
    } catch (_) {}
  }

  console.log('[codesight] Extension activated successfully');
}

export function deactivate() {}
