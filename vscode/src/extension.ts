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
const activeTimers: Array<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>> = [];

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
    } else if (msg.type === 'chatRequest') {
      handleChatRequest(msg, analyzer, webviewManager);
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
  for (const timer of activeTimers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  activeTimers.length = 0;
  analyzer = null;
}

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
  if (context.focusedNode) {
    const fn = context.focusedNode;
    if (fn.type === 'module') {
      contextText += `The user is asking about module "${fn.data.name}" (${fn.data.files?.length || 0} files, ${fn.data.lineCount || 0} lines)\n`;
      if (fn.data.description) contextText += `Description: ${fn.data.description}\n`;
    } else if (fn.type === 'file') {
      contextText += `The user is asking about file "${fn.data.name || fn.data.path}"\n`;
      if (fn.data.symbols?.length) {
        contextText += `Symbols: ${fn.data.symbols.slice(0, 15).map((s: any) => `${s.kind} ${s.name}`).join(', ')}\n`;
      }
    } else if (fn.type === 'symbol') {
      contextText += `The user is asking about ${fn.data.kind} "${fn.data.name}"\n`;
      if (fn.data.signature) contextText += `Signature: ${fn.data.signature}\n`;
      if (fn.data.comment) contextText += `Comment: ${fn.data.comment}\n`;
      if (fn.data.source) contextText += `Source:\n${fn.data.source.slice(0, 1500)}\n`;
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
    const outDir = path.join(root, '.codesight');
    fs.mkdirSync(outDir, { recursive: true });
    const requestFile = path.join(outDir, 'chat-request.json');
    fs.writeFileSync(requestFile, JSON.stringify({
      message,
      context: contextText,
      history: history?.slice(-6),
      timestamp: Date.now(),
    }, null, 2));

    // Watch for response file via polling
    const responseFile = path.join(outDir, 'chat-response.json');
    const requestTimestamp = Date.now();

    // Delete old response if exists
    try { fs.unlinkSync(responseFile); } catch (_) {}

    let poll: ReturnType<typeof setInterval>;
    let timeout: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(timeout);
      const pollIdx = activeTimers.indexOf(poll);
      if (pollIdx !== -1) activeTimers.splice(pollIdx, 1);
      const timeoutIdx = activeTimers.indexOf(timeout);
      if (timeoutIdx !== -1) activeTimers.splice(timeoutIdx, 1);
    };

    poll = setInterval(() => {
      try {
        if (!fs.existsSync(responseFile)) return;
        const raw = fs.readFileSync(responseFile, 'utf-8');
        const data = JSON.parse(raw);
        if (data.timestamp && data.timestamp > requestTimestamp - 1000) {
          cleanup();
          webview.postMessage({ type: 'chatResponse', text: data.text, originalMessage: message });
          try { fs.unlinkSync(responseFile); } catch (_) {}
        }
      } catch (_) {}
    }, 1000);
    activeTimers.push(poll);

    // Timeout after 3 minutes
    timeout = setTimeout(() => {
      cleanup();
    }, 180000);
    activeTimers.push(timeout);
  } else {
    webview.postMessage({
      type: 'chatResponse',
      error: 'No language model available and no workspace folder open.',
      originalMessage: message,
    });
  }
}
