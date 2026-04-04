import * as vscode from 'vscode';
import { AnalyzerWrapper } from './analyzer';
import { WebviewManager } from './webview';

const SUPPORTED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py',
  '.c', '.h',
  '.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx',
  '.java',
]);

export function setupFileWatcher(
  context: vscode.ExtensionContext,
  analyzer: AnalyzerWrapper,
  webviewManager: WebviewManager
) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const disposable = vscode.workspace.onDidSaveTextDocument((document) => {
    const ext = '.' + document.fileName.split('.').pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return;

    // Debounce rapid saves (500ms)
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const result = await analyzer.runIncrementalUpdate(document.fileName);
      if (result) {
        webviewManager.postMessage({ type: 'updateData', data: result });
      }
    }, 500);
  });

  context.subscriptions.push(disposable);
}
