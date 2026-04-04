import * as vscode from 'vscode';
import * as path from 'path';

export class WebviewManager {
  private panel: vscode.WebviewPanel | null = null;
  private extensionUri: vscode.Uri;
  private messageHandlers: Array<(msg: any) => void> = [];

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  createOrShow(context: vscode.ExtensionContext): vscode.WebviewPanel {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return this.panel;
    }

    this.panel = vscode.window.createWebviewPanel(
      'codesightGraph',
      'Codesight Graph',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'web'),
          vscode.Uri.joinPath(this.extensionUri, 'media'),
        ],
      }
    );

    this.panel.webview.html = this.getWebviewContent(this.panel.webview);

    // Forward messages from webview to registered handlers
    this.panel.webview.onDidReceiveMessage((msg) => {
      for (const handler of this.messageHandlers) {
        handler(msg);
      }
    }, null, context.subscriptions);

    this.panel.onDidDispose(() => {
      this.panel = null;
    }, null, context.subscriptions);

    return this.panel;
  }

  postMessage(msg: any) {
    this.panel?.webview.postMessage(msg);
  }

  onMessage(handler: (msg: any) => void) {
    this.messageHandlers.push(handler);
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const webDir = vscode.Uri.joinPath(this.extensionUri, 'web');

    // For the web UI source files
    const webSrcUri = webview.asWebviewUri(vscode.Uri.joinPath(webDir, 'src'));

    // CSP: allow local webview resources, CDN scripts, and unsafe-inline for Lit styles
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src ${webview.cspSource} https://esm.run https://cdn.jsdelivr.net https://cdnjs.cloudflare.com 'unsafe-inline';
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} https: data:;
    font-src ${webview.cspSource};
    connect-src https://esm.run https://cdn.jsdelivr.net;
  ">
  <title>Codesight Graph</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.4/cytoscape.min.js"></script>
  <script type="importmap">
  {
    "imports": {
      "lit": "https://esm.run/lit@3",
      "lit/": "https://esm.run/lit@3/",
      "@lit/reactive-element": "https://esm.run/@lit/reactive-element@2",
      "@lit/reactive-element/": "https://esm.run/@lit/reactive-element@2/",
      "lit-html": "https://esm.run/lit-html@3",
      "lit-html/": "https://esm.run/lit-html@3/",
      "lit-element/": "https://esm.run/lit-element@4/"
    }
  }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1e1e2e; height: 100vh; overflow: hidden; }
  </style>
</head>
<body>
  <cs-app>
    <cs-sidebar slot="sidebar">
      <cs-explorer slot="explorer"></cs-explorer>
      <cs-search-panel slot="search"></cs-search-panel>
      <cs-tour-panel slot="tours"></cs-tour-panel>
    </cs-sidebar>
    <cs-graph slot="graph"></cs-graph>
    <cs-chat slot="chat"></cs-chat>
  </cs-app>
  <cs-global-search></cs-global-search>
  <cs-code-popup></cs-code-popup>
  <script>
    // Set flags SYNCHRONOUSLY before any modules load
    window.__CODESIGHT_VSCODE__ = acquireVsCodeApi();
    window.__CODESIGHT_WEBVIEW__ = true;
  </script>
  <script type="module">
    // Import all components
    import '${webSrcUri}/components/cs-app.js';
    import '${webSrcUri}/components/cs-graph.js';
    import '${webSrcUri}/components/cs-sidebar.js';
    import '${webSrcUri}/components/cs-chat.js';
    import '${webSrcUri}/components/cs-global-search.js';
    import '${webSrcUri}/components/cs-code-popup.js';
    import '${webSrcUri}/panels/cs-explorer.js';
    import '${webSrcUri}/panels/cs-search-panel.js';
    import '${webSrcUri}/panels/cs-tour-panel.js';
  </script>
</body>
</html>`;
  }
}
