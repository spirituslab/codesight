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
    } else if (msg.type === 'chatRequest') {
      handleChatRequest(msg, analyzer, webviewManager);
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

async function handleChatRequest(
  msg: any,
  analyzerInstance: AnalyzerWrapper | null,
  webview: WebviewManager
) {
  const { message, context, history } = msg;
  const result = analyzerInstance?.getResult();

  // Build context string
  let contextText = '';
  if (context.ideaNode) {
    contextText += `The user is asking about the concept "${context.ideaNode.label}": ${context.ideaNode.description}\n`;
    if (context.ideaNode.codeRefs?.length) {
      contextText += `Related code: ${context.ideaNode.codeRefs.map((r: any) =>
        r.type === 'module' ? `module:${r.name}` : r.path
      ).join(', ')}\n`;
    }
  }
  if (context.currentFile && result) {
    // Find file details
    for (const mod of result.modules || []) {
      const file = mod.files?.find((f: any) => f.path === context.currentFile);
      if (file) {
        contextText += `Currently viewing: ${file.path} in module ${mod.name}\n`;
        contextText += `Symbols: ${file.symbols?.map((s: any) => `${s.kind} ${s.name}`).join(', ')}\n`;
        break;
      }
    }
  }
  if (result) {
    contextText += `Project: ${result.projectName}, ${result.modules?.length} modules, ${result.languages?.join(', ')}\n`;
  }

  // Try vscode.lm first
  try {
    const models = await vscode.lm.selectChatModels();
    if (models && models.length > 0) {
      const model = models[0];
      const prompt = `You are a code structure expert. Use this context to answer the user's question.\n\n${contextText}\n\nUser: ${message}`;
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const response = await model.sendRequest(messages, {});
      let fullText = '';
      for await (const fragment of response.text) {
        fullText += fragment;
      }
      webview.postMessage({ type: 'chatResponse', text: fullText, originalMessage: message });
      return;
    }
  } catch (_) {
    // vscode.lm not available — fall back to MCP file bridge
  }

  // Fall back: write chat request to .codesight/chat-request.json for MCP bridge
  const root = getWorkspaceRoot();
  if (root) {
    const fs = require('fs');
    const path = require('path');
    const outDir = path.join(root, '.codesight');
    fs.mkdirSync(outDir, { recursive: true });
    const requestFile = path.join(outDir, 'chat-request.json');
    fs.writeFileSync(requestFile, JSON.stringify({
      message,
      context: contextText,
      history: history?.slice(-6),
      timestamp: Date.now(),
    }, null, 2));

    // Watch for response file
    const responseFile = path.join(outDir, 'chat-response.json');
    // Delete old response if exists
    try { fs.unlinkSync(responseFile); } catch (_) {}

    // Poll for response (up to 60 seconds)
    const startTime = Date.now();
    const poll = setInterval(() => {
      try {
        if (fs.existsSync(responseFile)) {
          const data = JSON.parse(fs.readFileSync(responseFile, 'utf-8'));
          if (data.timestamp > startTime) {
            clearInterval(poll);
            webview.postMessage({ type: 'chatResponse', text: data.text, originalMessage: message });
            try { fs.unlinkSync(responseFile); } catch (_) {}
          }
        }
      } catch (_) {}
      if (Date.now() - startTime > 60000) {
        clearInterval(poll);
        webview.postMessage({
          type: 'chatResponse',
          error: 'No LLM available. Use Claude Code to answer: the question is saved in .codesight/chat-request.json',
          originalMessage: message,
        });
      }
    }, 500);
  } else {
    webview.postMessage({
      type: 'chatResponse',
      error: 'No language model available and no workspace folder open.',
      originalMessage: message,
    });
  }
}
