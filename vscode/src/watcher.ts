import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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

  // Helper: merge idea structure from file into analysis result
  const mergeIdeaStructure = (result: any) => {
    if (!workspaceRoot || !result) return;
    const ideaFile = path.join(workspaceRoot, '.codesight', 'idea-structure.json');
    try {
      if (fs.existsSync(ideaFile)) {
        const ideaStructure = JSON.parse(fs.readFileSync(ideaFile, 'utf-8'));
        if (ideaStructure.nodes) {
          result.ideaStructure = ideaStructure;
        }
      }
    } catch (_) {}
  };

  // Watch for source file saves → re-analyze
  const saveDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
    const ext = '.' + document.fileName.split('.').pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const result = await analyzer.runIncrementalUpdate(document.fileName);
      if (result) {
        mergeIdeaStructure(result);
        webviewManager.postMessage({ type: 'updateData', data: result });
      }
    }, 500);
  });

  context.subscriptions.push(saveDisposable);

  // Watch for .codesight/idea-structure.json → load idea layer
  // This is the bridge from Claude Code MCP to the VS Code webview
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    const ideaFile = path.join(workspaceRoot, '.codesight', 'idea-structure.json');
    const ideaDir = path.join(workspaceRoot, '.codesight');

    // Create a file system watcher for the idea structure file
    const pattern = new vscode.RelativePattern(workspaceRoot, '.codesight/idea-structure.json');
    const ideaWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    const loadIdeaStructure = () => {
      try {
        if (!fs.existsSync(ideaFile)) return;
        const content = fs.readFileSync(ideaFile, 'utf-8');
        const ideaStructure = JSON.parse(content);

        if (!ideaStructure.nodes) return;

        // Merge with existing analysis result
        const result = analyzer.getResult();
        if (result) {
          result.ideaStructure = ideaStructure;
          webviewManager.postMessage({ type: 'updateData', data: result });
          console.log(`[codesight] Loaded idea layer: ${ideaStructure.nodes.length} concepts`);
        }
      } catch (err: any) {
        console.error('[codesight] Failed to load idea structure:', err.message);
      }
    };

    context.subscriptions.push(
      ideaWatcher.onDidCreate(loadIdeaStructure),
      ideaWatcher.onDidChange(loadIdeaStructure),
      ideaWatcher
    );

    // Also load on startup if the file already exists
    loadIdeaStructure();
  }
}
