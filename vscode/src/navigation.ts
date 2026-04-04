import * as vscode from 'vscode';
import * as path from 'path';
import { AnalyzerWrapper } from './analyzer';
import { WebviewManager } from './webview';

export const setupNavigation = {
  /**
   * Graph → Editor: Open a file at a specific line in VS Code.
   */
  openFile(filePath: string, line: number, workspaceRoot: string) {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);
    const uri = vscode.Uri.file(absPath);
    const position = new vscode.Position(Math.max(0, line - 1), 0);
    const range = new vscode.Range(position, position);

    vscode.window.showTextDocument(uri, {
      selection: range,
      viewColumn: vscode.ViewColumn.One,
    });
  },

  /**
   * Editor → Graph: Reveal a symbol from the editor in the graph.
   */
  revealInGraph(
    filePath: string,
    line: number,
    analyzer: AnalyzerWrapper,
    webviewManager: WebviewManager,
    workspaceRoot: string
  ) {
    const symbol = analyzer.findSymbolAtLine(filePath, line);
    if (!symbol) {
      vscode.window.showInformationMessage('Codesight: No symbol found at cursor position.');
      return;
    }

    const relPath = path.relative(workspaceRoot, filePath);

    // Build a node ID that matches the graph's element IDs
    // The graph uses file path + symbol name for L4 symbol nodes
    const nodeId = `${relPath}:${symbol.name}`;

    webviewManager.postMessage({ type: 'highlightNode', nodeId });
  },
};
